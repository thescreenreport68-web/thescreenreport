// Persistent state (plan §6.2) — all under site/data/ig/. Plain inspectable JSON.
import fs from "node:fs";
import path from "node:path";
import { IG } from "../config.mjs";
import { readJson, writeJson, ensureDir, todayInTz } from "./util.mjs";

const F = {
  posted: () => path.join(IG.dataDir, "posted.json"),
  daily: () => path.join(IG.dataDir, "daily-state.json"),
  insights: () => path.join(IG.dataDir, "ledger", "insights.jsonl"),
  weights: () => path.join(IG.dataDir, "weights.json"),
  lexicon: () => path.join(IG.dataDir, "lexicon.json"),
  provenance: (slug) => path.join(IG.dataDir, "asset-provenance", `${slug}.json`),
  audioProv: () => path.join(IG.dataDir, "audio-provenance.json"),
};

// ── never-repost ledger (per-story; the old lane's ledger is read too — READ-ONLY)
export function loadPosted() {
  return readJson(F.posted(), { posts: [] });
}
// FULLY INDEPENDENT of the old video automation (owner 2026-07-13): this lane owns IG/FB/YouTube, the
// old one keeps ONLY Pinterest — different platforms, so a story the old lane posted must NOT be
// skipped here. We no longer read its ledger at all → zero cross-automation interaction or exchange.
export function isPosted(slug) {
  return loadPosted().posts.some((p) => p.slug === slug);
}
export function recordPosted(entry) {
  const led = loadPosted();
  led.posts.push({ ...entry, at: new Date().toISOString() });
  writeJson(F.posted(), led);
}
export function savePosted(led) {
  writeJson(F.posted(), led);
}

// ── holds ledger (persists across CI runs so a failing story is not rebuilt daily)
const holdsFile = () => path.join(IG.dataDir, "holds.json");
export function recordHold(slug, stage, reason) {
  const h = readJson(holdsFile(), {});
  h[slug] = { stage, reason, at: new Date().toISOString() };
  writeJson(holdsFile(), h);
}
export function isHeld(slug) {
  return Boolean(readJson(holdsFile(), {})[slug]);
}
export function clearHold(slug) {
  const h = readJson(holdsFile(), {});
  delete h[slug];
  writeJson(holdsFile(), h);
}

// ── built ledger: a story that has been BUILT is never rebuilt, even in --no-publish.
// posted.json only records LIVE posts, so without this every no-publish/test run re-picks
// the same top-scored story (the "McConaughey again and again" repetition). (2026-07-11)
const builtFile = () => path.join(IG.dataDir, "built.json");
// significant topic tokens (names/nouns) from a title/entity string — used for cross-run
// TOPIC dedup so the automation doesn't build reel after reel about the SAME event (the
// Taylor Swift wedding produced a dozen gossip articles; we want ONE, then move on). (2026-07-12)
const TOPIC_STOP = new Set(
  "this that with from they have been said after over more most just what were will your when this reveals reportedly during into about could would their there video watch star show says amid says".split(" "),
);
export function topicKey(text) {
  return [...new Set(String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !TOPIC_STOP.has(w)))];
}
export function recordBuilt(slug, topics = []) {
  const b = readJson(builtFile(), {});
  b[slug] = { at: new Date().toISOString(), topics };
  writeJson(builtFile(), b);
}
export function isBuilt(slug) {
  return Boolean(readJson(builtFile(), {})[slug]);
}
// every built story's topic tokens — the scout skips a candidate that overlaps an already-built topic
export function builtTopics() {
  return Object.values(readJson(builtFile(), {})).map((v) => v?.topics || []).filter((a) => a.length);
}
// Count distinct STORIES posted today, NOT ledger rows — a multi-platform story writes one row per
// platform (IG+FB+YT), and the daily cap is about stories/slots, not rows. (multi-platform 2026-07-13)
export function postedToday() {
  const day = todayInTz(IG.slots.postTz);
  return new Set(
    loadPosted().posts.filter((p) => (p.scheduledDay || (p.at || "").slice(0, 10)) === day).map((p) => p.slug),
  ).size;
}
// DISTINCT slot labels already scheduled for a given LA day — lets each per-slot run take the NEXT
// EMPTY slot instead of double-filling one (the 7-runs-per-day model, owner 2026-07-13). Deduped so
// the 3 platform rows for one story count as ONE filled slot. Runs are serialized by the workflow's
// concurrency group, so a prior run's ledger is always committed before the next reads.
export function scheduledSlotsToday(day = todayInTz(IG.slots.postTz)) {
  return [...new Set(
    loadPosted().posts
      .filter((p) => (p.scheduledDay || (p.at || "").slice(0, 10)) === day && p.slot && p.slot !== "breaking")
      .map((p) => p.slot),
  )];
}

// ── one-whole-day guard (the July-9 double-post fix, ported as a fresh impl)
export function dayAlreadyScheduled(day) {
  return readJson(F.daily(), {}).day === day;
}
export function markDayScheduled(day) {
  writeJson(F.daily(), { day, at: new Date().toISOString() });
}

// ── learning ledger (analytics → learner)
export function appendInsight(row) {
  ensureDir(path.dirname(F.insights()));
  fs.appendFileSync(F.insights(), JSON.stringify(row) + "\n");
}
export function readInsights() {
  try {
    return fs.readFileSync(F.insights(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// ── learner weights consumed by the scout + script writer
export function loadWeights() {
  return readJson(F.weights(), { hookStyles: {}, segments: {}, slots: {}, updatedAt: null });
}
export function saveWeights(w) {
  writeJson(F.weights(), { ...w, updatedAt: new Date().toISOString() });
}

// ── pronunciation lexicon (persistent, grows over time)
export function loadLexicon() {
  return readJson(F.lexicon(), {});
}
export function saveLexicon(lex) {
  writeJson(F.lexicon(), lex);
}

// ── provenance (images + music) — takedown defense, costs nothing
export function saveAssetProvenance(slug, assets) {
  writeJson(F.provenance(slug), { slug, assets, at: new Date().toISOString() });
}
export function appendAudioProvenance(entry) {
  const cur = readJson(F.audioProv(), { beds: [] });
  cur.beds.push({ ...entry, at: new Date().toISOString() });
  writeJson(F.audioProv(), cur);
}

export function isPaused() {
  return fs.existsSync(IG.pausedFile);
}
