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
    return { published: s.published || [], parked: s.parked || [], file };
  } catch {
    return { published: [], parked: [], file };
  }
}

function save(store) {
  fs.mkdirSync(path.dirname(store.file), { recursive: true });
  const out = { published: store.published.slice(-CAP), parked: store.parked.slice(-500) };
  fs.writeFileSync(store.file, JSON.stringify(out, null, 1));
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
  if (cur.tries >= maxTries) cur.dead = true;
  save(store);
  return cur.tries;
}

export function parkedTries(store, eventSlug, form) {
  const p = store.parked.find((x) => x.key === boKey(eventSlug, form));
  return p?.dead ? Infinity : p?.tries || 0;
}

export function clearParked(store, eventSlug, form) {
  store.parked = store.parked.filter((x) => x.key !== boKey(eventSlug, form));
  save(store);
}
