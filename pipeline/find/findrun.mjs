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
import { buildRadar, loadRadar, radarBoost } from "./radar.mjs";
import { load as paceLoad, save as paceSave, recordCandidates } from "../lib/pacing.mjs";

const arg = (k, d) => Number((process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1]) || d;
const SHORTLIST = arg("candidates", 28); // how many candidates the categorize LLM judges (cost control)
const QUEUE_N = arg("queue", 12); // how many topics land in the ranked queue
// NEWSWORTHINESS FLOOR (owner 2026-07-06): topics below this priority are soft filler (soundtrack-chart items, reality
// casting, wedding reactions) and are DROPPED so the 2-hourly drip stops padding slow ticks with marginal articles.
// Tunable via SELECT_FLOOR (raise toward 51 for movies-only-strict; 0 disables). minKeep in selectDiverse guarantees
// the queue never fully starves. On a normal news day 6-10 real stories clear it (validated against the live queue).
const SELECT_FLOOR = Number(process.env.SELECT_FLOOR ?? 48);
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
const ROUNDUP_REVIEW = /\b(tracks?|songs?|albums?|movies?|films?|episodes?|shows?|moments?|scenes?|characters?)\s+ranked\b|\branked\b[^.]*\b(tracks?|songs?|movies?|films?)\b|new music friday|\bbest album\b|\bworst album\b|\bre-?ranked\b|\b\d+\s+(best|worst|greatest|essential|highest|biggest|top)\b|highest[- ]grossing\b[^.]{0,45}\bof all time\b|album review|\bis (?:her|his|their) best\b/i;
// RETROSPECTIVE / OPINION guard (owner 2026-07-03): an anniversary retrospective or opinion piece ("15 Years Later…
// Still One of TV's Best", "why X still holds up", "underrated") is NOT a news EVENT — it made the writer confabulate
// (the Spartacus 1960-film-vs-2010-series failure entered as such a retrospective). A real news event has an event
// verb (cast/died/renewed/dropped/won), not a temporal-retrospective/opinion framing. Deterministic title backstop.
const RETRO_OPINION = /\b\d+\s+years?\s+(later|after|on)\b|\bstill (one of|holds? up|the best|relevant|worth)\b|\brevisit(ing)?\b|\brewatch\b|\blooking back\b|\banniversary\b|\b(most )?(underrated|overlooked|forgotten)\b|\bwhy .{0,40}\b(is|are|remains?|still|should)\b|\bhidden gem\b|\bdeserves? (more|a)\b/i;
// OUT-OF-SCOPE junk (owner 2026-07-04: NO anime/games/Bollywood — the exact junk the Google-News trending lane can
// drag in). Deterministic pre-categorize drop so it never costs a categorize call; the editorial inScope gate is the
// LLM backstop for whatever slips past. Title patterns + a small blocklist of pure Bollywood/anime outlets.
const SCOPE_JUNK = /\banime\b|\bmanga\b|\bwebtoon\b|\b(video ?games?|gameplay|playstation|xbox|nintendo|steam deck|speedrun)\b|\bbollywood\b|\bcrore\b|box office collections|\b(hindi|tamil|telugu|kannada|malayalam|punjabi)\s+(film|movie|cinema|box office|actor|actress)\b/i;
const JUNK_OUTLETS = new Set(["crunchyroll", "pinkvilla", "bollywood hungama", "koimoi", "the times of india", "times of india"]);
// DULL INDUSTRY / FESTIVAL inside-baseball (owner 2026-07-04: harden the drop — the Malta-film-commissioner /
// soundstage-infrastructure class is accurate but LOW-ENGAGEMENT, off the big-tentpole brand). Deterministic
// pre-categorize drop. Kept NARROW so real news (a studio greenlight, a festival AWARD/premiere) still passes — we
// drop only policy/infrastructure/lineup items a general fan never searches.
// (owner 2026-07-06) EXTENDED with festival-HONORS/TRIBUTE patterns: a "Receives Top Honors at Karlovy Vary" /
// President's-Award / honorary-globe ceremony piece is festival color, not hard movie news — it slipped this guard
// twice (KVIFF). Kept narrow so a real festival AWARD-WIN or PREMIERE headline still passes.
// NOTE (audit 2026-07-06): festival-honor patterns are ANCHORED to a festival/ceremony context so they drop only
// tribute/honorary color — NOT a festival COMPETITION WIN or a genuine news hook that merely mentions an honor
// ("Denzel Receives Lifetime Achievement Award, Announces Retirement" must still pass; "Karlovy Vary Competition
// Winner" must still pass). "top honou?rs?" only fires when a festival name is nearby; "honorary" only for
// festival-specific prizes (an honorary Oscar/Governors Award is on-brand Hollywood and is NOT dropped).
const DULL_INDUSTRY = /\bfilm commission(er)?\b|\bsound\s?stage\b|\bstudio (space|lot|complex|infrastructure)\b|\btax (incentive|rebate|credit)s?\b|\bfilming incentive|\bco-?production (treaty|fund)\b|\bfestival (lineup|line-up|jury|panel|slate|market|dates)\b|\bindustry (days|panel|conference|summit)\b|\bfilm fund\b|\brebate program|\bcrystal globe\b|\bguest of honou?r\b|honou?red at (the )?[^.]{0,25}festival|\btop honou?rs?\b[^.]{0,30}\b(festival|karlovy|cannes|venice|berlinale|sundance|tiff|locarno|san sebasti)\b|\bpresident'?s award\b|\bhonorary (palme|golden lion|golden bear|c[eé]sar|goya|leopard)\b/i;
// LIVE-EVENT / non-title where-to-watch (owner 2026-07-06): a "where to watch [fireworks/parade/telecast]" item is
// not a film/TV story — it's off the movies-first mandate AND high-error (the Macy's July-4 fireworks item inherited
// a WRONG network from its single source, TheWrap, and went live saying ABC when it was NBC). Drop live civic-event
// viewing guides; a real film/show where-to-watch still passes.
// NOTE (audit 2026-07-06): the where-to-watch branch is CIVIC-EVENTS-ONLY (fireworks/parade/marathon/telethon/ball
// drop). It deliberately does NOT include ceremony/telecast/red-carpet/pre-show — those match on-brand Hollywood
// AWARDS viewing guides ("How to Watch the Oscars", "Golden Globes Red Carpet Pre-Show"), which we WANT to keep.
const LIVE_EVENT = /\bfireworks (spectacular|show|display|celebration)\b|\b(where|how) to (watch|stream)\b[^.]{0,45}\b(fireworks|parade|marathon|telethon|ball drop)\b|\b(macy'?s|nathan'?s|thanksgiving|new year'?s eve)\b[^.]{0,30}\b(fireworks|parade|ball drop|day special)\b/i;
// OFF-SCOPE for the NEWS lane (owner 2026-07-10): box-office numbers/results/records, film/show RELEASE DATES &
// schedules ("when it comes out"), and streaming-PLATFORM / where-to-watch / OTT-release stories now belong to a
// SEPARATE box-office-&-releases automation. The news lane covers ONLY latest TRENDING Hollywood/music/celebrity news
// (casting, trailers, reactions, deals, awards RESULTS, music, scandals). Deterministic drop so the writer never makes them.
const BOX_OFFICE = /\bbox[- ]?office\b|\bopening weekend\b|\bweekend (debut|gross|haul|estimate|numbers?)\b|\bgrosse[ds]\b|\b(domestic|worldwide|global|overseas|international)\s+(gross|debut|total|haul)\b|\bhighest[- ]grossing\b|\bbiggest (opening|debut)\b|\b(passes?|crosses?|tops?|surpasses?)\b[^.?!]{0,20}\$\s?\d[\d.,]*\s?(m|b|k|million|billion)\b|\$\s?\d[\d.,]*\s?(m|b|k|million|billion)\b[^.?!]{0,40}\b(opening|weekend|globally|worldwide|domestic|box[- ]?office|debut|theaters|gross)\b/i;
const RELEASE_PLATFORM = /\b(where|how) to (watch|stream)\b|\bwhere to watch\b|\bnow streaming\b|\brelease date\b|\b(gets?|sets?|lands?|reveals?|announces?|scores?)\s+(a |its |new )?(release|streaming|premiere|digital|theatrical) date\b|\bstreaming (date|release|debut|premiere|guide|window)\b|\bott (release|platform|date)\b|\b(streaming|available|premieres?|premiering|arriv(es?|ing)|land(s|ing)|hit(s|ting)?|drop(s|ping)?|debut(s|ing)?|coming|heading) (on|to)\s+(netflix|hulu|disney\+?|max|hbo( ?max)?|peacock|prime video|amazon( prime)?|apple tv\+?|paramount\+?|starz|showtime|mubi|tubi|hallmark)\b|\bhits? (theaters|cinemas|streaming)\b/i;
// SCOPE GUARDS ADDED 2026-07-17 (12h-audit root causes — 7 of 35 published articles were out of scope):
// VIEWERSHIP: streaming-chart/watch-hours numbers as the story = the box-office lane's beat, not ours.
export const VIEWERSHIP = /\b(most[- ](viewed|watched|streamed)|what we watched|viewership|watch[- ]?hours|million (views|viewers)|nielsen (ratings?|top)|streaming (charts?|rankings?|numbers)|top 10 (movies|shows|films)\b)/i;
// MERCH: product/apparel/collectible drops are commerce, not entertainment news.
export const MERCH = /\b(merch(andise)?|apparel|clothing (line|collection|collab)|capsule collection|crossover collection|funko|collectibles?|toy line|action figures?|streetwear|sneakers?|fragrance|makeup (line|collection)|product (line|drop|collection))\b/i;
// SCHEDULE_GRID: a network timeslot/schedule grid is release-date content (the separate lane's beat).
export const SCHEDULE_GRID = /\b(fall|spring|summer|midseason) (tv )?(schedule|lineup)\b|\bsets? [^.?!]{0,25}(premiere dates|schedule)\b|\btime ?slots?\b/i;
// INTERVIEW_PROFILE: interview-as-content ("X discusses/opens up about Y") is an evergreen form the owner
// removed — it is only NEWS when the title also carries a hard news verb (a revelation, exit, deal…).
export const INTERVIEW_CHAT = /\b(opens? up (about|on)|discuss(es)?\b|reflects? on|talks? about|sits? down (with|for)|in conversation|gets? candid|weighs? in on)\b/i;
export const HARD_NEWS_VERB = /\b(joins?|cast(s|ed)?|exits?|quits?|leaves?|dies|dead|sues?|lawsuit|arrested|charged|fired|signs?|confirms?|announces?|reveals? (his|her|their|the|a)|renew(s|ed)?|cancel(s|ed|led)?|sets?|lands?|acquires?|teases? (a|the|new)|drops? (a|the|new))\b/i;
// SPICE EXEMPTION (owner 2026-07-18): quote-news with a conflict/revelation verb ("Zendaya slams…",
// "Damon breaks silence…") IS wanted news — the interview guard drops only flat evergreen chat.
const { isSpicy, isStatementBeat } = await import("../lib/spice.mjs");
const interviewOnly = (t) => INTERVIEW_CHAT.test(t) && !HARD_NEWS_VERB.test(t) && !isSpicy(t);
// BEAT BOUNDARY (owner 2026-07-19): celebrity OPINION/STATEMENT stories — politics, race, social
// causes, "star speaks out about X" — belong to the separate celebrity-statement automation, not to
// news. We decline them so two lanes never chase the same story. EXEMPTION: if the story is
// unmistakably big news on its own signals (a top-tier outlet AND a strong trending score), the
// owner's "if it's that big of news, then only" rule lets it through.
const statementBeat = (c) => isStatementBeat(c.title || "") && !(Number(c.tier) === 1 && Number(c.velocity || 0) >= 3);
// Platform/viewership patterns hide in the SUMMARY when the headline is coy ("…'Vrach Frankenshteyn' Debuts"
// + summary "will debut on Hulu on August 14") — test title PLUS the summary's first 200 chars for those two.
const withSummary = (c) => `${c.title || ""} ${String(c.summary || c.description || "").slice(0, 200)}`;
// STALE-SOURCE: a feed item older than 72h is not "latest trending" news — it re-enters only as a follow-up.
const tooOld = (c) => { const t = Date.parse(c.publishedAt || c.pubDate || c.isoDate || c.date || ""); return Number.isFinite(t) && Date.now() - t > 72 * 3600e3; };

const freshCandidates = candidates.filter((c) =>
  !published.titles.has(slugKey(c.title)) &&
  !ROUNDUP_REVIEW.test(c.title || "") &&
  !RETRO_OPINION.test(c.title || "") &&
  !SCOPE_JUNK.test(c.title || "") &&
  !DULL_INDUSTRY.test(c.title || "") &&
  !LIVE_EVENT.test(c.title || "") &&
  !BOX_OFFICE.test(c.title || "") &&
  !RELEASE_PLATFORM.test(withSummary(c)) &&
  !VIEWERSHIP.test(withSummary(c)) &&
  !MERCH.test(c.title || "") &&
  !SCHEDULE_GRID.test(c.title || "") &&
  !interviewOnly(c.title || "") &&
  !statementBeat(c) &&
  !tooOld(c) &&
  !JUNK_OUTLETS.has((c.outlet || "").toLowerCase().trim()));
if (candBefore - freshCandidates.length > 0) monitor.stage("dedup", `dropped ${candBefore - freshCandidates.length} already-published candidate(s) by title; ${freshCandidates.length} remain`);
// EXTRACTABILITY-FIRST shortlist (2026-07-04): a clean publisher URL (an RSS main/section feed) extracts to full
// article text; a Google-News CBMi redirect URL does NOT resolve to article text (Jina returns only Google's
// interstitial), so a gnews-only topic starves the faithful writer and editorial-rejects on empty text. gnews is a
// great TRENDING SIGNAL but a poor TEXT source — and the big trending stories are ALSO in our section feeds with
// clean URLs. So we prefer extractable clean-URL candidates into the categorize shortlist (freshest-first within
// each group): the RSS version of a hot story wins over its unextractable gnews duplicate, and MAKE always has text.
const isGnewsRedirect = (c) => { try { return /(^|\.)news\.google\.com$/i.test(new URL(c.url || "").hostname); } catch { return false; } };
const extractable = (c) => !!c.url && !isGnewsRedirect(c);
// BIG-TRENDING title heuristic (owner 2026-07-04: rank the big tentpole stories to the top). Pre-categorize we only
// have the headline, so match the marquee-Hollywood signals a fan actually clicks — box office, a trailer/teaser
// drop, a marquee casting, a reaction, a sequel/franchise/premiere/release beat. Used as a SORT boost (not a
// filter): among extractable candidates, the big trending stories get categorized + queued before the small stuff.
const BIG_TITLE = /\bbox office\b|\bweekend\b|opening (weekend|day|night)|\$\s?\d|\b\d+(\.\d+)?\s?(million|billion)\b|\btrailer\b|\bteaser\b|first look|\bcast(ing|s|ed)?\b|\bto (star|play|direct|lead|helm|join)\b|\bstars? (in|as)\b|\bjoins\b|\bsequel\b|\bprequel\b|\breboot\b|\bfranchise\b|\brenew(ed|al)\b|\bcancel(ed|led|lation)\b|\bpremiere\b|\brelease date\b|\breactions?\b|\bfirst reactions\b|\bopening\b/i;
const bigTitle = (c) => BIG_TITLE.test(c.title || "");
const fresh = freshCandidates.filter((c) => c.ageMin != null).sort((a, b) => {
  const ea = extractable(a) ? 0 : 1, eb = extractable(b) ? 0 : 1;
  if (ea !== eb) return ea - eb;                 // 1) extractable clean-URL candidates first (MAKE needs real text)
  const ba = bigTitle(a) ? 0 : 1, bb = bigTitle(b) ? 0 : 1;
  if (ba !== bb) return ba - bb;                 // 2) then the BIG trending stories (box office / trailer / casting)
  return a.ageMin - b.ageMin;                    // 3) then freshest-first
});
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
  // ENTITY-ONLY same-day dedup (owner 2026-07-06): one story per primaryEntity per posting-day, regardless of
  // eventType — kills the same-person same-day duplicate the eventType-folded key misses (two Vin Diesel 'Fast
  // Forever' posts 2h apart got different eventTypes, so entityKey didn't match; this entity-only window catches it).
  const es = slugKey(t.primaryEntity || "");
  if (es && published.recentEntities.has(es)) return false;
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
// EVENT RADAR (scale-up 2026-07-16, NEWS_REALTIME_SCALE_PLAN §3): autonomous awareness of what's releasing/airing/
// trending — NO manual pinning. Refresh when >6h old (free JSON/RSS sources), then boost every topic inside an
// active window (a film in release week, a show whose episode just aired, an industry-wide surge) and stamp a
// wire-style tierClass. The committed radar.json ALSO feeds the sentinel worker's urgency keywords.
let radar = loadRadar();
if (!radar) {
  try { radar = await buildRadar(); monitor.stage("radar", `rebuilt — ${radar.hotEntities.length} hot entities (top: ${radar.hotEntities.slice(0, 5).join(", ")})`); }
  catch (e) { monitor.stage("radar", `rebuild failed (${String(e?.message || e).slice(0, 80)}) — continuing without boosts`); }
}
for (const t of verified) {
  const rb = radarBoost(t, radar);
  if (rb) { t.priority = (t.priority || 0) + rb.boost; (t.signals ||= {}).radar = rb.boost; t.radarKind = rb.kind; }
  const sType = t.sensitivity === "high" || /death|arrest|lawsuit|divorce|legal/.test(String(t.eventType || ""));
  t.tierClass = sType ? "S" : (rb || (t.verification?.outletCount || 0) >= 3) ? "A" : (t.priority || 0) >= 60 ? "B" : "C";
}
// PACING GOVERNOR window feed (Phase 4): every sweep's scored, eligible candidates enter the rolling 24h
// quantile window (max-score-per-event — dedup/hygiene handled inside recordCandidates). This is what lets the
// scheduler's bar float with the day's real volume instead of a fixed percentile.
try { const _ps = paceLoad(); recordCandidates(_ps, verified); paceSave(_ps); monitor.stage("pacing", `window fed with ${verified.length} scored candidates`); }
catch (e) { monitor.stage("pacing", `window feed failed (non-fatal): ${String(e?.message || e).slice(0, 100)}`); }
let queue = selectDiverse(verified, { n: QUEUE_N, publishableOnly: true, floor: SELECT_FLOOR, minKeep: 3 });
// NEVER PUBLISH 0 (owner 2026-07-06): our niche ALWAYS has something trending — a movie, TV show, musician/music, or
// celebrity story. So the automation must never skip a tick for lack of content. If the strict newsworthiness floor +
// verify left the queue empty, salvage the single best-available NEW, on-brand story (floor 0) so the tick still posts.
// The dedup ledger still applies (never a re-post), and an unconfirmed death/legal (sensitivity:high) is NOT salvaged
// (the hoax guard stays). This trades a notch of the ideal quality bar for guaranteed coverage — exactly the owner's ask.
if (queue.length === 0) {
  const pool = verified.length ? verified : topics.filter((t) => (t.sensitivity || t.verification?.sensitivity) !== "high");
  if (pool.length) {
    scoreTopics(pool);
    queue = selectDiverse(pool, { n: QUEUE_N, publishableOnly: false, floor: 0, minKeep: 1 });
    monitor.stage("select", `NEVER-EMPTY fallback: strict queue was empty → salvaged ${queue.length} best NEW on-brand topic(s) so this tick still posts`);
  } else {
    monitor.stage("select", `WARNING: 0 candidates survived discovery+categorize this run — nothing to salvage (widen discovery)`);
  }
}
// MUSIC QUOTA (owner mandate, enforced 2026-07-17 — the 12h audit measured music at 22% of published output
// vs the ~10% intended share): music keeps only its best ~12% of queue slots; excess is replaced by the next
// best non-music publishable topics so movies/TV lead the mix the way the mandate says.
{
  const cap = Math.max(1, Math.round(queue.length * 0.12));
  const music = queue.filter((t) => t.category === "music");
  if (music.length > cap) {
    const keep = new Set(music.slice(0, cap).map((t) => t.id));
    const dropped = music.length - cap;
    queue = queue.filter((t) => t.category !== "music" || keep.has(t.id));
    const refill = verified.filter((t) => t.category !== "music" && t.verification?.publishable && (t.priority ?? 0) >= SELECT_FLOOR && !queue.some((q) => q.id === t.id)).slice(0, dropped);
    queue.push(...refill);
    monitor.stage("select", `music quota: ${dropped} music topic(s) over the ${cap}-slot cap swapped for ${refill.length} non-music`);
  }
}
monitor.stage("select", `selected ${queue.length}/${QUEUE_N} by trend-priority (floor ${SELECT_FLOOR}; never-empty guarantee on; music capped ~12%)`);

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
