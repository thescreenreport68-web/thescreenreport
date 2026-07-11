// INSIDE-STORIES lane config — REV 2 (owner re-direction 2026-07-04, plan = INSIDE_STORIES_AUTOMATION_PLAN.md).
// Identity: AUDIENCE reaction & DISCOURSE — how NORMAL PEOPLE react to / argue about a top story
// (divided, for it, against it) + how CREATORS answer their critics. NOT gossip/speculation (that's
// the gossip lane), NOT death-centric. Accuracy line: LOCK quotes/dates/names/times/titles; the writer
// CRAFTS the discourse narrative around a few REAL anchor posts. Any top story, any source.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS, GATE } from "../config.mjs";

export { MODELS, GATE };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const INSIDE_FORMAT_TAG = "inside";
export const INSIDE_AUTHOR_SLUG = "editorial-team";
export const CONTENT_DIR = path.resolve(__dirname, "../../content/articles");
export const DATA_DIR = path.resolve(__dirname, "../../data/inside");
export const FIND_LEDGER = path.resolve(__dirname, "../../data/find/published.json");

// Verified-accurate-but-B-grade still publishes on the final attempt at >= this (same philosophy as
// the news lane). Below it → held for review.
export const ACCEPT_FLOOR = 65;
export const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS) || 2;
export const MONITOR_WINDOW_HOURS = 72; // discourse builds for days; monitor = UPDATER
export const MAX_ANGLES_PER_STORY = 3;
export const MAX_STORIES_PER_RUN = 10;
export const MAX_EMBEDS = 6; // page weight cap; native quote text is always canonical

// FREE MODE (owner 2026-07-11: "forget embeds; don't spend on Twitter API; quote what people say as
// text"). NO_X skips the paid twitterapi.io search (discovery ranks on free Bluesky/outlets/trends;
// harvest quotes come from free Bluesky + page-scan + Reddit). NO_EMBEDS emits ZERO iframe embeds —
// every reaction is a TEXT quote attributed generically ("one user wrote…"). Both default ON now;
// flip the env to "0" the moment X credits are funded to bring embeds + X search back.
export const NO_X = process.env.INSIDE_NO_X === "1";
export const NO_EMBEDS = process.env.INSIDE_NO_EMBEDS === "1";

export const AI_DISCLOSURE =
  "This article was produced with AI-assisted research and reviewed editorially. Quoted reactions are real public posts and statements; the surrounding analysis is our own.";

// ── THE 4 FORMS (owner-selected) ────────────────────────────────────────────────────────────────
// minAnchors = the ONLY fail-closed floor left: a few REAL public posts/quotes must be gathered before
// we write, so the embeds are real and the sentiment we characterize is honest ("go maximal on the
// narrative, but anchor it"). Everything else the writer crafts.
export const FORMS = {
  // AUDIENCE-FIRST floors (owner 2026-07-10): these two forms are about NORMAL PEOPLE's posts —
  // real audience posts are REQUIRED; an all-critics harvest can never fill them.
  "audience-reaction": {
    label: "How fans/viewers are reacting",
    minFanPosts: 3,
    words: [500, 900],
    flagship: true,
  },
  "the-debate": {
    label: "The one thing the internet is arguing about",
    minAnchors: 3,
    minFanPosts: 2,
    needsBothSides: true, // a "divided/split" framing must show both stances in the anchors
    words: [550, 950],
  },
  "creator-answers-critics": {
    label: "A director/actor responds to the criticism",
    minCreatorQuotes: 1, // the creator's real on-record reply (verbatim, named)
    minAnchors: 2, // the audience criticism it answers
    words: [500, 850],
  },
  "breakout-buzz": {
    label: "Who everyone is suddenly talking about",
    minAnchors: 3,
    words: [600, 1000],
  },
};

// Inside articles route by the story's category; every subcategory below is legal per site.ts.
const CATEGORIES = new Set(["movies", "tv", "streaming", "celebrity", "awards", "music"]);
const SUB_FOR = { movies: "news", tv: "news", celebrity: "news", music: "news", awards: "winners", streaming: "where-to-watch" };
export function routeForStory(story) {
  const c = (story?.category || "").toLowerCase();
  if (CATEGORIES.has(c)) return { category: c, subcategory: SUB_FOR[c] };
  return { category: "celebrity", subcategory: "news" };
}

// ── DISCOURSE-HEAT ranking weights (used by discover.mjs) ────────────────────────────────────────
// num_comments (people ARGUING) is the strongest true-discourse signal; upvotes/popularity anchor
// "is this even a top story"; cross-outlet coverage confirms it's real. Freshness boosts new waves.
// REV 3: tmdbPopularity DEMOTED to a tie-break (0.15 → 0.05) — popularity is "people watch it",
// not "people are arguing about it"; the buzz signals (trends/wiki/reddit) carry the ranking now.
export const HEAT = { redditComments: 1.0, redditScore: 0.05, tmdbPopularity: 0.05, outletCount: 6, freshness: 40 };

// SEO posture (owner: basic-to-moderate ONLY — over-optimizing gets Google-punished; readability +
// engagement are the KPI). Consumed by the writer/gate prompts.
export const SEO = { maxQuestionH2s: 2, note: "basic-to-moderate; readability + engagement first; no keyword stuffing" };
