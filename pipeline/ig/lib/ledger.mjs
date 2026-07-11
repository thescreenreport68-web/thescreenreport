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
export function isPosted(slug) {
  const mine = loadPosted().posts.some((p) => p.slug === slug);
  if (mine) return true;
  const old = readJson(IG.oldVideoLedger, null); // the old cross-poster's ledger (never written)
  if (Array.isArray(old?.posts)) return old.posts.some((p) => p.slug === slug || p === slug);
  if (Array.isArray(old)) return old.some((p) => p.slug === slug || p === slug);
  if (old && typeof old === "object") return Boolean(old[slug]);
  return false;
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
export function postedToday() {
  const day = todayInTz(IG.slots.postTz);
  return loadPosted().posts.filter((p) => (p.scheduledDay || (p.at || "").slice(0, 10)) === day).length;
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
