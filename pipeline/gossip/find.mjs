// GOSSIP — FIND (producer). Mirrors the news FIND→MAKE seam (find/findrun.mjs): discover → shortlist → categorize
// → category-guard → APPEND the in-scope topics to a persistent backlog QUEUE (data/gossip/queue.json). It writes
// NOTHING live — MAKE (`gossiprun.mjs --from-find`) drains the queue on the drip. This is the owner's "pending
// stories" backlog: FIND over-produces to build a buffer; MAKE pops the oldest and publishes.
//
// Dedup vs already-PUBLISHED happens at PUBLISH time (the claim-guard in gossiprun) — FIND only avoids queuing the
// SAME discovered story twice (by topic id). discoverImpl/categorizeImpl are injectable so the harness runs offline.
// Run (live): cd site && set -a; . "../.env"; set +a; node pipeline/gossip/find.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverGossip, trendingSearch } from "./discover.mjs";
import { discoverSocial } from "./discoverSocial.mjs";
import { categorizeGossip } from "./categorize.mjs";
import { correctSubjectType } from "./categoryGuard.mjs";
import { attachHeat } from "./heatRadar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const QUEUE_PATH = path.resolve(__dirname, "../../data/gossip/queue.json");

// ── QUEUE (the backlog) ──────────────────────────────────────────────────────────────────────────────────────
export function loadQueue(filePath = QUEUE_PATH) {
  try { const q = JSON.parse(fs.readFileSync(filePath, "utf8")); return Array.isArray(q?.topics) ? q : { topics: [] }; }
  catch { return { topics: [] }; }
}
export function saveQueue(topics, filePath = QUEUE_PATH, builtAt = null) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch { /* dir exists */ }
  fs.writeFileSync(filePath, JSON.stringify({ builtAt, count: topics.length, topics }, null, 2));
  return topics.length;
}
// APPEND fresh topics to the backlog, skipping any already queued (by id). Returns {added, total}.
export function enqueue(freshTopics, { filePath = QUEUE_PATH, nowIso = null } = {}) {
  const q = loadQueue(filePath);
  const have = new Set(q.topics.map((t) => t?.id).filter(Boolean));
  let added = 0;
  for (const t of freshTopics || []) {
    if (t && t.id && !have.has(t.id)) { q.topics.push({ ...t, queuedAt: nowIso }); have.add(t.id); added++; }
  }
  saveQueue(q.topics, filePath, nowIso || q.builtAt);
  return { added, total: q.topics.length };
}
// ── RANKER (Phase 1, deterministic — no LLM): score a topic's DEMAND so the pop takes the story people
// actually care about, not the oldest. Banded per source so RSS items (no engagement field) never starve
// behind any social post; ties fall back to FIFO (oldest queuedAt first) so equal topics keep today's order.
const HOT_CLASS_RE = /\b(feud|shade|split|divorce|break ?up|lawsuit|arrest|charged|court|engaged|engagement|wedding|pregnan|baby|dating|romance|cheating|affair|fired|exits?|walks? out)\b/i;
export function scoreTopic(t, nowMs = Date.now()) {
  if (!t) return 0;
  let score = 0;
  // outlet trust (tier 2 social … 7 wire): established desks carry a baseline so RSS competes with social
  const tier = t.sources?.[0]?.tier ?? 3;
  score += tier >= 7 ? 22 : tier >= 6 ? 18 : tier >= 5 ? 14 : tier >= 4 ? 10 : 6;
  // social engagement (likes+reposts), banded — null (RSS) is NOT zero-worthy, it just adds nothing here
  const eng = t.engagement;
  if (eng != null) score += eng >= 10000 ? 30 : eng >= 1000 ? 20 : eng >= 100 ? 10 : eng >= 20 ? 4 : 0;
  // entity heat (Wikimedia pageview ratio ~1 = normal)
  const heat = t.heat;
  if (heat != null) score += heat >= 5 ? 25 : heat >= 2.5 ? 15 : heat >= 1.5 ? 8 : 0;
  // story-class weight: the hot classes people actually search/click
  if (HOT_CLASS_RE.test(`${t.claim || ""} ${t.title || ""}`)) score += 8;
  // freshness at DISCOVERY + staleness in the QUEUE
  if (t.ageMin != null) score += t.ageMin <= 120 ? 12 : t.ageMin <= 360 ? 8 : t.ageMin <= 720 ? 4 : 0;
  if (t.queuedAt) { const hQ = (nowMs - Date.parse(t.queuedAt)) / 3600e3; if (hQ > 48) score -= 10; else if (hQ > 24) score -= 5; }
  // official record (court/police) = fair-report lane, strong story
  if (t.official) score += 5;
  if (t.viaTrending) score += 4; // already multi-outlet enough to chart on Google News
  return score;
}

