// BOX-OFFICE lane config — the ONE place for forms, floors, caps, routing, scope + SEO posture.
// Canonical plan: BOX_OFFICE_MULTI_AGENT_PLAN.md. This lane is DECOUPLED from every other lane —
// it imports only shared libs (pipeline/lib/*) + shared config (pipeline/config.mjs); never another
// lane's modules. Identity: the money-and-momentum desk for Hollywood / English-language films
// while they are in theaters (opening, up/down, worldwide+budget context) → the "now streaming"
// exit. Engagement + readability is KPI #1; fidelity-to-source is the accuracy line.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS, GATE } from "../config.mjs";

export { MODELS, GATE };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BOXOFFICE_AUTHOR_SLUG = "editorial-team";
export const CONTENT_DIR = path.resolve(__dirname, "../../content/articles");
export const DATA_DIR = path.resolve(__dirname, "../../data/boxoffice");
export const REVIEW_DIR = path.resolve(DATA_DIR, "review");

// Verified-faithful-but-B-grade still publishes on the final attempt at >= this (same philosophy as
// the news + inside lanes). Below it → held for review.
export const ACCEPT_FLOOR = 68;
// 3 self-heal passes (was 2): detect → correct/cut → re-check, so the automation rectifies its OWN
// mistakes (fabrication, hedge, drop-spin) and publishes clean without a human, instead of holding.
// COST LEVER (§4.4): one draft + ONE surgical correction pass — the old 3-attempt loop was the single
// biggest spend line (writer+QA retries = ~80% of a failed tick's cost).
export const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS) || 2;

// ── THE FORMS (step-1 set) — floors are fail-closed ──────────────────────────────────────────────
// STEP 1 builds the in-theater box-office forms + the now-streaming exit. NETFLIX-TOP10 / TRENDING-TV
// (streaming ranks + Netflix parse) are LATER increments — NOT defined here (see plan §17 / §3).
// words = a CEILING, never a floor: a thin story is a short, tight brief. No padding.
export const FORMS = {
  "BO-OPENING": {
    label: "A Hollywood film opens / posts its first weekend",
    category: "movies", subcategory: "box-office", formatTag: "box-office",
    words: [350, 550],
    needsOpeningNumber: true, // ≥1 opening/weekend figure from the trade report
  },
  "BO-UPDATE": {
    label: "A material move in an in-theater film (weekend actuals, hold/drop %, milestone, overtake)",
    category: "movies", subcategory: "box-office", formatTag: "box-office",
    words: [300, 500],
    needsNewNumber: true, // a NEW number that moved + a fresh angle
  },
  "NOW-STREAMING": {
    label: "A tracked film leaves theaters / hits PVOD or a streaming platform",
    category: "streaming", subcategory: "where-to-watch", formatTag: "streaming",
    words: [300, 500],
    needsPlatform: true, // confirmed platform (TMDB watch-providers or outlet) + a gross figure/date
  },
  // ── STEP 3: STREAMING forms (`streaming:true`). Discovery is Netflix Top 10 (first-hand hours) +
  // TMDB trending TV, NOT the box-office trade path — the finder builds these deterministically. The
  // watch-hours guard holds: a stated hours number is allowed ONLY for a Netflix title (its own data)
  // or a named outlet; every other platform is rank-only.
  "NETFLIX-TOP10": {
    label: "Netflix Top 10 this week — a title leading with its real hours viewed",
    category: "streaming", subcategory: "best-of-streaming", formatTag: "streaming",
    words: [350, 550],
    streaming: true, needsHours: true, // Netflix's own weekly hours-viewed data
  },
  "TRENDING-TV": {
    label: "A trending TV series people are talking about (platform + rank; hours only if Netflix/named source)",
    category: "tv", subcategory: "news", formatTag: "streaming",
    words: [350, 550],
    streaming: true, needsPlatform: true, // a confirmed platform + a trending signal (Netflix rank / trade)
  },
};

