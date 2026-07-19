// ORCHESTRATOR — the ONLY entry point of the box-office lane (plan §7, §9). No LLM of its own: it
// drives one work-file `job` through the agent team, enforces watchdogs / pacing / dedup / caps /
// kill-switch, adds internal links, assembles, and writes the per-run cost+token report.
//
//   FINDER → per film: GATHERER + DATA MODULE → SYNTHESIZER → WRITER ⇄ QA (corrections + cuts) →
//   IMAGE (mandatory) → internal links → ASSEMBLE → publish (or review-hold) → record
//
// Run (LIVE review-mode proof, keys from the parent .env):
//   cd site && node pipeline/boxoffice/borun.mjs --review --limit=1
import fs from "node:fs";
import path from "node:path";
import { AGENTS, meterReport, meterReset } from "./models.mjs";
import { findFilms } from "./agents/finder.mjs";
import * as gatherer from "./agents/gatherer.mjs";
import * as dataModule from "./boxofficeData.mjs";
import * as synthesizer from "./agents/synthesizer.mjs";
import * as writer from "./agents/writer.mjs";
import * as qa from "./agents/qa.mjs";
import * as imageAgent from "./agents/image.mjs";
import { writeBoxOfficeArticle } from "./assemble.mjs";
import { loadStore, alreadyPublished, recordPublished, parkAngle, parkedTries, parkCooling, clearParked, coveredEventSlugs, bumpZeroStreak, bumpDaySpend, daySpendUsd, filmAttemptBudgetLeft, bumpFilmAttempt } from "./store.mjs";
import { runFind, readQueue } from "./find/findrun.mjs";
import { dailyAudit } from "./audit.mjs";
import { allowance, debit } from "./pacing.mjs";
import { loadTracked, isMaterial, updateEventSuffix, recordArticle, linkPriorCoverage, isPastOpening } from "./tracker.mjs";
import { FORMS, ACCEPT_FLOOR, MAX_ATTEMPTS, GATE, DATA_DIR, REVIEW_DIR, FLOOD_CAP, MAX_ARTICLES_PER_DAY, MAX_RUN_COST_USD, STREAMING_DAILY_CAP, DAILY_SPEND_CAP_USD } from "./config.bo.mjs";
import { cutArticle } from "../lib/cutter.mjs";
import { addInternalLinks } from "../lib/internalLinks.mjs";
import { costReport } from "../lib/openrouter.mjs";

const PAUSED_FILE = path.join(DATA_DIR, "PAUSED");
const RUNS_DIR = path.join(DATA_DIR, "runs");

// WATCHDOG — no stage may hang the loop; a timeout is a logged skip, never a stuck run.
const withTimeout = (p, ms, label) => {
  let timer;
  return Promise.race([
    p,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`watchdog: ${label} exceeded ${Math.round(ms / 1000)}s`)), ms); timer.unref?.(); }),
  ]).finally(() => clearTimeout(timer));
};

const publishedToday = (store, now) => {
  const day = new Date(now).toISOString().slice(0, 10);
  return store.published.filter((r) => !r.review && (r.at || "").slice(0, 10) === day).length;
};
// Today's STREAMING publishes (for the 5-a-day streaming cap → protects the 15 box-office majority).
const streamingPublishedToday = (store, now) => {
  const day = new Date(now).toISOString().slice(0, 10);
  return store.published.filter((r) => !r.review && (r.at || "").slice(0, 10) === day && (FORMS[r.form] || {}).streaming).length;
};

// Engagement is KPI #1 (plan §0): an unresolved engagement/readability/humanVoice soft-floor must
// NEVER slip through on the terminal-accept path — a boring-but-accurate draft is held, not published.
const engagementFloored = (blocks = []) => blocks.some((b) => /^soft-floor (engagement|readability|humanVoice)/.test(b));