// PEEK the queue's best demand score WITHOUT claiming anything (the burst lane's trigger check).
export function peekTopScore({ filePath = QUEUE_PATH, nowMs = Date.now() } = {}) {
  const q = loadQueue(filePath);
  let best = null;
  for (const t of q.topics) { const sc = scoreTopic(t, nowMs); if (!best || sc > best.score) best = { score: sc, id: t.id, entity: t.primaryEntity || "" }; }
  return best; // null when the queue is empty
}

// POP the n BEST-scoring topics and remove them from the file — this IS the claim (a popped topic can't be
// grabbed by an overlapping tick). Score ties keep FIFO (oldest first). Each popped topic carries _score.
export function dequeue(n, { filePath = QUEUE_PATH, nowMs = Date.now() } = {}) {
  const q = loadQueue(filePath);
  const take = Math.max(0, Math.min(n, q.topics.length));
  if (!take) return [];
  const ranked = q.topics
    .map((t, i) => ({ t, i, score: scoreTopic(t, nowMs) }))
    .sort((a, b) => b.score - a.score || a.i - b.i); // stable: equal scores → original (FIFO) order
  const chosen = ranked.slice(0, take);
  const chosenIdx = new Set(chosen.map((c) => c.i));
  saveQueue(q.topics.filter((_, i) => !chosenIdx.has(i)), filePath, q.builtAt);
  return chosen.map((c) => ({ ...c.t, _score: c.score }));
}

// ── FIND (discover → categorize → guard) ─────────────────────────────────────────────────────────────────────
// Returns the in-scope topics (categorizer output). No dedup here; MAKE's claim-guard handles already-published.
// Phase 1 — PRE-CATEGORIZE THIN FILTER (deterministic, free): obvious non-stories never cost a classify
// call, let alone a fetch or an editorial-gate call. Conservative — only unambiguous junk classes.
const JUNK_RE = /\b(horoscope|zodiac|birthday wish|happy birthday|anniversary tribute|giveaway|sweepstake|coupon|promo code|discount|% off|best deals?|shop (the|these|her|his)|on sale|gift guide|recipe|crossword|puzzle|quiz|wordle|listen live|liveblog|photos?: |in photos\b|gallery\b|red.carpet (photos|arrivals)|what to watch tonight|tv listings|horoscopes)\b/i;
export function isJunkCandidate(c) {
  const title = String(c?.title || "");
  if (!title) return true;
  if (JUNK_RE.test(title) || JUNK_RE.test(String(c?.summary || "").slice(0, 200))) return true;
  if (title.length < 15 && !String(c?.summary || "").trim()) return true; // truly nothing to classify (conservative — false positives kill real stories)
  return false;
}

export async function gossipFind({
  discoverImpl, categorizeImpl,
  categoryGuardImpl = correctSubjectType, categoryGuard = false,
  social = true, short = 100, trending = true, trendingImpl, heat = true, heatImpl = attachHeat,
} = {}) {
  const rss = discoverImpl ? await discoverImpl() : await discoverGossip();
  const soc = discoverImpl ? [] : (social ? await discoverSocial() : []);
  // Phase 1 — ONE trending search per FIND run (never RSS-only): stories our desks haven't posted yet.
  const trend = discoverImpl ? [] : (trending ? await (trendingImpl || trendingSearch)({}).catch(() => []) : []);
  // Reserve ~40% of the shortlist for SOCIAL (the speculation lane RSS can't see); categorize scope-filters the rest.
  const rssPool = [...rss, ...trend].filter((c) => !isJunkCandidate(c));
  const socPool = soc.filter((c) => !isJunkCandidate(c));
  const socN = Math.min(socPool.length, Math.round(short * 0.4));
  const shortlist = [...rssPool.slice(0, short - socN), ...socPool.slice(0, socN)];
  const candidates = [...rssPool, ...socPool];
  const all = categorizeImpl ? await categorizeImpl(candidates) : await categorizeGossip(shortlist);
  // CATEGORY GUARD (deterministic): fix any non-musician mislabeled "musician" so it never files under Music.
  if (categoryGuard) for (const t of all) { try { const s = await categoryGuardImpl(t); if (s) t.subjectType = s; } catch { /* keep LLM label */ } }
  // Phase 1 — entity HEAT (free Wikimedia pageview ratio) attached for the ranker. Best-effort, live path only.
  if (heat && !categorizeImpl) { try { await heatImpl(all); } catch { /* heat is a bonus signal */ } }
  return all;
}

// CLI: top up the backlog.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const topics = await gossipFind({ categoryGuard: true });
  const { added, total } = enqueue(topics, { nowIso: new Date().toISOString() });
  console.log(`GOSSIP FIND — ${topics.length} in-scope topics discovered → ${added} new enqueued → backlog now ${total}.`);
}
