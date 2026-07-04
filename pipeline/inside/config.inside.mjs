// INSIDE-STORIES lane config (plan: INSIDE_STORIES_AUTOMATION_PLAN.md). The lane covers the
// CONFIRMED human ripple around a big event — real on-the-record reactions only. Three-lane
// boundary: NEWS = what happened; GOSSIP = the unconfirmed; INSIDE = how the people around it
// reacted, in their own verifiable words. An unconfirmed "reaction" belongs to gossip, never here.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS, GATE } from "../config.mjs";

export { MODELS, GATE };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const INSIDE_FORMAT_TAG = "inside";
// News-grade lane → the news byline (gossip's alicia-bernard stays gossip-only).
export const INSIDE_AUTHOR_SLUG = "editorial-team";
export const CONTENT_DIR = path.resolve(__dirname, "../../content/articles");
export const DATA_DIR = path.resolve(__dirname, "../../data/inside");
export const FIND_QUEUE = path.resolve(__dirname, "../../data/find/queue.json");
export const FIND_LEDGER = path.resolve(__dirname, "../../data/find/published.json");

// Terminal-accept floor (same philosophy as news run.mjs): verified-accurate but B-grade prose
// still publishes on the final attempt at >= this score; below it → held for review.
export const ACCEPT_FLOOR = 65;
export const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS) || 2;
export const MONITOR_WINDOW_HOURS = 72; // reaction waves build for ~3 days; monitor = UPDATER here
export const MAX_ANGLES_PER_EVENT = 6;
export const MAX_TRIGGERS_PER_RUN = 8;
export const MAX_EMBEDS = 6; // hard embed cap (page weight); native quote text is always canonical

export const AI_DISCLOSURE =
  "This article was produced with AI-assisted research and reviewed editorially. Every reaction is quoted from a public, on-the-record source; coverage is updated as more reactions land.";

// ── THE 6 FORMS ───────────────────────────────────────────────────────────────────────────────
// floors = the fail-closed angle gate: an angle is only WRITTEN if the harvest actually collected
// this much real material ("maximal breadth, grounding-gated" — the owner's rule made mechanical).
export const FORMS = {
  "peer-tributes": {
    label: "Stars react / tributes roundup",
    minNamedVoices: 4,
    words: [900, 1500],
    flagship: true, // inherits the parent event's full trendScore
  },
  "fan-pulse": {
    label: "Fans react / divided fandom",
    minFanPosts: 4,
    needsBothSidesIfDivided: true,
    words: [650, 1100],
    flagship: true,
  },
  "cast-crew-voices": {
    label: "Cast/crew speak out",
    minNamedVoices: 2,
    words: [600, 1000],
  },
  "breakout-spotlight": {
    label: "Who is X everyone's talking about",
    minNamedVoices: 3, // named peers/outlets actually talking about them = the buzz proof
    words: [800, 1400],
  },
  "single-voice": {
    label: "One person's on-record response",
    minNamedVoices: 1,
    minPrimaryQuoteWords: 12, // the full substantive quote, not a 3-word fragment
    words: [400, 650],
  },
  "ripple-effects": {
    label: "Confirmed downstream effects",
    minNamedVoices: 0,
    minConfirmedEffects: 2, // announced, attributable consequences — zero forecasting
    words: [500, 900],
  },
};

