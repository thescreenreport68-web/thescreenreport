// Central config for the automation pipeline — the one place to tune models, taxonomy, thresholds.

export const MODELS = {
  // Cheap, reliable classifier (App. P categorization engine).
  classifier: "google/gemini-2.5-flash-lite",
  // Strong, NEUTRAL judge for the bake-off comparison (not a production candidate → no self-bias).
  // One-time use during the bake-off; my own manual review is the real decider.
  judgeBakeoff: "anthropic/claude-opus-4.8",
  // Cheap judge for the per-article production gate (runs on every article → must be cheap).
  judgeProd: "google/gemini-2.5-flash-lite",
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
  movies: ["rankings-lists", "explainers"],
  tv: ["rankings-lists"],
  streaming: ["best-of-streaming", "where-to-watch"],
  celebrity: ["profiles-careers"],
  reviews: ["movie-reviews", "tv-reviews"],
};

export const GATE = { publishMin: 80, infoGainMin: 7 };
export const AUTHOR_SLUG = "editorial-team";
export const SITE_URL = "https://thescreenreport.com";
