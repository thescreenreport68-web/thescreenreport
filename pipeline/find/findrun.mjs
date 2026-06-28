// FIND-engine orchestrator (v2). Discover (real-time RSS driver + TMDB backbone) → shortlist (fresh-first,
// cost control for the categorize LLM) → categorize (relevance + niche + angle + entity-RESOLVE) →
// verify (cross-source corroboration → CONFIRMED/DEVELOPING/RUMOR/HOLD) → score (freshness+corroboration)
// → diverse select → write the ranked queue MAKE consumes. The monitor records every step.
// Run: cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; node site/pipeline/find/findrun.mjs [--candidates=N] [--queue=N]
import { newMonitor, printRunReport, writeJSON } from "./store.mjs";
import { discover } from "./discover.mjs";
import { categorize } from "./categorize.mjs";
import { verify } from "./verify.mjs";
import { externalCorroboration } from "../lib/news.mjs";
import { scoreTopics, selectDiverse, selectMusicLanes, musicQuota } from "./score.mjs";
import { detectBreakouts } from "./sources/breakout.mjs";
import { expandInsideStories, TIER_S } from "./expand.mjs";

const arg = (k, d) => Number((process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1]) || d;
const SHORTLIST = arg("candidates", 28); // how many candidates the categorize LLM judges (cost control)
const QUEUE_N = arg("queue", 12); // how many topics land in the ranked queue
const PER_SUBCAT = arg("per-subcat", 2); // max topics per subcategory (set 1 for one-per-subcategory spread)
const EXPAND = process.argv.includes("--expand"); // opt-in: blanket Tier-S events with inside-angle articles

const runId = "run-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const monitor = newMonitor(runId);
console.log(`\n=== FIND ENGINE v2 · ${runId} ===`);

// Stage 1 — discover. Shortlist a MIX so both lanes feed categorize: fresh breaking RSS (news/interview/
// review/reaction) AND TMDB backbone (the evergreen niches — profile/box-office/trailer/where-to-watch/
// ranking) — otherwise an RSS-only shortlist starves every evergreen subcategory.
const candidates = await discover(monitor);
const fresh = candidates.filter((c) => c.ageMin != null).sort((a, b) => a.ageMin - b.ageMin);
const backbone = candidates.filter((c) => c.ageMin == null).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
const nBackbone = Math.min(backbone.length, Math.round(SHORTLIST * 0.35));
const shortlist = [...fresh.slice(0, SHORTLIST - nBackbone), ...backbone.slice(0, nBackbone)];
monitor.stage("shortlist", `kept ${shortlist.length} candidates for categorize (${SHORTLIST - nBackbone} fresh RSS + ${nBackbone} TMDB backbone)`);

// Stages 2–5 — relevance + categorize + angle + entity-resolve → MAKE topic objects
const topics = await categorize(shortlist, monitor);

// Music pop/indie LANE detection — confirm genuine indie breakouts from free signals (Reddit + Wikipedia
// pageviews) so the 60/40 split is real, not just the LLM's guess. Fails safe (leaves the heuristic).
await detectBreakouts(topics, monitor);

// Stage 8 — cross-source verify (trust label + publishable flag)
const verified = verify(topics, monitor);

// Stage 8b (PR7) — EXTERNAL corroboration via GDELT (free, keyless, non-Wikipedia): the in-run verify above
// only sees this pull's RSS, so a one-major event can't confirm. GDELT checks the whole open web and UPGRADES
// an under-sourced DEVELOPING/CONFIRMING event to CONFIRMED when ≥2 INDEPENDENT major owners report it. Only
// upgrades — never suppresses fresh news on a miss. (Throttled to GDELT's 1-req/5s limit.)
await externalCorroboration(verified, monitor);

// Stages 4+6 — score + rank, then diverse-select the queue. MUSIC gets a 60/40 pop/indie quota inside its
// 10% share (filled separately so pop news can't starve the indie lane; no pop-backfill if indie underfills).
scoreTopics(verified, monitor);
const { musicN, popN, indieN } = musicQuota(QUEUE_N);
const musicTopics = verified.filter((t) => (t.category || "").toLowerCase() === "music");
const nonMusic = verified.filter((t) => (t.category || "").toLowerCase() !== "music");
const { picks: musicPicks, popPicked, indiePicked } = selectMusicLanes(musicTopics, { popN, indieN, perSubcatMax: PER_SUBCAT });
const others = selectDiverse(nonMusic, { n: Math.max(0, QUEUE_N - musicPicks.length), perSubcatMax: PER_SUBCAT, publishableOnly: true });
const queue = [...others, ...musicPicks].sort((a, b) => b.priority - a.priority);
if (musicN > 0) monitor.stage("music-quota", `music ${musicPicks.length}/${musicN} (pop ${popPicked}/${popN}, indie ${indiePicked}/${indieN}); no pop-backfill of indie`);

// Inside-stories expansion (opt-in): a Tier-S event → many tone-safe angle articles, appended to the queue.
if (EXPAND) {
  const tierS = verified.filter((t) => TIER_S.has(t.eventType) && t.verification?.publishable).slice(0, 2);
  for (const ev of tierS) {
    const angles = await expandInsideStories(ev, monitor);
    scoreTopics(angles);
    for (const a of angles) if (!queue.some((q) => q.id === a.id)) queue.push(a);
  }
}

// Write the FIND→MAKE seam: the ranked, publishable, diverse queue.
writeJSON("queue.json", { runId, builtAt: new Date().toISOString(), count: queue.length, topics: queue });
monitor.stage("queue", `wrote ${queue.length} topics to data/find/queue.json`);

const report = monitor.finish(queue.length);
printRunReport(report);

console.log("\n── RANKED QUEUE (what MAKE will write) ──");
for (const t of queue) {
  const v = t.verification;
  console.log(`  [p${t.priority}] [${t.formatTag}] ${t.category}/${t.subcategory} · ${v.status}${v.attribution ? ` (via ${v.attribution})` : ""}`);
  console.log(`        "${t.title}"  · entity: ${t.primaryEntity} · kw: ${t.primaryKeyword}`);
}
const held = verified.filter((t) => !t.verification.publishable);
if (held.length) {
  console.log(`\n── HELD (not published — ${held.length}) ──`);
  for (const t of held) console.log(`  [${t.verification.status}] ${t.title}  — ${t.verification.hold || ""}`);
}