export async function boRun({
  findImpl = findFilms,
  dailyAuditImpl = dailyAudit,
  gatherImpl = gatherer.run,
  dataImpl = dataModule.run,
  synthImpl = synthesizer.run,
  writeArticleImpl = writer.run,
  qaReviewImpl = qa.review,
  imageImpl = imageAgent.run,
  publishImpl = writeBoxOfficeArticle,
  addLinksImpl = addInternalLinks,
  runFindImpl = runFind,
  readQueueImpl = readQueue,
  storeImpl = null,
  trackedImpl = null,
  hero = true,
  dryRun = false,
  review = false,
  limit = 1,
  preferStreaming = false,
  nowMs = null,
  paceMs = Number(process.env.BOXOFFICE_PACE_MS) || 0,
} = {}) {
  const now = nowMs ?? Date.now();
  const runId = `run-${new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const reviewDir = review ? (process.env.BOXOFFICE_REVIEW_DIR || REVIEW_DIR) : null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = storeImpl || loadStore();
  const tracked = trackedImpl || loadTracked();
  const report = { runId, mode: review ? "review" : "live", startedAt: new Date(now).toISOString(), films: 0, published: [], held: [], rejected: [], skipped: [], blocked: [] };
  meterReset();

  // ── 24/7 guards ──
  if (fs.existsSync(PAUSED_FILE)) { report.paused = true; return finish(report, dryRun); }
  const baseToday = publishedToday(store, now);
  const streamBaseToday = streamingPublishedToday(store, now);
  if (baseToday >= MAX_ARTICLES_PER_DAY) { report.dailyCapHit = baseToday; return finish(report, dryRun); }
  // DAILY SPEND CAP (owner cost mandate): once the LA-day's OpenRouter spend crosses the cap, live ticks
  // exit BEFORE any paid call — visible in the workflow log, never a silent burn.
  if (!dryRun && !reviewDir && daySpendUsd(store, { now: new Date(now) }) >= DAILY_SPEND_CAP_USD) {
    report.spendCapHit = daySpendUsd(store, { now: new Date(now) });
    console.log(`::warning title=boxoffice daily spend cap::$${report.spendCapHit} spent today >= $${DAILY_SPEND_CAP_USD} cap — publishing paused until the LA day rolls`);
    return finish(report, dryRun);
  }
  // ── P3 PACING GOVERNOR — spread the day's supply across LA hours; never over- or under-run. Ahead of
  // pace with an empty bucket → exit CHEAPLY before any model call. Behind pace → always allowed 1 (only
  // MATERIAL events ever publish downstream — the governor shapes WHEN, never invents WHAT). Review/dry
  // runs bypass pacing entirely (proofs must always run).
  let burst = Math.min(limit, FLOOD_CAP);
  if (!dryRun && !reviewDir) {
    const paceInfo = allowance(store, baseToday, burst, now);
    store.pace = { tokens: paceInfo.tokens, lastMs: paceInfo.lastMs };
    report.paced = { tokens: Number(paceInfo.tokens.toFixed(2)), behind: paceInfo.behind, expected: paceInfo.expected, allow: paceInfo.allow };
    if (paceInfo.allow < 1) {
      console.log(`  ⏸ pacing: ahead of pace (published ${baseToday} today, expected ~${paceInfo.expected}) with an empty bucket — cheap skip`);
      bumpDaySpend(store, 0, { now: new Date(now) }); // persists pace state; costs nothing
      return finish(report, dryRun);
    }
    burst = Math.min(burst, Math.max(1, paceInfo.allow));
  }

  // ── P2 EVENT RADAR — refresh the FIND queue when stale (≤1 batched categorize call per 45 min ≈ $0.001).
  // Fail-soft: a dead feed or model outage never blocks the tick — the inventory engine still runs.
  try {
    if (!readQueueImpl({ nowMs: now })) {
      const q = await withTimeout(runFindImpl({ nowMs: now, trackedFilms: tracked?.films || null }), 90e3, "findrun");
      report.queueBuilt = (q?.events || []).length;
      if (report.queueBuilt) console.log(`  ⚡ event queue rebuilt: ${report.queueBuilt} scored event(s)`);
    }
  } catch { /* event stream is additive — inventory discovery continues */ }

  // ── FINDER ──
  let found = [];
  try { found = await withTimeout(findImpl({ limit: Math.max(burst * 4, 25), nowMs: now, preferStreaming, seen: coveredEventSlugs(store) }), AGENTS.finder.watchdogMs + 60e3, "finder"); }
  catch (e) { report.blocked.push({ stage: "finder", reason: String(e?.message || e).slice(0, 140) }); return finish(report, dryRun); }
  report.films = found.length;

  // PAID-ATTEMPT CEILING PER TICK. Widening the candidate pool from 8 to 29 also widened the blast radius
  // of a bad day: one tick attempted 12 candidates, published 0, and spent $0.21. The pool exists so the
  // day's real stories are VISIBLE, not so a single tick can work through all of them. Cap paid attempts
  // at burst+2 — enough to skip past a couple of duds and still land the burst, bounded if none convert.
  const MAX_PAID_ATTEMPTS = burst + 2;
  let attempted = 0;
  let written = 0, streamWritten = 0;
  for (const { film, trigger, angle } of found) {
    if (written >= burst) break;
    if (attempted >= MAX_PAID_ATTEMPTS) { report.attemptCapHit = attempted; break; }
    if (baseToday + written >= MAX_ARTICLES_PER_DAY) { report.dailyCapHit = true; break; }
    if ((costReport()?.total || 0) > MAX_RUN_COST_USD) { report.costCapHit = true; break; }
    const tag = `${trigger.eventSlug}×${angle.form}`;
    const job = { film, trigger, angle };
    try {
      // MIX CAP (owner 15/5): once 5 streaming pieces are out today, skip further streaming so the day stays
      // box-office-majority — we never flood streaming to reach 20.
      if ((FORMS[angle.form] || {}).streaming && streamBaseToday + streamWritten >= STREAMING_DAILY_CAP) {
        report.skipped.push({ tag, reason: `streaming daily cap ${STREAMING_DAILY_CAP} reached — box-office only` }); continue;
      }
      if (angle.form !== "BO-UPDATE" && alreadyPublished(store, trigger.eventSlug, angle.form)) { report.skipped.push({ tag, reason: "already published" }); continue; }
      if (parkedTries(store, trigger.eventSlug, angle.form) === Infinity) { report.skipped.push({ tag, reason: "parked dead" }); continue; }
      if (parkCooling(store, trigger.eventSlug, angle.form, { now: new Date(now) })) { report.skipped.push({ tag, reason: "park cooling (held recently — escalating retry backoff)" }); continue; }
      // ── CHEAP MATERIALITY PRE-GATE (cost, 2026-07-18 live audit) ──
      // Materiality used to be evaluated only AFTER the paid gatherer, so every already-covered chart film
      // paid for TMDB + trade extraction on EVERY tick and was then held: "already covered today" was 43 of
      // ~50 holds in a 48-tick sample and ~86% of all spend went to stories that never published.
      // For a chart-driven film this is decidable for FREE: currentMetrics() takes `domestic` from
      // dailyChart.cume FIRST, and the finder already attached that cume — so with empty gathered/boxData
      // the domestic figure, the baseline, and the milestone math are IDENTICAL to the post-gatherer call.
      // We therefore skip only on a NON-material verdict; anything material proceeds down the full path
      // exactly as before (the trade report can still enrich a story we've decided is worth telling).
      const isChartUpdate = !!film?.dailyChart?.cume;
      if ((FORMS[angle.form] || {}).tracked && isChartUpdate) {
        const pre = isMaterial(film, {}, {}, tracked, { now: new Date(now) });
        if (!pre.material) { report.skipped.push({ tag, reason: `pre-gate (free): ${pre.reason}` }); continue; }
      }
      // FILM-LEVEL DAILY ATTEMPT BUDGET (free gate): a film may burn at most 3 PAID attempts per LA day
      // across all EVENT slugs/forms — without it one hot film (The Odyssey) burns ~20 via ev-opening/
      // ev-weekend/ev-record proliferation.
      // ⚠️ CHART UPDATES ARE EXEMPT (2026-07-18 audit): the budget is for UNBOUNDED event-slug retries. A
      // chart update is already hard-bounded — one per film per LA day AND strictly-higher domestic — so it
      // cannot loop. Counting event failures against it starved 3 REAL publishes in one day (Obsession
      // $256.8M, Backrooms $195.5M, Scary Movie $107.8M all had material numbers and were locked out; daily
      // volume fell 8 → 3). The budget must never block a story that just passed the materiality gate.
      if (!reviewDir && !isChartUpdate && filmAttemptBudgetLeft(store, film.title, { now: new Date(now) }) <= 0) {
        report.skipped.push({ tag, reason: "film attempt budget exhausted today (3 paid event tries/film/day)" });
        continue;
      }
      if (paceMs && (report.published.length + report.rejected.length + report.held.length)) await sleep(paceMs);
      console.log(`\n■ ${tag} (heat ${trigger.priority}, via ${film.via})`);

      const hold = (reason, { park = true, score = null } = {}) => {
        report.held.push({ tag, reason, ...(score != null ? { score } : {}) });
        if (park && !dryRun) parkAngle(store, trigger.eventSlug, angle.form, reason);
      };

      // ── DATA MODULE (deterministic TMDB) — runs first so the gatherer floor can see worldwide/budget ──
      await withTimeout(dataImpl(job), 60e3, `data ${tag}`).catch(() => { job.boxData = null; });

      // PAID work starts here — spend one of the film's 3 daily EVENT attempts (live only). Chart updates
      // are exempt (bounded by materiality) and must not consume the budget an event story needs.
      attempted++; // one of the tick's paid attempts, whatever the form
      if (!reviewDir && !dryRun && !isChartUpdate) bumpFilmAttempt(store, film.title, { now: new Date(now) });

      // ── GATHERER (the trade box-office report) ──
      await withTimeout(gatherImpl(job), AGENTS.gatherer.watchdogMs, `gatherer ${tag}`);
      if (job.gatherFail) {
        const thin = /^under floor/.test(job.gatherFail);
        const tries = (dryRun || !thin) ? 0 : parkAngle(store, trigger.eventSlug, angle.form, job.gatherFail);
        report.rejected.push({ tag, stage: "gatherer", reason: `${job.gatherFail}${thin ? ` (try ${tries})` : " (transient)"}` });
        console.log(`  ✗ gatherer: ${job.gatherFail}`);
        continue;
      }
      console.log(`  ✓ gathered: ${job.gathered.numbers.length} figures, ${job.gathered.outletCount} outlet(s)`);

      // ── FORM RECONCILIATION — a BO-OPENING whose gathered data shows a weekend DROP or a cume well
      // above the opening is really a later-weekend UPDATE. Reclassify so we never frame a week-2 report
      // as an "opening" (the timeline-consistency fix). ──
      if (angle.form === "BO-OPENING" && isPastOpening(job.gathered)) {
        angle.form = "BO-UPDATE";
        trigger.eventSlug = trigger.eventSlug.replace(/-bo-opening$/, "-bo-update");
        console.log(`  ↻ reclassified BO-OPENING → BO-UPDATE (data is past opening weekend)`);
      }

      // ── MATERIALITY (BO-UPDATE only) — the anti-duplicate-content law (plan §6): publish an update
      // ONLY when the number is a real NEW story, then give it a DISTINCT eventSlug so real weekend/
      // milestone updates across runs don't dedup-collide (protects dwell time = KPI #1). ──
      if ((FORMS[angle.form] || {}).tracked) { // BO-UPDATE + the P5 event forms (weekend/milestone/record)
        // publishedLedger = the append-only publish record; it is the fail-closed backstop when
        // tracked.json has been lost to a rebase conflict (registry §3.1 — 3 live duplicates came from this).
        const mat = isMaterial(film, job.gathered, job.boxData, tracked, { publishedLedger: store.published });
        if (!mat.material) { report.held.push({ tag, reason: `not material: ${mat.reason}` }); console.log(`  ⟳ skip: not material (${mat.reason})`); continue; }
        trigger.eventSlug = trigger.eventSlug + updateEventSuffix(mat);
        if (alreadyPublished(store, trigger.eventSlug, angle.form)) { report.skipped.push({ tag, reason: "already published (this update)" }); continue; }
        job.momentum = mat; // milestone/day tag → assemble's momentum title + system records
        console.log(`  ✓ material: ${mat.reason}`);
      }

      // ── SYNTHESIZER ──
      await withTimeout(synthImpl(job), AGENTS.synthesizer.watchdogMs, `synth ${tag}`);
      if (job.synthFail || !job.brief) { hold(job.synthFail || "no brief"); continue; }

      // ── WRITER ⇄ QA (correction loop) ──
      // COST: chart updates get ONE attempt (their gates are all deterministic — a corrections redraft has no
      // judge feedback to act on and would just burn a writer call); features get MAX_ATTEMPTS (draft + one
      // surgical correction pass).
      const maxAttempts = job.film?.dailyChart ? 1 : MAX_ATTEMPTS;
      let pass = false, acceptReason = null, corrections = null, prevArticle = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`  attempt ${attempt}: writing…`);
        await withTimeout(writeArticleImpl(job, { corrections, previousArticle: prevArticle }), AGENTS.writer.watchdogMs, `writer ${tag}`);
        if (!job.article?.body) { corrections = "- Return the COMPLETE JSON article."; continue; }
        prevArticle = job.article;
        await withTimeout(qaReviewImpl(job), AGENTS.qa.watchdogMs, `qa ${tag}`);
        console.log(`  qa: score ${job.qa.score}${job.qa.judged === false ? " (walls-only)" : ""}, blocks ${job.qa.hardBlocks.length}, cuts ${job.qa.cutClaims.length}${job.qa.hardBlocks.length ? " :: " + job.qa.hardBlocks.slice(0, 4).join(" | ") : ""}`);
        if (job.qa.pass) { pass = true; break; }
        // FAIL-FAST (cost control): an unsalvageable draft (writer invented >4 figures — usually a thin
        // gather) is not worth expensive retries + QA calls; hold cheaply and move on.
        if (job.qa.hardBlocks.some((b) => /draft-level failure/.test(b))) break;

        // ITERATIVE CUTS FIRST (deterministic + safe): keep cutting unsupported figures while cuts
        // remain and nothing hard-blocks; hand back to the writer only when cutting can't fix it.
        for (let cp = 0; cp < 3 && job.qa.cutClaims.length && !qa.classifyBlocks(job.qa.hardBlocks).block.length; cp++) {
          cutArticle(job.article, job.qa.cutClaims);
          await withTimeout(qaReviewImpl(job), AGENTS.qa.watchdogMs, `qa-recut ${tag}`);
          if (job.qa.pass) { pass = true; break; }
        }
        if (pass) break;

        let { block, fixable } = qa.classifyBlocks(job.qa.hardBlocks);
        if (attempt === maxAttempts && block.length === 0 && !engagementFloored(job.qa.hardBlocks) && (job.qa.score || 0) >= ACCEPT_FLOOR) {
          if (job.qa.cutClaims.length) {
            cutArticle(job.article, job.qa.cutClaims);
            await withTimeout(qaReviewImpl(job), AGENTS.qa.watchdogMs, `qa-terminal ${tag}`);
            ({ block, fixable } = qa.classifyBlocks(job.qa.hardBlocks));
          }
          // Accept once the cuts are attempted: no hard block, engagement OK, score >= floor, and at most ONE
          // residual soft flag left (after cutArticle ran, a leftover claim is un-locatable in the body — a
          // judge phrasing, not a verbatim fabrication — so it should not hold an otherwise-strong article).
          if (block.length === 0 && job.qa.cutClaims.length <= 1 && !engagementFloored(job.qa.hardBlocks) && (job.qa.score || 0) >= ACCEPT_FLOOR) {
            pass = true; acceptReason = `terminal-accept: score ${job.qa.score} >= ${ACCEPT_FLOOR}${job.qa.cutClaims.length ? " (1 un-locatable soft flag left)" : ""}`;
            break;
          }
        }
        corrections = [...block, ...fixable, ...(job.qa.weaknesses || [])].slice(0, 6).map((b) => `- ${b}`).join("\n");
      }
      if (!pass) { hold((job.qa?.hardBlocks?.length ? job.qa.hardBlocks.join(" | ") : job.qa?.cutClaims?.length ? `${job.qa.cutClaims.length} unverified claim(s) cut, unrecovered` : `score ${job.qa?.score} < ${GATE.publishMin}`), { score: job.qa?.score }); continue; }

      // ── IMAGE (mandatory) — after gates ──
      if (hero && !dryRun) {
        console.log(`  featured image…`);
        await withTimeout(imageImpl(job), AGENTS.image.watchdogMs, `image ${tag}`).catch(() => { job.image = null; });
        if (!job.image) { hold("no >=1200px relevant featured image"); continue; }
      }

      // ── LINK-CHAIN — link to OUR prior coverage of the same film (dwell time; plan §6) ──
      try { const lc = linkPriorCoverage(job.article.body, tracked, film); if (lc.body) { job.article.body = lc.body; job.priorLink = lc.linkedPrior; } } catch {}

      // ── INTERNAL LINKS: the generic related-article linker is OFF — it matched a PARTIAL title ("Toy Story"
      // for a "Toy Story 5" piece), mangling the subject into "[Toy Story] 5" and linking stale URLs. The
      // link-chain above (linkPriorCoverage — exact film title, our own prior coverage) is the safe linker. ──
      job.links = job.priorLink ? [job.priorLink] : [];

      // ── ASSEMBLE + PUBLISH ──
      const dateISO = new Date(now - written * 60000).toISOString();
      const out = publishImpl({ article: job.article, trigger, angle, film, gathered: job.gathered, boxData: job.boxData, image: job.image, dateISO, momentum: job.momentum || null, dryRun, ...(reviewDir ? { dir: reviewDir } : {}) });
      // CONSISTENCY GATE (single source of truth): a self-contradicting figure on ANY final surface
      // (title vs block vs FAQ vs body) blocked the write — hold with the exact violations, never publish.
      if (out.consistency && !out.consistency.ok) {
        hold(`consistency: ${out.consistency.violations.slice(0, 3).join(" | ")}`, { score: job.qa?.score });
        continue;
      }
      // SCAFFOLD GATE: placeholders / empty sections / template labels / flattened markdown / under-floor
      // body blocked the write — nothing broken can reach a reader.
      if (out.scaffold && out.scaffold.length) {
        hold(out.scaffold.slice(0, 3).join(" | "), { score: job.qa?.score });
        continue;
      }
      written++;
      if ((FORMS[angle.form] || {}).streaming) streamWritten++;
      if (!dryRun) {
        clearParked(store, trigger.eventSlug, angle.form);
        recordPublished(store, {
          ...(reviewDir ? { review: true } : {}),
          eventSlug: trigger.eventSlug, form: angle.form, slug: out.slug, title: job.article.title,
          film: film.title, tmdbId: film.tmdbId, eventType: "boxoffice",
        });
        // Serialization ledger — LIVE state only (never from a review preview, so a preview can't skew
        // next run's materiality baseline). Powers materiality + the link-chain next time this film runs.
        if (!reviewDir) { try { recordArticle(tracked, { film, form: angle.form, slug: out.slug, category: trigger.category, gathered: job.gathered, boxData: job.boxData }); } catch {} }
      }
      report.published.push({ tag, slug: out.slug, path: out.path, score: job.qa.score, ...(acceptReason ? { acceptReason } : {}) });
      console.log(`  ✅ ${reviewDir ? "review-written" : "published"}: ${out.slug} (score ${job.qa.score})`);
    } catch (e) {
      console.log(`  ⛔ ${String(e?.message || e).slice(0, 120)}`);
      report.blocked.push({ tag, reason: String(e?.message || e).slice(0, 140) });
    }
  }
  // ZERO-PUBLISH ALARM — LIVE ticks only (a review run must not touch the live streak). 48 hours of
  // hourly full-cost zero-publish ticks once went unnoticed; at ≥6 straight the run announces itself.
  if (!dryRun && !reviewDir) {
    const streak = bumpZeroStreak(store, report.published.length);
    report.zeroStreak = streak;
    if (streak >= 6) console.log(`::warning title=boxoffice zero-publish streak::${streak} consecutive live ticks published nothing — investigate held reasons in data/boxoffice/runs/`);
    if (report.published.length && store.pace) store.pace = debit(store.pace, report.published.length); // governor spend
    // P5 DAILY SELF-AUDIT — once per LA day, grade yesterday's sample (~\$0.003); drift becomes a ::warning::.
    try {
      const audit = await dailyAuditImpl({ store, now: new Date() });
      if (audit) {
        report.audit = audit;
        if (audit.issues.length) console.log(`::warning title=boxoffice quality audit::${audit.issues.length} issue(s) in yesterday's ${audit.sampled.length}-article sample — see the run report`);
        else if (audit.sampled.length) console.log(`  ✔ daily quality audit: ${audit.sampled.length} article(s) sampled, 0 issues`);
      }
    } catch { /* best-effort */ }
    report.daySpend = bumpDaySpend(store, costReport()?.total || 0, { now: new Date() }); // feeds the daily spend cap
  }
  return finish(report, dryRun);
}

