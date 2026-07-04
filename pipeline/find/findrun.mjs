// FIND-engine orchestrator (v2). Discover (real-time RSS driver + TMDB backbone) → shortlist (fresh-first,
// cost control for the categorize LLM) → categorize (relevance + niche + angle + entity-RESOLVE) →
// verify (cross-source corroboration → CONFIRMED/DEVELOPING/RUMOR/HOLD) → score (freshness+corroboration)
// → diverse select → write the ranked queue MAKE consumes. The monitor records every step.
// Run: cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; node site/pipeline/find/findrun.mjs [--candidates=N] [--queue=N]
import { newMonitor, printRunReport, writeJSON, loadPublished, slugKey, entityKey } from "./store.mjs";
import { discover } from "./discover.mjs";
import { categorize } from "./categorize.mjs";
import { verify } from "./verify.mjs";
import { scoreTopics, selectDiverse } from "./score.mjs";
import { detectBreakouts } from "./sources/breakout.mjs";
import { expandInsideStories, TIER_S } from "./expand.mjs";

const arg = (k, d) => Number((process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1]) || d;
const SHORTLIST = arg("candidates", 28); // how many candidates the categorize LLM judges (cost control)
const QUEUE_N = arg("queue", 12); // how many topics land in the ranked queue
const EXPAND = process.argv.includes("--expand"); // opt-in: blanket Tier-S events with inside-angle articles

const runId = "run-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const monitor = newMonitor(runId);
console.log(`\n=== FIND ENGINE v2 · ${runId} ===`);

// Stage 1 — discover. The shortlist is NEWS-DRIVEN (trending-news rebuild): fresh breaking RSS items ARE the
// trending-news stories. The TMDB backbone (trending titles/people) no longer generates content — it is GROUNDING
// only (a zero-source title is held, not published) — so reserve just a small slice for the occasional trending
// PERSON genuinely in the news; the rest of the categorize budget goes to fresh RSS. (Real volume comes from the
// trend-finder hardening: GDELT velocity + Google-News-RSS + YouTube + Reddit, which feed more corroborated news.)
const candidates = await discover(monitor);
// DEDUP (owner 2026-07-01): NEVER re-process a story we already published. Pre-categorize drop by title slug (saves
// the categorize LLM + the whole MAKE cost on exact re-surfaces of the same RSS item — the main duplicate case); a
// second, outlet-agnostic eventSlug drop happens after categorize below.
const published = loadPublished();
const candBefore = candidates.length;
// Drop ROUNDUP / REVIEW / RANKING candidates (owner 2026-07-03): these aren't single-event news — a multi-item
// roundup ("New Music Friday", "…: All 16 Tracks Ranked", "X songs ranked", a "best album" review) makes the writer
// confabulate details across many entities (endless fabrication catches, never converges) and is off-brand for the
// news-only strip. Deterministic title guard, before the categorize LLM even sees them.
const ROUNDUP_REVIEW = /\b(tracks?|songs?|albums?|movies?|films?|episodes?|shows?|moments?|scenes?|characters?)\s+ranked\b|\branked\b[^.]*\b(tracks?|songs?|movies?|films?)\b|new music friday|\bbest album\b|\bworst album\b|\bre-?ranked\b|\b\d+\s+(best|worst|greatest|essential)\b|album review|\bis (?:her|his|their) best\b/i;
// RETROSPECTIVE / OPINION guard (owner 2026-07-03): an anniversary retrospective or opinion piece ("15 Years Later…
// Still One of TV's Best", "why X still holds up", "underrated") is NOT a news EVENT — it made the writer confabulate
// (the Spartacus 1960-film-vs-2010-series failure entered as such a retrospective). A real news event has an event
// verb (cast/died/renewed/dropped/won), not a temporal-retrospective/opinion framing. Deterministic title backstop.
const RETRO_OPINION = /\b\d+\s+years?\s+(later|after|on)\b|\bstill (one of|holds? up|the best|relevant|worth)\b|\brevisit(ing)?\b|\brewatch\b|\blooking back\b|\banniversary\b|\b(most )?(underrated|overlooked|forgotten)\b|\bwhy .{0,40}\b(is|are|remains?|still|should)\b|\bhidden gem\b|\bdeserves? (more|a)\b/i;
const freshCandidates = candidates.filter((c) => !published.titles.has(slugKey(c.title)) && !ROUNDUP_REVIEW.test(c.title || "") && !RETRO_OPINION.test(c.title || ""));
if (candBefore - freshCandidates.length > 0) monitor.stage("dedup", `dropped ${candBefore - freshCandidates.length} already-published candidate(s) by title; ${freshCandidates.length} remain`);
const fresh = freshCandidates.filter((c) => c.ageMin != null).sort((a, b) => a.ageMin - b.ageMin);
const backbone = freshCandidates.filter((c) => c.ageMin == null).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
const nBackbone = Math.min(backbone.length, Math.round(SHORTLIST * 0.15));
const shortlist = [...fresh.slice(0, SHORTLIST - nBackbone), ...backbone.slice(0, nBackbone)];
monitor.stage("shortlist", `kept ${shortlist.length} candidates for categorize (${SHORTLIST - nBackbone} fresh RSS + ${nBackbone} TMDB backbone)`);