// ── TRIGGER CLASSES ───────────────────────────────────────────────────────────────────────────
// Maps the news lane's eventType (queue.json / published.json) → which forms may spawn + tone.
// confirmedOnly: the parent must be CONFIRMED (queue) or already-published news (ledger — it
// cleared the news gates). Deaths NEVER expand unconfirmed (hoax guard, inherited hard rule).
export const TRIGGERS = {
  death:        { forms: ["peer-tributes", "single-voice", "cast-crew-voices", "ripple-effects"], sensitivity: "high", confirmedOnly: true },
  health:       { forms: ["peer-tributes", "single-voice"], sensitivity: "high", confirmedOnly: true },
  legal:        { forms: ["single-voice", "ripple-effects"], sensitivity: "high", confirmedOnly: true },
  arrest:       { forms: ["single-voice", "ripple-effects"], sensitivity: "high", confirmedOnly: true },
  lawsuit:      { forms: ["single-voice", "ripple-effects"], sensitivity: "high", confirmedOnly: true },
  // Life events — the owner's canonical examples (a wedding, etc.). Celebratory tone.
  marriage:     { forms: ["peer-tributes", "fan-pulse", "single-voice", "ripple-effects"], sensitivity: "normal" },
  divorce:      { forms: ["single-voice", "fan-pulse", "ripple-effects"], sensitivity: "normal" },
  breakup:      { forms: ["single-voice", "fan-pulse", "ripple-effects"], sensitivity: "normal" },
  pregnancy:    { forms: ["peer-tributes", "fan-pulse", "single-voice"], sensitivity: "normal" },
  birth:        { forms: ["peer-tributes", "fan-pulse", "single-voice"], sensitivity: "normal" },
  boxoffice:    { forms: ["fan-pulse", "cast-crew-voices", "ripple-effects", "breakout-spotlight"], sensitivity: "normal" },
  award:        { forms: ["peer-tributes", "fan-pulse", "breakout-spotlight", "single-voice"], sensitivity: "normal" },
  cancellation: { forms: ["cast-crew-voices", "fan-pulse", "ripple-effects"], sensitivity: "normal" },
  renewal:      { forms: ["cast-crew-voices", "fan-pulse"], sensitivity: "normal" },
  casting:      { forms: ["fan-pulse", "breakout-spotlight"], sensitivity: "normal" },
  announcement: { forms: ["fan-pulse", "single-voice"], sensitivity: "normal" },
  other:        { forms: ["fan-pulse", "single-voice", "cast-crew-voices"], sensitivity: "normal" },
};

// Life-event triggers whose subject is a PERSON (not a title) — used for the hero-image lane +
// the celebratory tone. (config-level so trigger.mjs and toneFor stay in sync.)
export const LIFE_EVENTS = new Set(["marriage", "divorce", "breakup", "pregnancy", "birth"]);

// ── FAMOUS-ONLY magnitude gate (owner directive 2026-07-03: "focus on the famous targets") ────
// A ripple story only exists when the subject is big enough to HAVE a ripple. An event qualifies
// when EITHER the news corroboration is wide, the FIND priority is high, or TMDB knows the person
// as notable. All three miss → drop, no LLM spent.
export const FAMOUS = {
  minOutlets: 3,
  minPriority: 55,
  // TMDB leg: a fuzzy person-search HIT is not fame (the index is full of popularity-0 crew).
  // The caller must apply this floor — same contract resolveEntity.mjs uses, set at a genuinely-
  // famous bar.
  minTmdbPopularity: 5,
  minKnownFor: 1,
};

// Inside articles inherit the parent's category when it's a real site category; everything else
// routes to celebrity/news (the ripple is about PEOPLE). Subcategory must be LEGAL for the
// category (site.ts SUBCATEGORIES): awards and streaming have no "news" silo.
const CATEGORIES = new Set(["movies", "tv", "streaming", "celebrity", "awards", "music"]);
const SUB_FOR = { movies: "news", tv: "news", celebrity: "news", music: "news", awards: "winners", streaming: "where-to-watch" };
export function routeForTrigger(trigger) {
  const c = (trigger?.category || "").toLowerCase();
  if (CATEGORIES.has(c)) return { category: c, subcategory: SUB_FOR[c] };
  return { category: "celebrity", subcategory: "news" };
}

// Deterministic tone ladder — wired into the writer prompt + judge rubric by sensitivity.
export function toneFor(trigger) {
  if ((trigger?.sensitivity || "normal") === "high") return "somber";
  const t = trigger?.eventType || "";
  if (t === "boxoffice" && /flop|bomb|misses|disappoint/i.test(trigger?.parentTitle || "")) return "respectful-honest";
  if (t === "award" || t === "renewal" || t === "marriage" || t === "pregnancy" || t === "birth") return "celebratory";
  return "neutral-warm";
}