// Box-office forms are what the finder's LLM classifies theatrical films into; streaming forms are
// built deterministically from Netflix/TMDB data (never LLM-assigned to a theatrical film).
export const BOX_OFFICE_FORMS = Object.keys(FORMS).filter((k) => !FORMS[k].streaming);
export const STREAMING_FORMS = Object.keys(FORMS).filter((k) => FORMS[k].streaming);

// eventType "boxoffice" makes the article eligible for the homepage BREAKING badge (plan §14).
export const EVENT_TYPE = "boxoffice";

// ── SCOPE GUARD — Hollywood / English-language ONLY (plan §10.3). Reuses the SCOPE_JUNK idea from the
// news lane but kept LOCAL so the lane never imports another lane's module. A film is in-scope when
// its TMDB original_language is English (or a small allied set) AND nothing screams non-Hollywood.
export const SCOPE_LANGS = new Set(["en"]);
export const SCOPE_JUNK = /\b(bollywood|tollywood|kollywood|hindi|telugu|tamil|kannada|malayalam|punjabi|bhojpuri|nollywood|k-?drama|korean box office|cdrama|c-?drama|anime film japan|lakh|crore|₹|nett india)\b/i;

// scopeOk(film) — film: { originalLanguage, title, overview }. Deterministic, no network.
export function scopeOk(film = {}) {
  const lang = (film.originalLanguage || film.original_language || "").toLowerCase();
  if (lang && !SCOPE_LANGS.has(lang)) return false;
  const blob = `${film.title || ""} ${film.overview || ""}`;
  if (SCOPE_JUNK.test(blob)) return false;
  return true;
}

// ── CAPS / kill switch (mirrors the inside lane orchestrator) ─────────────────────────────────────
export const MAX_ARTICLES_PER_DAY = Number(process.env.BOXOFFICE_MAX_PER_DAY) || 20;
// MIX (owner: 15 box-office / 5 streaming per day). The streaming cap protects the box-office majority — once
// 5 streaming pieces are out, further ticks publish box-office only (a thin-box-office day means fewer than 20
// total, never a streaming-flooded 20; the mix is the contract, and we NEVER fabricate box-office to pad it).
export const STREAMING_DAILY_CAP = Number(process.env.BOXOFFICE_STREAMING_CAP) || 5;
export const MAX_RUN_COST_USD = Number(process.env.BOXOFFICE_MAX_RUN_COST_USD) || 0.5;
// DAILY spend ceiling (owner cost mandate): live ticks refuse to start a paid run once the LA-day total
// crosses this — at target economics 20/day costs ~$0.25-0.35, so $1.50 is a generous 4-5× safety margin
// that still makes a runaway regression LOUD (::warning::) instead of a silent month-end surprise.
export const DAILY_SPEND_CAP_USD = Number(process.env.BOXOFFICE_DAILY_SPEND_CAP_USD) || 1.5;
// FLOOD CAP: never dump N near-identical box-office pieces in one tick (plan §6). The orchestrator's
// per-run `limit` is the burst cap; default 1 for the lean unit.
export const FLOOD_CAP = Number(process.env.BOXOFFICE_FLOOD_CAP) || 3;

// SEO posture (owner: LIGHT + natural only — over-optimizing is a DEFECT; readability + engagement
// are the KPI). Consumed by the writer/QA prompts + the assemble finisher.
export const SEO = { metaTitleMin: 45, metaTitleMax: 55, metaDescMin: 140, metaDescMax: 160, minFaqs: 2, maxQuestionH2s: 2, note: "light+natural; readability+engagement first; never stuff keywords" };
// A film winding down / released long ago is NOT a box-office story (owner: don't post about films from months
// ago). Only cover the ACTIVE box office — films still grossing at least this much per day. The daily chart's
// long tail (a $1.8K/day film 67 days in) is excluded here.
export const DAILY_GROSS_FLOOR = Number(process.env.BOXOFFICE_DAILY_GROSS_FLOOR) || 50000;
