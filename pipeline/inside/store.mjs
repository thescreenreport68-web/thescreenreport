// Inside-lane state: cross-run dedup (never the same eventSlug×form twice — the owner's #1
// never-repost rule) + parked angles (under-floor harvests retried next cycle while the reaction
// wave builds) + what the monitor needs to re-harvest (trigger/angle snapshots).
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.inside.mjs";

const STORE_PATH = path.join(DATA_DIR, "store.json");
const CAP = 4000;

export const insideKey = (parentEventSlug, form) => `${parentEventSlug || "no-event"}|${form}`;

// The orchestrator's run clock is epoch ms, callers elsewhere pass a Date — accept either, because a
// number reaching .toISOString() throws inside the park path and silently loses the park record.
const asDate = (d) => (d instanceof Date ? d : new Date(d));

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

// A never-repost rule must be scoped to what the slug actually NAMES. A headline-derived slug names ONE
// event ("brenda-fricker-dies-at-81") — one article, forever. A WORK-derived slug ("the-odyssey-2026") is
// a title that keeps trending with genuinely NEW events, so blocking it forever retires the film from the
// lane after a single article. Since discovery re-surfaces the same ~20 trending titles every tick, the
// permanent form starved the pool: the 07-19 audit found 69 "already published" skips across 6 ticks and
// 2 articles from 9 runs. Work slugs now clear after a cooldown; the same-event guard is recentDuplicate.
const WORK_SLUG_RX = /-(?:19|20)\d{2}$/;
export const isWorkScoped = (slug) => WORK_SLUG_RX.test(String(slug || ""));
export const PUBLISH_COOLDOWN_H = 48;

export function alreadyPublished(store, parentEventSlug, form, { now = new Date() } = {}) {
  const k = insideKey(parentEventSlug, form);
  const rec = store.published.find((r) => r.key === k);
  if (!rec) return false;
  if (!isWorkScoped(parentEventSlug)) return true; // one event → one article, permanently
  if (!rec.at) return true;
  // Cooldown matches recentDuplicate's window, so a work returning after it is necessarily a new wave
  // and still has to clear the event-level duplicate check before it can publish.
  return +now - +new Date(rec.at) < PUBLISH_COOLDOWN_H * 3600e3;
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
  ("fans fan react reacts reacting reaction reactions respond responds response split splits divided divide chokehold groan groaning groans joke jokes joking meltdown everyone buying viewers viewer audience audiences internet says say said reveal reveals revealed love loves hate hates hype teaser trailer official watch stream streaming episode episodes season seasons series show shows movie movies film films cast casting release releases date dates set sets drops drop back again new first look " +
   // Generic CONTENT/EVENT vocabulary. Two unrelated stories share these constantly — a BTS streaming
   // record and a Roblox lore video collided on {video, single}, an album announcement on {announce,
   // album, video}. They describe the shape of a story, never WHICH story it is (07-19 audit).
   "video videos single singles album albums announce announces announced announcement share shares shared record records song songs music sound star stars sets day days night lore update updates custom effects icon icons detail details moment moments deep peak brutal every one two").split(/\s+/));
