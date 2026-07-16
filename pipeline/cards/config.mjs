// CARDS lane — daily Hollywood news IMAGE cards to Instagram + Facebook.
// Design system: owner-locked "Breaking Banner" (Design D, 2026-07-16) — photo top,
// ink band bottom, red category tab bridging the seam, hook headline + detail sub-line.
// Plan: IMAGE_CARDS_AUTOMATION_PLAN.md ; research: IMAGE_POST_AUTOMATION_RESEARCH.md
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..", "..");

export const CARDS = {
  // ── canvas (plan §8 Q1: 4:5 default — ~30% more feed height; grid-crops safely.
  //    "square" kept as a one-line switch until the owner's Phase-0 sign-off.)
  aspect: process.env.CARDS_ASPECT === "square" ? "square" : "4x5",
  canvas: {
    "4x5": { w: 1080, h: 1350, photoH: 796 },
    square: { w: 1080, h: 1080, photoH: 618 },
  },

  // ── category tab system (plan §2). BOX OFFICE = money already EARNED (owner rule
  //    2026-07-16: presales/tracking for unreleased films are NEWS, never BOX OFFICE).
  //    somber → charcoal tab, no red accent, engagement levers OFF in captions.
  categories: {
    breaking: { label: "BREAKING", somber: false },
    news: { label: "NEWS", somber: false },
    "first-look": { label: "FIRST LOOK", somber: false },
    "box-office": { label: "BOX OFFICE", somber: false },
    streaming: { label: "STREAMING", somber: false },
    tv: { label: "TV", somber: false },
    celebrity: { label: "CELEBRITY", somber: false },
    awards: { label: "AWARDS", somber: false },
    music: { label: "MUSIC", somber: false },
    quote: { label: "ON THE RECORD", somber: false },
    memoriam: { label: "IN MEMORIAM", somber: true },
  },

  // ── brand tokens (site tailwind palette; red lifted for dark grounds like the reels lane)
  ink: "#101010",
  red: "#D92128",
  redOnDark: "#FF453C",
  charcoal: "#333333",
  subGray: "#B9BCC4",
  creditGray: "rgba(255,255,255,0.62)",

  // ── models (locked roster — automation-hard-constraints; never premium at runtime)
  models: {
    scout: ["google/gemini-2.5-flash-lite", "inclusionai/ling-2.6-flash"],
    gather: ["google/gemini-2.5-flash-lite", "qwen/qwen3.5-flash-02-23"],
    classify: ["google/gemini-2.5-flash-lite", "inclusionai/ling-2.6-flash"],
    writer: ["deepseek/deepseek-v3.2", "google/gemini-2.5-flash"],
    verify: ["google/gemini-2.5-flash-lite", "openai/gpt-5-nano"],
    vision: ["google/gemini-2.5-flash-lite", "qwen/qwen3.5-flash-02-23"],
  },

  // ── volume & cadence (plan §5 — phased ramp; quota guard is NON-NEGOTIABLE)
  slots: {
    perDay: Number(process.env.CARDS_PER_DAY || 10), // phase 1: 8-10; 20 only after quota confirmed ≥50
    topTopicShare: 0.6, // owner mandate: ~60% of slots on the day's dominant topic
    postTz: "America/Los_Angeles",
    windowStartH: 7, // 07:00 LA
    windowEndH: 23, // 23:00 LA
    minGapMin: 45,
    jitterMin: 7,
    minPublishGapMin: 10, // hard floor between feed publishes (normal operation)
  },
  breaking: {
    maxPerDay: 4, // BREAKING-tab budget — the siren stays meaningful (plan §4)
    maxBurst: 3, // ≤3 cards within 15 min
    maxBurstsPerDay: 2,
    minPublishGapSec: 180, // ≥3 min between publish calls inside a burst
  },

  // ── image sourcing (plan/research §7 — account safety. Tier A compose freely;
  //    Tier B = own-post screenshot framing; everything else FAIL CLOSED.)
  imageTiers: {
    // domains whose og:image/article images are studio-issued press assets (Tier A carriers)
    tierACarriers: [
      "variety.com", "deadline.com", "hollywoodreporter.com", "thewrap.com",
      "ew.com", "people.com", "editorial.rottentomatoes.com", "comicbook.com",
      "collider.com", "nerdist.com", "slashfilm.com", "indiewire.com",
      "media-cldnry.s-nbcnews.com", "image.tmdb.org",
    ],
    minWidth: 800,
  },

  // ── zernio (same verified account pair as the reels lane)
  zernio: {
    base: "https://zernio.com/api/v1",
    igAccountId: "6a49d2b69d9472faae7e109f", // The Screen Report IG (verified 2026-07-05)
    fbAccountId: "6a49d30b9d9472faae7e1258", // The Screen Report Facebook Page (verified 2026-07-05)
    // isAiGenerated: NOT set for cards — real photos + typeset text are not AI-generated media
    // (Zernio changelog 2026-06-23: the flag is for AI media, not AI-written captions).
  },
  platforms: (process.env.CARDS_PLATFORMS || "instagram,facebook").split(",").map((s) => s.trim()).filter(Boolean),

  // ── IG content-publishing quota guard (plan §5): Meta docs disagree (100 vs 50) and
  //    Zernio's blog says 25/24h INCLUDING reels — so we always keep this reserve.
  quota: { reserve: 2, igUserIdEnv: "IG_USER_ID", tokenEnv: "IG_GRAPH_TOKEN" },

  // ── hosting (same tsr-media repo as reels; own dir)
  host: { repo: "thescreenreport68-web/tsr-media", dir: "cards", pruneDays: 14 },

  // ── paths (state ONLY under site/data/cards/)
  dataDir: path.join(SITE, "data", "cards"),
  workDir: path.join(SITE, "data", "cards", "work"),
  ledgerPath: path.join(SITE, "data", "cards", "ledger.json"),
  slatePath: path.join(SITE, "data", "cards", "slate.json"),
  assetsDir: path.join(HERE, "assets"),
  articlesDir: path.join(SITE, "content", "articles"),

  // headline/caption contracts (research §5/§6)
  headline: { maxWords: 12, maxLines: 3 },
  caption: { igMaxHashtags: 5, igHookChars: 125 },

  siteBase: "https://thescreenreport.com",
  handle: "@THESCREENREPORT",
};
