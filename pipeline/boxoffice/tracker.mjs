// THE SERIALIZATION ENGINE (plan §6) — turns the lane from a one-shot writer into a TRACKER.
// Deterministic, no LLM. It provides:
//   • a per-film RUN LEDGER (data/boxoffice/tracked.json)
//   • the MATERIALITY gate — a BO-UPDATE publishes ONLY when the number is a real NEW story vs the
//     last one we reported (milestone crossed / strong hold / steep fall / cume jump). This is the
//     anti-duplicate-content law: it stops boring near-identical "Day N" pieces that kill dwell time.
//   • a UNIQUE eventSlug per material update, so real weekend/milestone updates are DISTINCT events
//     and are not wrongly dedup-blocked by store.mjs (which keys on eventSlug×form).
//   • the NOW-STREAMING exit trigger — a tracked film that has left theaters and now has a confirmed
//     TMDB platform becomes a NOW-STREAMING candidate.
//   • the LINK-CHAIN — each new piece links our prior coverage of the SAME film.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.bo.mjs";
import { normMoney } from "./moneyGuard.mjs";
import { injectInternalLinks } from "../lib/internalLinks.mjs";

const TRACKED_PATH = path.join(DATA_DIR, "tracked.json");
const FILM_CAP = 3000;
// $ milestones (dollars) that make an update newsworthy the FIRST time they are crossed.
export const MILESTONES = [50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000].map((m) => m * 1e6);

export const trackKey = (film) => String(film?.tmdbId || film?.title || "unknown").toLowerCase();

export function loadTracked(file = TRACKED_PATH) {
  try { const j = JSON.parse(fs.readFileSync(file, "utf8")); return { films: j.films || {}, file }; }
  catch { return { films: {}, file }; }
}
function save(t) {
  fs.mkdirSync(path.dirname(t.file), { recursive: true });
  let films = t.films;
  const keys = Object.keys(films);
  if (keys.length > FILM_CAP) films = Object.fromEntries(keys.slice(-FILM_CAP).map((k) => [k, t.films[k]]));
  fs.writeFileSync(t.file, JSON.stringify({ films }, null, 1));
}

// Best "current number" for a film in integer dollars — from FILM-LABELED fields ONLY (cume / domestic /
// worldwide / openingWeekend / the daily chart's cume). NEVER the raw gathered.numbers grab-bag: a weekend
// roundup carries OTHER films' grosses, and one stray figure poisoned Obsession's baseline at $427M, silently
// blocking all future coverage (materiality demands strictly-higher, so nothing ever cleared it again).
// A ≤3× sanity ratio between labeled candidates drops a figure that dwarfs the film's own domestic reality
// (a wrong-entity TMDB worldwide, a mis-extracted roundup total) instead of letting it become the baseline.
export function currentNumberRaw(gathered = {}, boxData = {}, dailyChart = null) {
  const labeled = [gathered.cume, gathered.worldwide, gathered.domestic, gathered.openingWeekend,
    dailyChart?.cume, boxData.worldwide, boxData.worldwideRaw]
    .map((x) => (typeof x === "number" ? x : normMoney(x)))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!labeled.length) return null;
  // Anchor on the most trustworthy figure (the film's own domestic reality): chart cume > gathered cume/domestic.
  const anchor = [dailyChart?.cume, gathered.cume, gathered.domestic, gathered.openingWeekend]
    .map((x) => (typeof x === "number" ? x : normMoney(x))).find((n) => Number.isFinite(n) && n > 0) || null;
  const sane = anchor ? labeled.filter((n) => n <= anchor * 3) : labeled;
  return Math.max(...(sane.length ? sane : [anchor].filter(Boolean)));
}
const milestonesCrossed = (prevHigh, cur) =>
  MILESTONES.filter((m) => (prevHigh == null || prevHigh < m) && cur != null && cur >= m);
const dropPctOf = (g) => { const n = parseFloat(String(g?.dropPct ?? "").replace("%", "")); return Number.isFinite(n) ? n : null; };
const daysSince = (releaseDate, now) => {
  const d = Date.parse(releaseDate || ""); if (!Number.isFinite(d)) return null;
  return Math.max(0, Math.round((now.getTime() - d) / 86400000));
};

// MATERIALITY — ONLY meaningful for BO-UPDATE. Returns { material, reason, tag, currentRaw }.
// `tag` is the eventSlug discriminator that keeps distinct material updates from dedup-colliding.
export function isMaterial(film, gathered = {}, boxData = {}, tracked = null, { now = new Date() } = {}) {
  const rec = tracked?.films?.[trackKey(film)] || null;
  const prev = rec?.lastNumberRaw ?? null;
  const prevMilestone = rec?.lastMilestone ?? null;
  const cur = currentNumberRaw(gathered, boxData, film?.dailyChart || null);
  const days = rec?.daysInReleaseApprox ?? daysSince(film?.releaseDate, now);

  // FIRST time we cover this film — always a story.
  if (prev == null) return { material: cur != null, reason: cur != null ? "first tracked number" : "no number", tag: `d${days ?? 0}`, currentRaw: cur };

  // 🔴 THE OWNER'S #1 RULE: an UPDATE must have a running total STRICTLY HIGHER than the last number we
  // published for this film. A theatrical gross only goes UP, so a same-or-lower number means we are looking
  // at the SAME or a STALE report (e.g. re-pulling the Day-15 numbers) — that is NOT a new story and must be
  // rejected, so we never re-report Day-15's numbers as a "Day-20" update.
  if (cur == null || cur <= prev)
    return { material: false, reason: `no new number (current ${cur == null ? "unknown" : "$" + Math.round(cur / 1e6) + "M"} not above last published $${Math.round(prev / 1e6)}M)`, tag: null, currentRaw: cur };

  // The number genuinely advanced — a new day's story. Build the headline reason + a DISTINCT dedup tag
  // (prefer the milestone, else the day-in-release, else the new cume) so each fresh update is its own event.
  const reasons = ["cume advanced"];
  const ms = milestonesCrossed(prevMilestone ?? prev, cur);
  let tag = ms.length ? `${Math.round(Math.max(...ms) / 1e6)}m` : (days != null ? `d${days}` : `c${Math.round(cur / 1e6)}m`);
  if (ms.length) reasons.unshift(`crossed $${Math.round(Math.max(...ms) / 1e6)}M`);
  const dp = dropPctOf(gathered);
  if (dp != null && dp < 35) reasons.push(`strong hold (-${dp}%)`);
  else if (dp != null && dp > 55) reasons.push(`steep fall (-${dp}%)`);
  return { material: true, reason: reasons.join("; "), tag, currentRaw: cur };
}

