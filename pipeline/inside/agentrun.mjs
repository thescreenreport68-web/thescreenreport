// ORCHESTRATOR — the only entry point of the multi-agent inside lane (replaces insiderun.mjs).
// No LLM of its own: it drives the work-file through the agent team, enforces watchdogs/pacing/
// dedup/caps/kill-switch, adds internal links, assembles, publishes, and writes the per-run
// cost+token report the 24/7 cloud monitoring reads.
//
//   FINDER → per story: GATHERER → EMBED → SYNTHESIZER → WRITER ⇄ QA (corrections) → webCheck →
//   IMAGE (mandatory) → internal links → ASSEMBLE → publish → record
//
// Run: cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; \
//      node site/pipeline/inside/agentrun.mjs [--limit=N] [--dry-run] [--story=<slug>]
import fs from "node:fs";
import path from "node:path";
import { AGENTS, meterReport, meterReset } from "./models.mjs";
import { findStories } from "./agents/finder.mjs";
import * as gatherer from "./agents/gatherer.mjs";
import * as embedAgent from "./agents/embed.mjs";
import * as synthesizer from "./agents/synthesizer.mjs";
import * as writer from "./agents/writer.mjs";
import * as voiceAgent from "./agents/voice.mjs";
import * as imageAgent from "./agents/image.mjs";
import * as qa from "./agents/qa.mjs";
import { writeInsideArticle } from "./assemble.mjs";
import { loadStore, alreadyPublished, recentDuplicate, recordInsidePublished, parkAngle, parkedTries, clearParked, subjectTokens } from "./store.mjs";
import { bannedHooksFrom, hookHit } from "./seo.mjs";
import { ACCEPT_FLOOR, MAX_ATTEMPTS, GATE, DATA_DIR } from "./config.inside.mjs";
import { cutArticle } from "../lib/cutter.mjs";
import { dedupeSentences, trimIncomplete } from "../lib/polish.mjs";
import { addInternalLinks } from "../lib/internalLinks.mjs";
import { norm } from "./reactionFinder.mjs";
import { costReport } from "../lib/openrouter.mjs";

const PAUSED_FILE = path.join(DATA_DIR, "PAUSED");
// REVIEW MODE (owner preview-first rule): articles land in a holding dir (uploaded as a workflow
// artifact) instead of content/articles, and are NOT dedup-recorded — nothing can go live until the
// owner approves and the file is moved + committed.
// (read per-run inside agentRun so the offline suite can exercise review mode)
const RUNS_DIR = path.join(DATA_DIR, "runs");
const MAX_ARTICLES_PER_DAY = Number(process.env.MAX_ARTICLES_PER_DAY) || 30;
const MAX_RUN_COST_USD = Number(process.env.MAX_RUN_COST_USD) || 0.75; // funds ~40 cheap floor-fails + several full pipelines to LAND one publish per slot (owner: keep trying until it publishes)
const WEB_VERIFY = process.env.WEB_VERIFY !== "0";

// WATCHDOG — no stage may hang the 24/7 loop; a timeout is a logged skip, never a stuck run.
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

// Supply probes (INSIDE_DIAG=1): one status line per free harvest dependency, so a starved cloud
// run shows in the Actions log WHICH tier is blocked from the runner's IP. Log-only, never throws.
async function diagProbes() {
  const t = (ms) => ({ signal: AbortSignal.timeout(ms) });
  const P = [
    ["jina-keyless", () => fetch("https://r.jina.ai/https://example.com/", t(8000))],
    ["x-syndication", () => fetch("https://cdn.syndication.twimg.com/tweet-result?id=20&token=a", t(8000))],
    ["bsky-search", () => fetch("https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=movie&limit=1", { headers: { "user-agent": "Mozilla/5.0 (compatible; ScreenReportBot)" }, ...t(8000) })],
    ["gnews-rss", () => fetch("https://news.google.com/rss/search?q=movie&hl=en-US&gl=US&ceid=US:en", t(8000))],
  ];
  for (const [name, fn] of P) {
    try { const r = await fn(); console.log(`[diag] probe ${name}: HTTP ${r.status}`); }
    catch (e) { console.log(`[diag] probe ${name}: ${String(e?.message || e).slice(0, 60)}`); }
  }
}

