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
import { loadJsonState } from "./health.mjs";

const TRACKED_PATH = path.join(DATA_DIR, "tracked.json");
const FILM_CAP = 3000;
// $ milestones (dollars) that make an update newsworthy the FIRST time they are crossed.
export const MILESTONES = [50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000].map((m) => m * 1e6);

export const trackKey = (film) => String(film?.tmdbId || film?.title || "unknown").toLowerCase();

// A missing ledger and an UNREADABLE ledger are completely different conditions, and collapsing them is
// what published 3 duplicate articles: an unreadable tracked.json became `{films:{}}`, so every film we
// had covered looked brand-new. `lost` now says which happened, and borun refuses to publish on a lost
// tick rather than acting amnesiac.
export function loadTracked(file = TRACKED_PATH) {
  const { data, lost } = loadJsonState(file, { films: {} }, { stage: "tracked.json" });
  return { films: data?.films || {}, file, lost };
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

// PER-METRIC figures for the ledger — domestic and worldwide tracked SEPARATELY. The old single-number
// baseline mixed them: it ratcheted to the WORLDWIDE figure, which a film's daily DOMESTIC advance could
// never beat, permanently locking 7 of 8 tracked films out of daily updates (and conversely letting a
// drifting worldwide republish an identical domestic story — the Obsession double-publish).
export function currentMetrics(gathered = {}, boxData = {}, dailyChart = null) {
  const money = (x) => (typeof x === "number" ? x : normMoney(x));
  const domestic = [dailyChart?.cume, gathered.cume, gathered.domestic, gathered.openingWeekend]
    .map(money).find((n) => Number.isFinite(n) && n > 0) ?? null;
  let worldwide = [gathered.worldwide, boxData.worldwide, boxData.worldwideRaw]
    .map(money).find((n) => Number.isFinite(n) && n > 0) ?? null;
  // Sanity: a "worldwide" below domestic, or dwarfing it >5×, is a wrong/mis-attributed figure — drop it.
  if (worldwide != null && domestic != null && (worldwide < domestic || worldwide > domestic * 5)) worldwide = null;
  return { domestic, worldwide };
}
const laDayOf = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
const dropPctOf = (g) => { const n = parseFloat(String(g?.dropPct ?? "").replace("%", "")); return Number.isFinite(n) ? n : null; };
const daysSince = (releaseDate, now) => {
  const d = Date.parse(releaseDate || ""); if (!Number.isFinite(d)) return null;
  return Math.max(0, Math.round((now.getTime() - d) / 86400000));
};

// MATERIALITY — ONLY meaningful for BO-UPDATE. Returns { material, reason, tag, currentRaw }.
// `tag` is the eventSlug discriminator that keeps distinct material updates from dedup-colliding.

// Last DOMESTIC figure we actually published for this film, read from the append-only publish ledger
// (store.published). Used only as a fail-closed backstop when tracked.json has lost the film's record.
// Prefers an explicit recorded figure; falls back to parsing the deterministic daily-update slug
// ("…-adds-<x>-as-domestic-total-hits-<N>-<M>-million" / "…-domestic-total-climbs-to-<N>-<M>-million").
export function lastPublishedRawFor(film, ledger) {
  const rows = Array.isArray(ledger) ? ledger : (ledger?.published || null);
  if (!rows) return null;
  const key = trackKey(film);
  let best = null;
  for (const r of rows) {
    if (r?.review) continue;
    // Match on the RECORDED key first (written at publish time, identical to trackKey(film)); fall back
    // to a title-derived key for legacy rows. The old code ONLY built a title key, so a film carrying a
    // tmdbId — whose trackKey IS the tmdbId — never matched any row and always read as "never published".
    const rowKey = r.filmKey || (r.tmdbId ? String(r.tmdbId).toLowerCase() : null) || (r.film || r.title ? trackKey({ title: r.film || r.title }) : null);
    if (rowKey !== key) continue;
    let raw = Number.isFinite(r.headlineNumberRaw) ? r.headlineNumberRaw
      : Number.isFinite(r.currentRaw) ? r.currentRaw : null;
    if (raw == null && r.slug) {
      const m = String(r.slug).match(/(?:domestic-total-(?:climbs-to|hits)|as-domestic-total-hits)-(\d+)(?:-(\d+))?-million/);
      if (m) raw = Math.round((parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 10 : 0)) * 1e6);
    }
    if (Number.isFinite(raw)) {
      const fromSlug = !Number.isFinite(r.headlineNumberRaw) && !Number.isFinite(r.currentRaw);
      if (best == null || raw > best.raw) best = { raw, fromSlug };
    }
  }
  return best;
}

