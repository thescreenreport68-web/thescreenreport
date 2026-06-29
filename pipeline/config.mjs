// Central config for the automation pipeline — the one place to tune models, taxonomy, thresholds.

export const MODELS = {
  // Cheap, reliable classifier (App. P categorization engine).
  classifier: "google/gemini-2.5-flash-lite",
  // ── THE PRODUCTION JUDGE — the final fact-verifier + quality scorer; runs on EVERY article + drives the
  // rewrite loop. UPGRADED to gemini-2.5-flash (owner-approved 2026-06-29): a live bake-off vs gpt-4.1-mini +
  // flash-lite showed flash-lite FAILS JSON-parse on a clean article and missed real fabrications, while
  // gemini-2.5-flash caught 4/4 planted + a bonus, fastest (4s), clean JSON, ~$0.005-0.009/call (~$60-90/mo at
  // 300/day — within the ≤$100-200/mo ceiling). It is a CHEAP-TIER model: the HARD RULE STILL HOLDS — NEVER
  // Opus / GPT-4o / GPT-5-class / any premium model at runtime (those are $400-4000/mo). The deterministic verify
  // gate (lib/verifyGate.mjs) does the heavy fabrication-catching on the cheap `verify` model below, so this judge
  // is the capable independent second opinion, spent ONCE per article. (Gemini via OpenRouter = PAID tier, no training.)
  judge: "google/gemini-2.5-flash",
  // The CHEAP model for the universal verify gate's claim-extraction + entailment (lib/verifyGate.mjs) — it does
  // deterministic-heavy work a cheap model handles fine, so the higher judge spend stays one call per article.
  verify: "google/gemini-2.5-flash-lite",
  // Cheap-ONLY escalation ladder if flash-lite ever under-delivers on the §7.5 validation (NO Opus):
  //   flash-lite (cheapest) → llama-4-maverick (~$0.0017/call) → gemini-2.5-flash (~$0.0039/call, ceiling).
  judgeFallbacks: ["meta-llama/llama-4-maverick", "google/gemini-2.5-flash"],
  // Back-compat alias for the dev-only generation bake-off (bakeoff.mjs) → points at the cheap judge now.
  // The one-time generator bake-off historically used Opus as a neutral referee; that is RETIRED — Opus is
  // never wired at runtime again.
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
  // MUSIC (decided 2026-06-28, MUSIC_CATEGORY_PLAN.md) — ONE silo, narrow on-brand scope. The
  // popular(6%)-vs-indie(4%) split is an ORTHOGONAL FIND axis (topic.tier), not a subcategory.
  music: ["news", "awards", "profiles-artists", "screen-music"],
};

export const GATE = { publishMin: 80, infoGainMin: 7 };
export const AUTHOR_SLUG = "editorial-team";
export const SITE_URL = "https://thescreenreport.com";
