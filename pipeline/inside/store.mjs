// Inside-lane state: cross-run dedup (never the same eventSlug×form twice — the owner's #1
// never-repost rule) + parked angles (under-floor harvests retried next cycle while the reaction
// wave builds) + what the monitor needs to re-harvest (trigger/angle snapshots).
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.inside.mjs";

const STORE_PATH = path.join(DATA_DIR, "store.json");
const CAP = 4000;

export const insideKey = (parentEventSlug, form) => `${parentEventSlug || "no-event"}|${form}`;

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

export function alreadyPublished(store, parentEventSlug, form) {
  const k = insideKey(parentEventSlug, form);
  return store.published.some((r) => r.key === k);
}

// rec: { parentEventSlug, form, slug, title, primaryEntity, eventType, at, angle, trigger }
// angle+trigger snapshots are stored so monitor.mjs can re-run the exact same harvest for top-ups.
export function recordInsidePublished(store, rec, { now = new Date() } = {}) {
  const key = insideKey(rec.parentEventSlug, rec.form);
  store.published = store.published.filter((r) => r.key !== key);
  store.published.push({ key, at: now.toISOString(), updatedCount: 0, ...rec });
  save(store);
}

export function bumpUpdated(store, slug, { now = new Date() } = {}) {
  const r = store.published.find((x) => x.slug === slug);
  if (r) { r.updatedCount = (r.updatedCount || 0) + 1; r.updatedAt = now.toISOString(); save(store); }
}

// Parked angles: harvest ran but the floor wasn't met (early in the wave). Retried on later runs;
// give up after maxTries so a ripple that never materialized doesn't poll forever.
export function parkAngle(store, parentEventSlug, form, reason, { maxTries = 3, now = new Date() } = {}) {
  const key = insideKey(parentEventSlug, form);
  let cur = store.parked.find((x) => x.key === key);
  if (cur) { cur.tries = (cur.tries || 1) + 1; cur.reason = reason; cur.at = now.toISOString(); }
  else { cur = { key, parentEventSlug, form, reason, tries: 1, at: now.toISOString() }; store.parked.push(cur); }
  // The entry stays (dead:true) rather than being removed — parkedTries needs it to report the
  // angle as permanently exhausted, otherwise the next run would start the retry cycle over.
  if (cur.tries >= maxTries) cur.dead = true;
  save(store);
  return cur.tries;
}

export function parkedTries(store, parentEventSlug, form) {
  const p = store.parked.find((x) => x.key === insideKey(parentEventSlug, form));
  return p?.dead ? Infinity : p?.tries || 0;
}

export function clearParked(store, parentEventSlug, form) {
  store.parked = store.parked.filter((x) => x.key !== insideKey(parentEventSlug, form));
  save(store);
}