// Stages 2–5 — relevance + categorize + angle + entity-resolve → MAKE topic objects
const topicsRaw = await categorize(shortlist, monitor);
// Second dedup pass: the outlet-agnostic eventSlug catches the SAME story re-reported under a different headline;
// the ROBUST primaryEntity+eventType key catches the case eventSlug misses — a story whose headline (and thus both
// its title slug AND eventSlug) drifts across runs (the KVIFF-regenerated bug). Drop if EITHER matches.
const topics = topicsRaw.filter((t) => {
  // Re-check the FINAL categorized title (the pre-categorize check ran on the raw RSS headline, which drifts and
  // truncates differently than the title actually recorded on publish — this catches that class).
  if (t.title && published.titles.has(slugKey(t.title))) return false;
  if (t.eventSlug && published.events.has(t.eventSlug)) return false;
  const ek = entityKey(t.primaryEntity, t.eventType);
  if (ek && published.entities.has(ek)) return false;
  return true;
});
if (topics.length < topicsRaw.length) monitor.stage("dedup", `dropped ${topicsRaw.length - topics.length} already-published topic(s) by eventSlug/entity+type`);

// Music pop/indie LANE detection — confirm genuine indie breakouts from free signals (Reddit + Wikipedia
// pageviews) so the 60/40 split is real, not just the LLM's guess. Fails safe (leaves the heuristic).
await detectBreakouts(topics, monitor);

// Stage 8 — cross-source verify (trust label + publishable flag)
const verified = verify(topics, monitor);

// (GDELT external corroboration REMOVED 2026-07-03 — trust-the-source: every candidate now comes from a top
// fact-checked trade, so there is nothing to cross-confirm. verify.mjs below already treats a single top-outlet
// story as publishable + attributed.)

// Stages 4+6 — score + rank, then TREND-PRIORITY select the queue. ALL verified-publishable topics compete in ONE
// priority-ranked pool — music, box-office, celebrity, every shape — with diversity only a soft tiebreak. No music
// quota, no hard per-subcategory cap: a genuinely trending story is never dropped for its category/shape.
scoreTopics(verified, monitor);
const queue = selectDiverse(verified, { n: QUEUE_N, publishableOnly: true });
monitor.stage("select", `selected ${queue.length}/${QUEUE_N} by trend-priority (music competes in the single pool; soft category spread)`);

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

// ── RECHECK / AUTO-RETRACTION (wired 2026-07-03 — the owner's rule: never run 24/7 with the retraction net
// dark). Every FIND cycle also polices the last 48h of published stories: a contradicted/hoax story is taken
// down or corrected, an under-corroborated DEVELOPING story that new outlets now confirm is promoted. Runs
// after the queue is written so a recheck failure can never cost the run its queue. FIND_SKIP_RECHECK=1 skips.
if (!process.env.FIND_SKIP_RECHECK) {
  try {
    const { runRecheck } = await import("./recheck.mjs");
    await runRecheck();
  } catch (e) {
    monitor.stage("recheck", "recheck pass FAILED (non-fatal): " + (e?.message || e));
  }
} else monitor.stage("recheck", "SKIPPED (FIND_SKIP_RECHECK)");

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
