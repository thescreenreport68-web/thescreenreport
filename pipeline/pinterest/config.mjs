// PINTEREST IMAGE-PIN AUTOMATION — config. Separate lane; posts static news cards (not videos) to Pinterest.
// Locked design = "The Literary" (owner-approved 2026-07-14). Cheap-models-only hard rule. See PINTEREST_AUTOMATION_PLAN.md.
import path from "node:path";
const SITE = process.env.TSR_SITE || "/Users/sivajithcu/Movie News site/site";
const ROOT = path.dirname(SITE);

export const PIN = {
  // ── models (cheap only — never premium at runtime)
  copyModel: "google/gemini-2.5-flash",        // copywriter: hook headline + condensed dek
  copyFallback: "deepseek/deepseek-v3.2",
  seoModel: "google/gemini-2.5-flash",         // SEO: keyword-rich pin title + description
  visionModel: "google/gemini-2.5-flash-lite", // image relevance + finished-card QC (vision)
  curateModel: "google/gemini-2.5-flash-lite", // pin-worthiness score

  // ── cadence (start small on a new account; ramp later)
  dailyCount: Number(process.env.PIN_COUNT || 5),
  freshDays: 7,                                 // only pin recent stories (latest + trending)
  // every content category maps to one of our 3 boards (see boardFor); music/awards/streaming included
  categories: new Set(["movies", "tv", "celebrity", "streaming", "music", "awards"]),
  perCategoryCap: 3,                            // board health: never more than 3 of 5 pins to one board
  fallbackTrend: 20,                            // score for un-scored articles (gossip) → only fill if too few trending

  // ── design / render
  chrome: process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  python: process.env.PIN_PYTHON || `${ROOT}/video-venv/bin/python`, // for QC downscale (PIL); QC skips if absent
  width: 1000,
  height: 1500,

  // ── paths (TSR_SITE overrides for CI)
  root: ROOT,
  site: SITE,
  articlesDir: `${SITE}/content/articles`,
  publishedLedger: `${SITE}/data/find/published.json`,
  gossipStore: `${SITE}/data/gossip/store.json`,
  workDir: `${SITE}/data/pinterest/work`,
  outDir: `${SITE}/data/pinterest/out`,
  ledger: `${SITE}/data/pinterest/pinned.json`,   // dedup: slugs we've already pinned
  stateFile: `${SITE}/data/pinterest/daily-state.json`,
  stopFile: `${SITE}/data/pinterest/POSTING_OFF`, // touch to pause

  articleBase: "https://thescreenreport.com",
};
