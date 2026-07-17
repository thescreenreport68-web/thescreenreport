// Box-office lane state: cross-run dedup (never the same eventSlug×form twice — the owner's #1
// never-repost rule) + parked angles (a 3-strike retry budget so a film we couldn't gather stops
// re-running the paid pipeline every tick forever). Mirrors the inside lane's store.
//
// TODO (later increment — the serialization tracker, plan §6): the per-film run ledger
// (tracked.json: days-in-release, last number, last angle, link-chain, materiality across runs)
// lives in tracker.mjs, NOT here. This store only does dedup + park for the lean single unit.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.bo.mjs";

const STORE_PATH = path.join(DATA_DIR, "store.json");
const CAP = 4000;

export const boKey = (eventSlug, form) => `${eventSlug || "no-event"}|${form}`;

export function loadStore(file = STORE_PATH) {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    return { published: s.published || [], parked: s.parked || [], zeroStreak: s.zeroStreak || 0, daySpend: s.daySpend || null, file };
  } catch {
    return { published: [], parked: [], zeroStreak: 0, daySpend: null, file };
  }
}

function save(store) {
  fs.mkdirSync(path.dirname(store.file), { recursive: true });
  const out = { published: store.published.slice(-CAP), parked: store.parked.slice(-500), zeroStreak: store.zeroStreak || 0, daySpend: store.daySpend || null };
  fs.writeFileSync(store.file, JSON.stringify(out, null, 1));
}

// ZERO-PUBLISH ALARM (the 48h silent-burn lesson): count consecutive LIVE ticks that published nothing.
// borun calls this each live tick; at/over the threshold the run emits a GitHub Actions ::warning::
// annotation + flags the report, so a stuck lane is VISIBLE instead of silently burning hourly spend.
export function bumpZeroStreak(store, publishedCount) {
  store.zeroStreak = publishedCount > 0 ? 0 : (store.zeroStreak || 0) + 1;
  save(store);
  return store.zeroStreak;
}

export function alreadyPublished(store, eventSlug, form) {
  const k = boKey(eventSlug, form);
  // Ignore review-mode records: a --review proof must NOT mark the event "already published" and make
  // the first LIVE run skip the very article the owner just approved (mirrors publishedToday's !r.review).
  return store.published.some((r) => r.key === k && !r.review);
}

// The set of story keys already covered — the FINDER uses this to ROTATE to FRESH stories every run
// (the owner's "never publish the same news twice; always find new movies/numbers/titles"). Unlike the
// live-publish gate above, this INCLUDES review previews by default, so testing shows variety and a
// story shown once is not shown again. `titles` also returns the covered film titles (lower-cased) so
// the finder can drop a film covered in ANY form, not just an exact eventSlug×form.
export function coveredEventSlugs(store, { includeReview = true } = {}) {
  const slugs = new Set();
  const titles = new Set();
  for (const r of store.published || []) {
    if (!includeReview && r.review) continue;
    if (r.eventSlug) slugs.add(r.eventSlug);
    if (r.film) titles.add(String(r.film).toLowerCase());
    if (r.title) titles.add(String(r.title).toLowerCase());
  }
  return { slugs, titles };
}

export function recordPublished(store, rec, { now = new Date() } = {}) {
  const key = boKey(rec.eventSlug, rec.form);
  store.published = store.published.filter((r) => r.key !== key);
  store.published.push({ key, at: now.toISOString(), ...rec });
  save(store);
}

export function parkAngle(store, eventSlug, form, reason, { maxTries = 3, now = new Date() } = {}) {
  const key = boKey(eventSlug, form);
  let cur = store.parked.find((x) => x.key === key);
  if (cur) { cur.tries = (cur.tries || 1) + 1; cur.reason = reason; cur.at = now.toISOString(); }
  else { cur = { key, eventSlug, form, reason, tries: 1, at: now.toISOString() }; store.parked.push(cur); }
  // A dead park EXPIRES after 72h — it is a cooldown, not a death sentence. The old permanent park killed
  // 13 of 24 keys (10 of them streaming) and was a top cause of the dead streaming mix: a title that failed
  // three times on a thin news day could never be attempted again, even weeks later with fresh material.
  if (cur.tries >= maxTries) { cur.dead = true; cur.expiresAt = new Date(now.getTime() + 72 * 3600e3).toISOString(); }
  save(store);
  return cur.tries;
}

export function parkedTries(store, eventSlug, form, { now = new Date() } = {}) {
  const p = store.parked.find((x) => x.key === boKey(eventSlug, form));
  if (!p) return 0;
  if (p.dead) {
    // Legacy dead parks (parked before the expiry code) carry no expiresAt — infer 72h from their park
    // time, else they stay dead FOREVER (16 keys, mostly streaming, were permanently locked this way).
    const expMs = p.expiresAt ? Date.parse(p.expiresAt) : (Date.parse(p.at || 0) + 72 * 3600e3);
    if (Number.isFinite(expMs) && now.getTime() > expMs) { p.dead = false; p.tries = 0; save(store); return 0; }
    return Infinity;
  }
  return p.tries || 0;
}

// DAILY SPEND CAP (owner cost mandate): running LA-day spend, persisted in the store. borun refuses to
// start a paid run once the day's total crosses the cap — the lane can never quietly burn again.
const laDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
export function bumpDaySpend(store, usd, { now = new Date() } = {}) {
  const day = laDay(now);
  if (!store.daySpend || store.daySpend.laDay !== day) store.daySpend = { laDay: day, usd: 0 };
  store.daySpend.usd = Number((store.daySpend.usd + (Number(usd) || 0)).toFixed(5));
  save(store);
  return store.daySpend;
}
export function daySpendUsd(store, { now = new Date() } = {}) {
  return store.daySpend && store.daySpend.laDay === laDay(now) ? store.daySpend.usd : 0;
}

export function clearParked(store, eventSlug, form) {
  store.parked = store.parked.filter((x) => x.key !== boKey(eventSlug, form));
  save(store);
}
