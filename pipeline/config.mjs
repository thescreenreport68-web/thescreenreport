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
  // The INDEPENDENT WEB reality-check (lib/webVerify.mjs) — a CHEAP model + OpenRouter's web-search plugin verifies
  // the article's load-bearing specifics (roles/numbers/dates) against the LIVE web, the one thing a bundle-only
  // check can't do. gemini-2.5-flash for the role/plot reasoning; STILL a cheap-tier model (owner hard rule: NEVER
  // premium). ~1 web-grounded call/article (~$0.012-0.02 incl. web results). Set WEB_VERIFY=0 to disable.
  webVerify: "google/gemini-2.5-flash",
  // Cheap-ONLY escalation ladder if flash-lite ever under-delivers on the §7.5 validation (NO Opus):
  //   flash-lite (cheapest) → llama-4-maverick (~$0.0017/call) → gemini-2.5-flash (~$0.0039/call, ceiling).
  judgeFallbacks: ["meta-llama/llama-4-maverick", "google/gemini-2.5-flash"],
  // Winning CHEAP generator (bake-off: best quality + accuracy at ~$0.001/article, beat the premium benchmark).
  // (The bake-off harness + candidate roster were retired 2026-07-03 — models are LOCKED; the owner hard rule
  // stands: NEVER a premium model at runtime.)
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

// Brand-new-site strategy (2026-07-01, owner): ZERO audience → prioritize VOLUME of accurate trending news over a
// premium quality bar. ACCURACY stays strict (verify-gate + accuracy floor UNCHANGED — no fake news), but the SOFT
// quality bar is lowered so a real, accurate, engaging-enough story publishes instead of being held for a B-grade
// sub-score. publishMin 80→70, infoGainMin 7→5.
export const GATE = { publishMin: 70, infoGainMin: 5 };
export const AUTHOR_SLUG = "editorial-team";