export function subjectTokens(text) {
  return new Set(
    String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
      .filter((w) => (w.length >= 4 || /^\d{4}$/.test(w)) && !DEDUP_STOP.has(w) && !DEDUP_GENERIC.has(w)));
}
// Tokens that NAME the subject. No length floor — short names ("BTS", "SZA") are exactly the ones a
// ≥4-char filter drops, and those are the stories that then collide on generic words.
export function entityTokens(text) {
  return new Set(
    String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
      .filter((w) => w && !DEDUP_STOP.has(w) && !DEDUP_GENERIC.has(w)));
}
// Returns the matching recent record if `story` re-reports an event we already published inside `windowH`
// hours, else null. Two conditions, both required: enough shared tokens, AND at least one of them names
// a SUBJECT. Token overlap alone is not evidence of a duplicate — it was blocking real stories (a BTS
// Spotify record and an Entheos album both read as duplicates of a Roblox article they share no subject
// with, on {video, single} and {announce, album, video}).
// Note on what this deliberately does NOT try to do: token counts cannot separate "same subject, same
// event" from "same subject, NEW event" — the true re-report (Colman Domingo/Tiana vs Colman Domingo/
// Princess and the Frog) and the false one (The Odyssey's $120M opening vs an AI-budget piece) both
// share exactly two subject tokens and zero event tokens. So this stays on the safe side of the owner's
// never-repost rule and blocks both; the work-slug cooldown above is what lets a genuinely new wave
// about a recurring title through once the window has passed.
export function recentDuplicate(store, story, { now = new Date(), windowH = 48, minShared = 2 } = {}) {
  const nowMs = +now;
  const cand = subjectTokens(`${story.primaryEntity || ""} ${story.parentTitle || story.headline || ""}`);
  if (cand.size < minShared) return null;
  const candSubj = entityTokens(`${story.primaryEntity || ""} ${story.work?.title || ""}`);
  for (const r of store.published) {
    if (!r.at || nowMs - +new Date(r.at) > windowH * 3600e3) continue;
    const prev = subjectTokens(`${r.primaryEntity || ""} ${r.title || ""} ${r.trigger?.parentTitle || ""}`);
    const shared = [...cand].filter((w) => prev.has(w));
    if (shared.length < minShared) continue;
    const prevSubj = entityTokens(`${r.primaryEntity || ""} ${r.trigger?.work?.title || ""}`);
    if (!shared.some((w) => candSubj.has(w) || prevSubj.has(w))) continue;
    return r;
  }
  return null;
}

// rec: { parentEventSlug, form, slug, title, primaryEntity, eventType, at, angle, trigger }
// angle+trigger snapshots are stored so monitor.mjs can re-run the exact same harvest for top-ups.
export function recordInsidePublished(store, rec, { now = new Date() } = {}) {
  now = asDate(now);
  const key = insideKey(rec.parentEventSlug, rec.form);
  store.published = store.published.filter((r) => r.key !== key);
  store.published.push({ key, at: now.toISOString(), updatedCount: 0, ...rec });
  save(store);
}

export function bumpUpdated(store, slug, { now = new Date() } = {}) {
  now = asDate(now);
  const r = store.published.find((x) => x.slug === slug);
  if (r) { r.updatedCount = (r.updatedCount || 0) + 1; r.updatedAt = now.toISOString(); save(store); }
}

// Parked angles: harvest ran but the floor wasn't met (early in the wave). Retried on later runs;
// give up after maxTries so a ripple that never materialized doesn't poll forever.
// A park records "no reactions YET" (or a transient retrieval failure) — it is never proof that a story
// is permanently unwritable. Exhausting the tries used to set dead:true FOREVER, which had two costs:
// reaction waves that build slowly were locked out, and stories killed by bugs stayed dead after the bug
// was fixed (the 07-19 audit found supergirl-2026 dead from the very work-admission bug fixed that day,
// with 17 dead tags supplying 28 skips across 6 ticks). A dead angle now revives after PARK_REVIVE_H.
export const PARK_REVIVE_H = 36;
const parkStale = (p, now) => !!p?.at && +now - +new Date(p.at) >= PARK_REVIVE_H * 3600e3;

export function parkAngle(store, parentEventSlug, form, reason, { maxTries = 3, now = new Date() } = {}) {
  now = asDate(now);
  const key = insideKey(parentEventSlug, form);
  let cur = store.parked.find((x) => x.key === key);
  if (cur) {
    // A revived angle starts a FRESH retry cycle; carrying the old count would re-kill it on try one.
    if (parkStale(cur, now)) { cur.tries = 1; cur.dead = false; }
    else cur.tries = (cur.tries || 1) + 1;
    cur.reason = reason; cur.at = now.toISOString();
  } else { cur = { key, parentEventSlug, form, reason, tries: 1, at: now.toISOString() }; store.parked.push(cur); }
  if (cur.tries >= maxTries) cur.dead = true;
  save(store);
  return cur.tries;
}

export function parkedTries(store, parentEventSlug, form, { now = new Date() } = {}) {
  const p = store.parked.find((x) => x.key === insideKey(parentEventSlug, form));
  if (!p) return 0;
  if (parkStale(p, now)) return 0;
  return p.dead ? Infinity : p.tries || 0;
}

export function clearParked(store, parentEventSlug, form) {
  store.parked = store.parked.filter((x) => x.key !== insideKey(parentEventSlug, form));
  save(store);
}
