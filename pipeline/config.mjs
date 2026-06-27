// Central config for the automation pipeline — the one place to tune models, taxonomy, thresholds.

export const MODELS = {
  // Cheap, reliable classifier (App. P categorization engine).
  classifier: "google/gemini-2.5-flash-lite",
  // ── THE PRODUCTION JUDGE — runs on EVERY article, so it MUST be cheap (FIND_HALF_PLAN §7.2). ──
  // HARD RULE (owner, 2026-06-27): NEVER Opus / GPT-5-class / any premium model as the judge at runtime —
  // it would blow the $40-60/mo budget in a day. The cheap model is PROMPTED (in gate.mjs) to do the
  // fabrication-catching + reader-quality scoring an expensive model would.
  judge: "google/gemini-2.5-flash-lite",
  // Cheap-ONLY escalation ladder if flash-lite ever under-delivers on the §7.5 validation (NO Opus):
  //   flash-lite (cheapest) → llama-4-maverick (~$0.0017/call) → gemini-2.5-flash (~$0.0039/call, ceiling).
  judgeFallbacks: ["meta-llama/llama-4-maverick", "google/gemini-2.5-flash"],
  // Back-compat aliases for older dev scripts (bakeoff.mjs, verify.mjs) → both point at the cheap judge now.
  // The one-time generator bake-off historically used Opus as a neutral referee; that is RETIRED — Opus is
  // never wired at runtime again.
  judgeProd: "google/gemini-2.5-flash-lite",
  judgeBakeoff: "google/gemini-2.5-flash-lite",
  // Generation bake-off roster. The PRODUCTION generator must be a "cheap" tier winner;
  // the "benchmark" model is only the quality ceiling for comparison — never used in production.
  candidates: [
    { id: "qwen/qwen3-235b-a22b-2507", tier: "cheap", cost: [0.09, 0.1] },
    { id: "deepseek/deepseek-v3.2", tier: "cheap", cost: [0.23, 0.34] },
    { id: "google/gemini-2.5-flash-lite", tier: "cheap", cost: [0.1, 0.4] },
    { id: "openai/gpt-4.1-mini", tier: "cheap", cost: [0.4, 1.6] },
    { id: "meta-llama/llama-4-maverick", tier: "cheap", cost: [0.15, 0.6] },
    { id: "anthropic/claude-sonnet-4.6", tier: "benchmark", cost: [3, 15] },
  ],
  // Winning CHEAP generator (bake-off: best quality + accuracy at ~$0.001/article, beat the premium benchmark).
  generator: "deepseek/deepseek-v3.2",
};

// Taxonomy (kept in sync with site/lib/site.ts SUBCATEGORIES).
export const TAXONOMY = {
  movies: ["rankings-lists", "explainers", "trailers", "reactions", "news", "box-office"],
  tv: ["rankings-lists", "trailers", "reactions", "news"],
  streaming: ["best-of-streaming", "where-to-watch"],
  celebrity: ["profiles-careers", "interviews", "news"],
  reviews: ["movie-reviews", "tv-reviews"],
  awards: ["winners", "predictions"],
};

export const GATE = { publishMin: 80, infoGainMin: 7 };
export const AUTHOR_SLUG = "editorial-team";
export const SITE_URL = "https://thescreenreport.com";