function finish(report, dryRun) {
  report.finishedAt = new Date().toISOString();
  report.meter = meterReport();
  report.openrouterTotalUsd = Number((costReport()?.total || 0).toFixed(5));
  if (!dryRun) {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RUNS_DIR, `${report.runId}.json`), JSON.stringify(report, null, 1));
  }
  return report;
}

// CLI
if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
  const report = await boRun({
    dryRun: process.argv.includes("--dry-run"),
    review: process.argv.includes("--review"),
    preferStreaming: process.argv.includes("--stream"),
    limit: Number(arg("limit")) || 1,
  });
  const line = (x) => `  ${x.tag || x.stage || ""} — ${x.reason || x.slug || ""}${x.score != null ? ` (score ${x.score})` : ""}`;
  console.log(`\n━━ BOXOFFICE RUN ${report.runId} [${report.mode}] ━━ films ${report.films}${report.paused ? " · PAUSED" : ""}${report.dailyCapHit ? " · DAILY CAP" : ""}${report.costCapHit ? " · COST CAP" : ""}`);
  console.log(`PUBLISHED ${report.published.length}`); report.published.forEach((p) => console.log(line(p)));
  console.log(`HELD ${report.held.length}`); report.held.forEach((p) => console.log(line(p)));
  console.log(`REJECTED ${report.rejected.length}`); report.rejected.forEach((p) => console.log(line(p)));
  console.log(`SKIPPED ${report.skipped.length}`); report.skipped.forEach((p) => console.log(line(p)));
  console.log(`BLOCKED ${report.blocked.length}`); report.blocked.forEach((p) => console.log(line(p)));
  console.log(`cost: $${report.openrouterTotalUsd} · per-agent:`, JSON.stringify(report.meter.byRole));
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `published=${report.published.length}\nslugs=${report.published.map((p) => p.slug).join(" ")}\n`);
  }
}
