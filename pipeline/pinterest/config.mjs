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
  freshDays: 10,                                // only pin recent stories
  categories: new Set(["movies", "tv", "celebrity"]),
  perCategoryCap: 3,                            // don't spam one board in a single day's batch

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
