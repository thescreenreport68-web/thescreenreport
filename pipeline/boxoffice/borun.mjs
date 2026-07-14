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
import { loadStore, alreadyPublished, recordPublished, parkAngle, parkedTries, clearParked, coveredEventSlugs } from "./store.mjs";
import { loadTracked, isMaterial, updateEventSuffix, recordArticle, linkPriorCoverage, isPastOpening } from "./tracker.mjs";
import { FORMS, ACCEPT_FLOOR, MAX_ATTEMPTS, GATE, DATA_DIR, REVIEW_DIR, FLOOD_CAP, MAX_ARTICLES_PER_DAY, MAX_RUN_COST_USD, STREAMING_DAILY_CAP } from "./config.bo.mjs";
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
  gatherImpl = gatherer.run,
  dataImpl = dataModule.run,
  synthImpl = synthesizer.run,
  writeArticleImpl = writer.run,
  qaReviewImpl = qa.review,
  imageImpl = imageAgent.run,
  publishImpl = writeBoxOfficeArticle,
  addLinksImpl = addInternalLinks,
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
  const burst = Math.min(limit, FLOOD_CAP);

  // ── FINDER ──
  let found = [];
  try { found = await withTimeout(findImpl({ limit: Math.max(burst * 4, 6), nowMs: now, preferStreaming, seen: coveredEventSlugs(store) }), AGENTS.finder.watchdogMs + 60e3, "finder"); }
  catch (e) { report.blocked.push({ stage: "finder", reason: String(e?.message || e).slice(0, 140) }); return finish(report, dryRun); }
  report.films = found.length;

  let written = 0, streamWritten = 0;
  for (const { film, trigger, angle } of found) {
    if (written >= burst) break;
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
      if (paceMs && (report.published.length + report.rejected.length + report.held.length)) await sleep(paceMs);
      console.log(`\n■ ${tag} (heat ${trigger.priority}, via ${film.via})`);

      const hold = (reason, { park = true, score = null } = {}) => {
        report.held.push({ tag, reason, ...(score != null ? { score } : {}) });
        if (park && !dryRun) parkAngle(store, trigger.eventSlug, angle.form, reason);
      };

      // ── DATA MODULE (deterministic TMDB) — runs first so the gatherer floor can see worldwide/budget ──
      await withTimeout(dataImpl(job), 60e3, `data ${tag}`).catch(() => { job.boxData = null; });

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
      if (angle.form === "BO-UPDATE") {
        const mat = isMaterial(film, job.gathered, job.boxData, tracked);
        if (!mat.material) { report.held.push({ tag, reason: `not material: ${mat.reason}` }); console.log(`  ⟳ skip: not material (${mat.reason})`); continue; }
        trigger.eventSlug = trigger.eventSlug + updateEventSuffix(mat);
        if (alreadyPublished(store, trigger.eventSlug, angle.form)) { report.skipped.push({ tag, reason: "already published (this update)" }); continue; }
        console.log(`  ✓ material: ${mat.reason}`);
      }

      // ── SYNTHESIZER ──
      await withTimeout(synthImpl(job), AGENTS.synthesizer.watchdogMs, `synth ${tag}`);
      if (job.synthFail || !job.brief) { hold(job.synthFail || "no brief"); continue; }

      // ── WRITER ⇄ QA (correction loop) ──
      let pass = false, acceptReason = null, corrections = null, prevArticle = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        console.log(`  attempt ${attempt}: writing…`);
        await withTimeout(writeArticleImpl(job, { corrections, previousArticle: prevArticle }), AGENTS.writer.watchdogMs, `writer ${tag}`);
        if (!job.article?.body) { corrections = "- Return the COMPLETE JSON article."; continue; }
        prevArticle = job.article;
        await withTimeout(qaReviewImpl(job), AGENTS.qa.watchdogMs, `qa ${tag}`);
        console.log(`  qa: score ${job.qa.score}, blocks ${job.qa.hardBlocks.length}, cuts ${job.qa.cutClaims.length}${job.qa.hardBlocks.length ? " :: " + job.qa.hardBlocks.slice(0, 4).join(" | ") : ""}`);
        if (job.qa.pass) { pass = true; break; }
        // FAIL-FAST (cost control): an unsalvageable draft (writer invented >4 figures — usually a thin
        // gather) is not worth 3 expensive retries + QA calls; hold cheaply and move on.
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
        if (attempt === MAX_ATTEMPTS && block.length === 0 && !engagementFloored(job.qa.hardBlocks) && (job.qa.score || 0) >= ACCEPT_FLOOR) {
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
      const out = publishImpl({ article: job.article, trigger, angle, film, gathered: job.gathered, boxData: job.boxData, image: job.image, dateISO, dryRun, ...(reviewDir ? { dir: reviewDir } : {}) });
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