// eventSlug discriminator for a material BO-UPDATE (else store.alreadyPublished blocks every repeat).
export const updateEventSuffix = (mat) => (mat && mat.tag ? `-${mat.tag}` : "");

// A BO-OPENING whose gathered data shows a weekend DROP (only exists after weekend 1) or a cume well
// above the opening is really a LATER-WEEKEND report — not a debut. Used to reclassify so the writer
// never frames a week-2 report as an "opening" (the timeline-consistency fix).
export function isPastOpening(gathered = {}) {
  const dp = String(gathered?.dropPct ?? "").trim();
  if (dp && /\d/.test(dp)) return true; // a weekend drop only exists after weekend 1
  const open = normMoney(gathered?.openingWeekend);
  // a domestic OR worldwide/cume running total meaningfully ABOVE the opening ⇒ past the debut weekend
  // (the gatherer sometimes lands the running total in `domestic`, not `cume`, so check both).
  const beyond = [gathered?.cume, gathered?.domestic].map(normMoney).filter((n) => Number.isFinite(n));
  if (open && beyond.some((n) => n >= open * 1.25)) return true;
  return false;
}

// prior article records for this film, newest-first, capped — the link-chain source.
export function priorArticles(tracked, film, max = 5) {
  const rec = tracked?.films?.[trackKey(film)];
  return (rec?.articles || []).filter((a) => a && a.slug).slice(-max).reverse();
}

// LINK-CHAIN — link the film title in the body to our most-recent prior coverage of the SAME film.
// Deterministic + best-effort (reuses the shared injectInternalLinks). Returns { body, linkedPrior }.
export function linkPriorCoverage(body, tracked, film) {
  try {
    const prior = priorArticles(tracked, film, 1);
    if (!prior.length || !film?.title || !body) return { body, linkedPrior: null };
    const a = prior[0];
    const pick = { slug: a.slug, category: a.category || "movies", anchor: film.title, title: film.title };
    const newBody = injectInternalLinks(body, [pick]);
    return { body: newBody, linkedPrior: newBody !== body ? a.slug : null };
  } catch { return { body, linkedPrior: null }; }
}

// Record a REAL publish into the ledger (call only on a non-dry-run publish).
export function recordArticle(tracked, { film, form, slug, category, gathered = {}, boxData = {}, now = new Date() }) {
  const k = trackKey(film);
  const cur = currentNumberRaw(gathered, boxData, film?.dailyChart || null);
  const rec = tracked.films[k] || {
    tmdbId: film?.tmdbId || null, title: film?.title || "", releaseDate: film?.releaseDate || "",
    firstSeenAt: now.toISOString(), articles: [], status: "in-theaters", lastNumberRaw: null, lastMilestone: null,
  };
  rec.title = film?.title || rec.title;
  rec.releaseDate = film?.releaseDate || rec.releaseDate;
  if (cur != null) rec.lastNumberRaw = Math.max(rec.lastNumberRaw || 0, cur);
  const ms = milestonesCrossed(rec.lastMilestone, cur);
  if (ms.length) rec.lastMilestone = Math.max(rec.lastMilestone || 0, ...ms);
  rec.lastForm = form;
  rec.daysInReleaseApprox = daysSince(rec.releaseDate, now);
  if (form === "NOW-STREAMING") rec.status = "now-streaming-done";
  rec.articles.push({ slug, form, category: category || null, at: now.toISOString(), headlineNumberRaw: cur });
  if (rec.articles.length > 40) rec.articles = rec.articles.slice(-40);
  tracked.films[k] = rec;
  save(tracked);
  return rec;
}

// NOW-STREAMING exit candidates: tracked in-theaters films no longer in now_playing that now carry a
// TMDB-confirmed platform. `providersFor(rec)` → {stream,rent,buy} | null. Never throws.
export async function streamingExits(tracked, nowPlayingIds = [], { providersFor, max = 2 } = {}) {
  const out = [];
  if (!providersFor) return out;
  const inPlay = new Set((nowPlayingIds || []).map((x) => String(x)));
  for (const rec of Object.values(tracked?.films || {})) {
    if (out.length >= max) break;
    if (rec.status !== "in-theaters") continue;
    if (rec.tmdbId && inPlay.has(String(rec.tmdbId))) continue; // still in theaters
    let prov = null;
    try { prov = await providersFor(rec); } catch { prov = null; }
    const has = prov && ((prov.stream && prov.stream.length) || (prov.rent && prov.rent.length) || (prov.buy && prov.buy.length));
    if (!has) continue;
    out.push({
      id: rec.tmdbId, title: rec.title, year: (rec.releaseDate || "").slice(0, 4), releaseDate: rec.releaseDate,
      popularity: 0, voteCount: 0, overview: "", originalLanguage: "en", via: "now-streaming-exit", providers: prov,
    });
  }
  return out;
}