export function isMaterial(film, gathered = {}, boxData = {}, tracked = null, { now = new Date(), publishedLedger = null } = {}) {
  const rec = tracked?.films?.[trackKey(film)] || null;
  const dc = film?.dailyChart || null;
  const m = currentMetrics(gathered, boxData, dc);
  // DOMESTIC is the tracking metric (the daily chart is a domestic chart); worldwide only tracks a film
  // with no domestic data at all. The two baselines never mix (the lockout/double-publish root cause).
  const cur = m.domestic ?? m.worldwide;
  const prev = m.domestic != null ? (rec?.lastDomesticRaw ?? null) : (rec?.lastWorldwideRaw ?? null);
  const prevMilestone = rec?.lastMilestone ?? null;
  // Day-in-release: the chart's own day number is authoritative (the old releaseDate-only fallback stamped
  // d0 on 7 of 9 live articles); releaseDate math is the fallback.
  const chartDay = dc?.dayInRelease ? (String(dc.dayInRelease).match(/\d+/) || [null])[0] : null;
  const days = chartDay != null ? Number(chartDay) : (rec?.daysInReleaseApprox ?? daysSince(film?.releaseDate, now));

  // FIRST time we track this metric for this film — always a story, but FAIL CLOSED.
  // `tracked.json` is wholesale-rewritten state, and a rebase conflict on the runner can discard it
  // (registry §3.1). When that happens a film we covered yesterday looks brand-new and republishes the
  // SAME day with the SAME number: 3 duplicate pairs reached the live site this way — disclosure-day
  // d34 and young-washington d13 both twice with byte-identical domestic totals. So before believing
  // "never seen it", cross-check the PUBLISH LEDGER (store.published), which is append-only and survives
  // a lost ledger. If it already carries an article for this film, that article's number is the baseline.
  if (rec == null || prev == null) {
    const prior = lastPublishedRawFor(film, publishedLedger);
    if (prior != null) {
      // A slug only encodes 0.1M precision ("…-36-5-million" for $36,541,620), so the SAME figure would
      // read as "higher" than its own rounded baseline and republish — which is exactly how young-washington
      // d13 shipped twice with byte-identical totals. Compare at the baseline's real precision.
      const q = prior.fromSlug ? 1e5 : 1;
      const curQ = cur == null ? null : Math.floor(cur / q);
      const priorQ = Math.floor(prior.raw / q);
      if (!(curQ != null && curQ > priorQ)) {
        return { material: false, reason: `no new number (ledger: ${cur} not above published ${prior.raw})`, tag: `d${days ?? 0}`, currentRaw: cur };
      }
      // Genuinely higher than what we last published → a real update, not a first sighting.
      return { material: true, reason: "new number vs publish ledger (tracker state was lost)", tag: `d${days ?? 0}`, currentRaw: cur };
    }
    return { material: cur != null, reason: cur != null ? "first tracked number" : "no number", tag: `d${days ?? 0}`, currentRaw: cur };
  }

  const ms = milestonesCrossed(prevMilestone ?? prev, cur);
  // ONE update per film per LA day (owner's freshness contract) — a second same-day update is only a story
  // when a milestone crossed since the morning's piece.
  if (rec.lastArticleAt && laDayOf(new Date(rec.lastArticleAt)) === laDayOf(now) && !ms.length)
    return { material: false, reason: "already covered today (one update per film per day)", tag: null, currentRaw: cur };

  // 🔴 THE OWNER'S #1 RULE: an UPDATE must have a running total STRICTLY HIGHER than the last number we
  // published for this film ON THE SAME METRIC. A theatrical gross only goes UP, so a same-or-lower number
  // means a same/stale report — never re-report Day-15's numbers as a "Day-20" update.
  if (cur == null || cur <= prev)
    return { material: false, reason: `no new number (current ${cur == null ? "unknown" : "$" + Math.round(cur / 1e6) + "M"} not above last published $${Math.round(prev / 1e6)}M)`, tag: null, currentRaw: cur };

  // The number genuinely advanced — a new day's story. Build the headline reason + a DISTINCT dedup tag
  // (prefer the milestone, else the day-in-release, else the new cume) so each fresh update is its own event.
  const reasons = ["cume advanced"];
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
  const dc = film?.dailyChart || null;
  const m = currentMetrics(gathered, boxData, dc);
  const cur = m.domestic ?? m.worldwide;
  const rec = tracked.films[k] || {
    tmdbId: film?.tmdbId || null, title: film?.title || "", releaseDate: film?.releaseDate || "",
    firstSeenAt: now.toISOString(), articles: [], status: "in-theaters",
    lastNumberRaw: null, lastDomesticRaw: null, lastWorldwideRaw: null, lastMilestone: null, lastArticleAt: null,
  };
  rec.title = film?.title || rec.title;
  rec.releaseDate = film?.releaseDate || rec.releaseDate;
  // Per-metric ratchets — domestic and worldwide NEVER mix (the baseline-poisoning root cause).
  if (m.domestic != null) rec.lastDomesticRaw = Math.max(rec.lastDomesticRaw || 0, m.domestic);
  if (m.worldwide != null) rec.lastWorldwideRaw = Math.max(rec.lastWorldwideRaw || 0, m.worldwide);
  if (cur != null) rec.lastNumberRaw = Math.max(rec.lastNumberRaw || 0, cur); // legacy display field only
  const ms = milestonesCrossed(rec.lastMilestone, cur);
  if (ms.length) rec.lastMilestone = Math.max(rec.lastMilestone || 0, ...ms);
  rec.lastForm = form;
  rec.lastArticleAt = now.toISOString(); // the one-update-per-film-per-day gate reads this
  const chartDay = dc?.dayInRelease ? (String(dc.dayInRelease).match(/\d+/) || [null])[0] : null;
  rec.daysInReleaseApprox = chartDay != null ? Number(chartDay) : daysSince(rec.releaseDate, now);
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