export async function agentRun({
  findImpl = findStories,
  gatherImpl = gatherer.run,
  embedImpl = embedAgent.run,
  synthImpl = synthesizer.run,
  writeArticleImpl = writer.run,
  voiceImpl = voiceAgent.run,
  imageImpl = imageAgent.run,
  qaReviewImpl = qa.review,
  qaWebCheckImpl = qa.webCheck,
  publishImpl = writeInsideArticle,
  storeImpl = null,
  hero = true,
  webVerify = WEB_VERIFY,
  dryRun = false,
  limit = 3,
  onlyStory = null,
  nowMs = null,
  paceMs = Number(process.env.INSIDE_PACE_MS) || 0,
} = {}) {
  const REVIEW_DIR = process.env.INSIDE_REVIEW_DIR || null;
  const now = nowMs ?? Date.now();
  const runId = `run-${new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = storeImpl || loadStore();
  const report = { runId, startedAt: new Date(now).toISOString(), stories: 0, published: [], held: [], rejected: [], skipped: [], blocked: [] };
  meterReset();

  // ── 24/7 guards ──
  if (fs.existsSync(PAUSED_FILE)) { report.paused = true; return finish(report, dryRun); }
  // Probes only on REAL runs: injected finders mean an offline test — the suite must never touch
  // the network even with INSIDE_DIAG exported in the shell (adversarial review 2026-07-10).
  if (process.env.INSIDE_DIAG === "1" && !dryRun && findImpl === findStories) await diagProbes();
  // Baseline BEFORE this run publishes anything — records land in the store mid-run, so counting
  // live would tally each new article twice (baseline+written is correct in both wet and dry runs).
  const baseToday = publishedToday(store, now);
  if (baseToday >= MAX_ARTICLES_PER_DAY) { report.dailyCapHit = baseToday; return finish(report, dryRun); }

  // ── FINDER ──
  let found = [];
  // Deep candidate pool the try-until-published loop walks — decoupled from the publish quota so a slot
  // always has a reacted-to story in reach (owner 2026-07-12: publish at EVERY slot, no matter the cancels).
  const POOL = Number(process.env.INSIDE_CANDIDATE_POOL) || Math.max(limit * 12, 30);
  try { found = await withTimeout(findImpl({ limit: POOL, nowMs: now }), AGENTS.finder.watchdogMs + 90e3, "finder"); }
  catch (e) { report.blocked.push({ stage: "finder", reason: String(e?.message || e).slice(0, 140) }); return finish(report, dryRun); }
  if (onlyStory) found = found.filter((f) => f.story.parentEventSlug === onlyStory);
  report.stories = found.length;

  let written = 0;
  for (const { story, angle } of found) {
    if (written >= limit) break;
    if (baseToday + written >= MAX_ARTICLES_PER_DAY) { report.dailyCapHit = true; break; }
    // costReport() covers EVERY LLM call in-process (agentChat routes through the same client, and
    // so do imagePicker's vision + webVerify) — do NOT add meterReport on top: that double-counts.
    if ((costReport()?.total || 0) > MAX_RUN_COST_USD) { report.costCapHit = true; break; }
    const tag = `${story.parentEventSlug}×${angle.form}`;
    const job = { story, angle };
    try {
      // dedup + parked-dead (never repost; a ripple that never materialized stops retrying)
      if (alreadyPublished(store, story.parentEventSlug, angle.form)) { report.skipped.push({ tag, reason: "already published" }); continue; }
      // NEAR-DUPLICATE guard (owner 2026-07-16): a re-report of an event we already covered under a
      // different headline/slug within the last 48h — skip BEFORE any paid work so we never publish
      // "The Batman 2 Delayed" and "The Batman Part II Delayed" twice.
      const dup = recentDuplicate(store, story, { now });
      if (dup) { report.skipped.push({ tag, reason: `near-duplicate of ${dup.slug} (${(dup.at || "").slice(0, 10)})` }); console.log(`  ⃠ skipped near-duplicate of ${dup.slug}`); continue; }
      if (parkedTries(store, story.parentEventSlug, angle.form) === Infinity) { report.skipped.push({ tag, reason: "parked dead" }); continue; }
      if (paceMs && (report.published.length + report.rejected.length + report.held.length + report.blocked.length)) await sleep(paceMs);
      console.log(`\n■ ${tag} (heat ${story.priority}, ${story.via})`);
      // Deterministic quality holds PARK (3 strikes → dead) so a losing story doesn't re-run the
      // full paid pipeline every tick forever; transient infra holds (web-check outage) do NOT.
      const hold = (reason, { park = true, score = null } = {}) => {
        report.held.push({ tag, reason, ...(score != null ? { score } : {}) });
        if (park && !dryRun) parkAngle(store, story.parentEventSlug, angle.form, reason);
      };

      // ── GATHERER ──
      await withTimeout(gatherImpl(job), AGENTS.gatherer.watchdogMs, `gatherer ${tag}`);
      if (job.gatherFail) {
        const genuineThin = /^under floor/.test(job.gatherFail);
        const tries = (dryRun || !genuineThin) ? 0 : parkAngle(store, story.parentEventSlug, angle.form, job.gatherFail);
        report.rejected.push({ tag, stage: "gatherer", reason: `${job.gatherFail}${genuineThin ? ` (try ${tries})` : " (transient — not parked)"}` });
        console.log(`  ✗ gatherer: ${job.gatherFail}`);
        continue;
      }
      console.log(`  ✓ gathered: ${job.gatherStats.namedVoices} named + ${job.gatherStats.fanPosts} audience anchors`);

      // ── EMBED (best-effort, never blocks) ──
      await withTimeout(embedImpl(job), AGENTS.embed.watchdogMs, `embed ${tag}`).catch(() => { job.embeds = { tweetIds: job.factBlock?.tweetIds || [], instagramUrls: [] }; });
      console.log(`  ✓ embeds: ${job.embeds.tweetIds.length} X, ${job.embeds.instagramUrls.length} IG`);

      // ── SYNTHESIZER ──
      await withTimeout(synthImpl(job), AGENTS.synthesizer.watchdogMs, `synthesizer ${tag}`);
      if (job.synthFail || !job.brief) { hold(job.synthFail || "no brief"); continue; }

      // ── WRITER ⇄ QA (correction loop) ──
      // TITLE-HOOK VARIETY (owner audit: "has fans in a chokehold" ×7): the rolling ledger of recent
      // titles yields the overused hooks; the writer is told, and a slip demands ONE rewrite before QA.
      const bannedHooks = bannedHooksFrom(store.published.slice(-20).map((r) => r.title).filter(Boolean));
      const allowTokens = subjectTokens(`${story.primaryEntity || ""} ${story.parentTitle || ""}`);
      let pass = false, acceptReason = null, corrections = null, prevArticle = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        console.log(`  attempt ${attempt}: writing…`);
        await withTimeout(writeArticleImpl(job, { corrections, previousArticle: prevArticle, bannedHooks }), AGENTS.writer.watchdogMs, `writer ${tag}`);
        if (!job.article?.body) { corrections = "- Return the COMPLETE JSON article."; continue; }
        prevArticle = job.article;
        const hooked = hookHit(job.article.title, bannedHooks, { allowTokens });
        if (hooked && attempt < MAX_ATTEMPTS) {
          corrections = `- TITLE VARIETY: the phrase "${hooked}" is overused in recent titles — rewrite the title (and metaTitle if it echoes it) with a FRESH story-specific hook. Change nothing else.`;
          console.log(`  ✎ overused hook "${hooked}" — title rewrite demanded`);
          continue;
        }
        await withTimeout(qaReviewImpl(job), AGENTS.qa.watchdogMs, `qa ${tag}`);
        console.log(`  qa: score ${job.qa.score}, blocks ${job.qa.hardBlocks.length}, cuts ${job.qa.cutClaims.length}${job.qa.hardBlocks.length ? " :: " + job.qa.hardBlocks.slice(0, 4).join(" | ") : ""}`);
        if (job.qa.pass) { pass = true; break; }
        // ITERATIVE CUTS FIRST (run 11: attempt 1 scored 92 with ONE cuttable claim, but a single
        // cut-recheck escalated to a full surgical rewrite that mangled quotes). Cutting is
        // deterministic and safe — keep cutting while cuts remain and nothing hard blocks; hand
        // the article back to the writer only when cutting alone cannot fix it.
        for (let cutPass = 0; cutPass < 3 && job.qa.cutClaims.length && !job.qa.hardBlocks.length; cutPass++) {
          cutArticle(job.article, job.qa.cutClaims);
          await withTimeout(qaReviewImpl(job), AGENTS.qa.watchdogMs, `qa-recut ${tag}`);
          if (job.qa.pass) { pass = true; break; }
        }
        if (pass) break;
        let { block, fixable } = qa.classifyBlocks(job.qa.hardBlocks);
        if (attempt === MAX_ATTEMPTS && block.length === 0 && (job.qa.score || 0) >= ACCEPT_FLOOR) {
          if (job.qa.cutClaims.length) {
            cutArticle(job.article, job.qa.cutClaims);
            await withTimeout(qaReviewImpl(job), AGENTS.qa.watchdogMs, `qa-terminal ${tag}`);
            ({ block, fixable } = qa.classifyBlocks(job.qa.hardBlocks));
          }
          if (block.length === 0 && job.qa.cutClaims.length === 0 && (job.qa.score || 0) >= ACCEPT_FLOOR) {
            pass = true; acceptReason = `terminal-accept: locks verified, score ${job.qa.score} >= ${ACCEPT_FLOOR}`;
            break;
          }
        }
        corrections = [...block, ...fixable, ...(job.qa.weaknesses || [])].slice(0, 6).map((b) => `- ${b}`).join("\n");
        // Fabricated/unverbatim quotes get an explicit remediation: the fix is REMOVING quote marks
        // (or swapping in an exact anchor), not paraphrasing the same span into a new fake quote.
        if (/fabricated-quote|unverbatim/.test(corrections)) {
          corrections += "\n- FIX RULE for the quote blocks above: either replace the span with an EXACT anchor quote (copy by id), or keep the sentence and DELETE the quotation marks so it reads as your own analysis. Do NOT reword it into another quoted span.";
        }
      }
      if (!pass) { hold(job.qa?.hardBlocks?.join(" | ") || `score ${job.qa?.score} < ${GATE.publishMin}`, { score: job.qa?.score }); continue; }

      // ── VOICE — native-register pass (REV 3). Cosmetic ONLY by construction: quotes are masked
      //    from the editor, and the fact-locks re-run on the result — any damage reverts to the
      //    QA-passed draft. A voice outage ships the un-voiced article; it never holds anything.
      try {
        const preVoice = JSON.parse(JSON.stringify(job.article));
        await withTimeout(voiceImpl(job), AGENTS.voice.watchdogMs, `voice ${tag}`);
        if (job.voiceSkipped) {
          job.article = preVoice;
          console.log(`  voice: skipped (${job.voiceSkipped})`);
        } else {
          const post = qa.factLocks(job.article, job.factBlock, angle);
          if (post.hardBlocks.length || (post.proseCuts || []).length) {
            job.article = preVoice;
            console.log(`  voice: REVERTED (${post.hardBlocks[0] || "unanchored quote introduced"})`);
          } else {
            console.log("  voice: applied");
          }
        }
        delete job.voiceSkipped;
      } catch (e) { console.log(`  voice: skipped (${String(e?.message || e).slice(0, 60)})`); }

      // ── webCheck — ALWAYS-last content gate ──
      if (webVerify && !dryRun) {
        console.log(`  web-check…`);
        // webVerify internally retries; give it a bigger budget than a judge call, and treat a
        // check that DID NOT RUN as a HOLD — never publish unverified (fail-closed; the Thor
        // regression guard). Transient outage → retry next tick (not parked).
        const wv = await withTimeout(qaWebCheckImpl(job), 360e3, `webcheck ${tag}`).catch((e) => ({ ran: false, ok: false, contradictions: [], error: String(e?.message || e).slice(0, 120) }));
        if (!wv.ran) { hold(`web-check did not run (${wv.error || "no evidence"}) — held unverified`, { park: false, score: job.qa.score }); continue; }
        if (wv.contradictions?.length) {
          cutArticle(job.article, wv.contradictions.map((c) => c.claim));
          await withTimeout(qaReviewImpl(job), AGENTS.qa.watchdogMs, `qa-webcut ${tag}`);
          if (job.qa.cutClaims.length) { cutArticle(job.article, job.qa.cutClaims); await withTimeout(qaReviewImpl(job), AGENTS.qa.watchdogMs, `qa-webcut2 ${tag}`); }
          const reBlock = qa.classifyBlocks(job.qa.hardBlocks || []).block;
          if (reBlock.length || job.qa.cutClaims.length || (job.qa.score || 0) < ACCEPT_FLOOR) {
            hold(`web-check cuts didn't re-clear (${wv.contradictions.length} contradictions)`, { score: job.qa.score });
            continue;
          }
        }
      }
      job.article.body = trimIncomplete(dedupeSentences(job.article.body));

      // ── IMAGE (mandatory featured image) ──
      if (hero && !dryRun) {
        console.log(`  featured image…`);
        await withTimeout(imageImpl(job), AGENTS.image.watchdogMs, `image ${tag}`).catch(() => { job.image = null; });
        if (!job.image) { hold("no >=1200px relevant featured image"); continue; }
      }

      // ── INTERNAL LINKS (deterministic, tone-gated; zero links beats one wrong link) ──
      try {
        const linked = addInternalLinks({ body: job.article.body, title: job.article.title, tags: job.article.tags || [], category: story.category, slug: "" }, { max: 3 });
        if (linked?.body) { job.article.body = linked.body; job.links = linked.linked; }
      } catch { job.links = []; }

      // ── ASSEMBLE + PUBLISH ──
      const dateISO = new Date(now - written * 60000).toISOString();
      const out = publishImpl({ article: job.article, trigger: story, angle, factBlock: job.factBlock, image: job.image, embeds: job.embeds, dateISO, dryRun, ...(REVIEW_DIR ? { dir: REVIEW_DIR } : {}) });
      written++;
      // Review mode ALSO records — flagged review:true so the daily cap ignores it — because the
      // owner previews one story per run and a preview must never repeat (REV 4). The article file
      // itself still lives only in the run artifact; the workflow commits ONLY the state files.
      if (!dryRun) {
        clearParked(store, story.parentEventSlug, angle.form);
        recordInsidePublished(store, {
          ...(REVIEW_DIR ? { review: true } : {}),
          parentEventSlug: story.parentEventSlug, form: angle.form, slug: out.slug,
          title: job.article.title, primaryEntity: story.primaryEntity, eventType: story.eventType,
          harvestQuoteKeys: [...job.factBlock.reactions, ...job.factBlock.aggregateFans].map((r) => norm(r.quote).slice(0, 90)),
          angle: { form: angle.form, angle: angle.angle, workingTitle: angle.workingTitle, focusEntity: angle.focusEntity, searchQueries: angle.searchQueries },
          trigger: { parentEventSlug: story.parentEventSlug, parentSlug: story.parentSlug, parentTitle: story.parentTitle, primaryEntity: story.primaryEntity, eventType: story.eventType, tmdbType: story.tmdbType, subjectKind: story.subjectKind, priority: story.priority, category: story.category, overview: story.overview || "", work: story.work || null, sources: story.sources || [] },
        });
      }
      report.published.push({ tag, slug: out.slug, score: job.qa.score, ...(acceptReason ? { acceptReason } : {}), anchors: job.gatherStats.namedVoices + job.gatherStats.fanPosts, embeds: job.embeds });
      console.log(`  ✅ published: ${out.slug} (score ${job.qa.score})`);
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
  const report = await agentRun({
    dryRun: process.argv.includes("--dry-run"),
    limit: Number(arg("limit")) || 3,
    onlyStory: arg("story") || null,
  });
  const line = (x) => `  ${x.tag || x.stage || ""} — ${x.reason || x.slug || ""}${x.score != null ? ` (score ${x.score})` : ""}`;
  console.log(`\n━━ AGENT RUN ${report.runId} ━━ stories ${report.stories}${report.paused ? " · PAUSED" : ""}${report.dailyCapHit ? " · DAILY CAP" : ""}${report.costCapHit ? " · COST CAP" : ""}`);
  console.log(`PUBLISHED ${report.published.length}`); report.published.forEach((p) => console.log(line(p)));
  console.log(`HELD ${report.held.length}`); report.held.forEach((p) => console.log(line(p)));
  console.log(`REJECTED ${report.rejected.length}`); report.rejected.forEach((p) => console.log(line(p)));
  console.log(`SKIPPED ${report.skipped.length}`); report.skipped.forEach((p) => console.log(line(p)));
  console.log(`BLOCKED ${report.blocked.length}`); report.blocked.forEach((p) => console.log(line(p)));
  console.log(`cost: $${report.openrouterTotalUsd} · per-agent:`, JSON.stringify(report.meter.byRole));
  // GitHub Actions outputs (the cloud workflow's commit/deploy steps key off these).
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      `published=${report.published.length}\nslugs=${report.published.map((p) => p.slug).join(" ")}\n`);
  }
}
