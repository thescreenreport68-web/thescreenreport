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

// ── NEAR-DUPLICATE GUARD (owner 2026-07-16: "The Batman 2 Delayed" + "The Batman Part II Delayed"
// published 2h apart) ──────────────────────────────────────────────────────────────────────────
// The exact-slug dedup above can't see two DIFFERENTLY-WORDED headlines about the SAME event: each
// outlet phrases it differently, so storySlug=slugify(headline) and even primaryEntity differ. This
// catches the re-report by SUBJECT-TOKEN overlap within a recency window. Structural + generic
// reaction/entertainment words are stripped so a match requires a real shared SUBJECT (the work/person)
// PLUS a shared event detail — e.g. {batman, delayed}. A single shared franchise token (spider) can't
// trip it (needs ≥2), so distinct same-franchise stories still pass.
const DEDUP_STOP = new Set(
  "the a an and or but to of in on for at by from with as is are was were be been it its they them their who what which when where why how not no than then so more most very just also into out up off over after amid ahead about this that these those has have had will would can could s t ii iii".split(/\s+/));
const DEDUP_GENERIC = new Set(
  "fans fan react reacts reacting reaction reactions respond responds response split splits divided divide chokehold groan groaning groans joke jokes joking meltdown everyone buying viewers viewer audience audiences internet says say said reveal reveals revealed love loves hate hates hype teaser trailer official watch stream streaming episode episodes season seasons series show shows movie movies film films cast casting release releases date dates set sets drops drop back again new first look".split(/\s+/));
export function subjectTokens(text) {
  return new Set(
    String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
      .filter((w) => (w.length >= 4 || /^\d{4}$/.test(w)) && !DEDUP_STOP.has(w) && !DEDUP_GENERIC.has(w)));
}
// Returns the matching recent record if `story` re-reports an event we already published inside `windowH`
// hours (≥ minShared significant subject tokens in common), else null.
export function recentDuplicate(store, story, { now = new Date(), windowH = 48, minShared = 2 } = {}) {
  const nowMs = +now;
  const cand = subjectTokens(`${story.primaryEntity || ""} ${story.parentTitle || story.headline || ""}`);
  if (cand.size < minShared) return null;
  for (const r of store.published) {
    if (!r.at || nowMs - +new Date(r.at) > windowH * 3600e3) continue;
    const prev = subjectTokens(`${r.primaryEntity || ""} ${r.title || ""} ${r.trigger?.parentTitle || ""}`);
    let shared = 0;
    for (const w of cand) if (prev.has(w)) shared++;
    if (shared >= minShared) return r;
  }
  return null;
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
