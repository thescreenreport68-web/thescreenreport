// DEV-ONLY unit test (no network): prove the NEWS-ONLY fail-closed invariant. canonicalize() is the
// shared clamp called on the FIND side (categorize) AND the MAKE side (run.mjs after classify), so a
// removed form (review/profile/list/interview/explainer/recap/predictions/guide/music-profile/screen-music)
// can NEVER be stamped onto a published topic/frontmatter — it is coerced to a news form + a news silo.
import { canonicalize, NEWS_FORMS } from "../find/categorize.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ FAIL: " + m); } };

const REMOVED_SUBCATS = new Set(["movie-reviews", "tv-reviews", "profiles-careers", "interviews", "rankings-lists", "explainers", "predictions", "best-of-streaming", "profiles-artists", "screen-music"]);

console.log("=== NEWS_FORMS is exactly the 8 trending-news forms ===");
ok(NEWS_FORMS.length === 8, "8 forms");
ok(["news", "box-office", "trailer", "reaction", "watchguide", "awards", "music-news", "music-awards"].every((f) => NEWS_FORMS.includes(f)), "the 8 are the expected set");

console.log("=== every REMOVED form clamps to a news form + a news silo (never a removed subcategory) ===");
for (const [ft, cat, sub] of [
  ["review", "reviews", "movie-reviews"],
  ["profile", "celebrity", "profiles-careers"],
  ["list", "movies", "rankings-lists"],
  ["interview", "celebrity", "interviews"],
  ["explainer", "movies", "explainers"],
  ["recap", "reviews", "tv-reviews"],
  ["predictions", "awards", "predictions"],
  ["guide", "streaming", "best-of-streaming"],
  ["music-profile", "music", "profiles-artists"],
  ["screen-music", "music", "screen-music"],
]) {
  const t = canonicalize({ formatTag: ft, category: cat, subcategory: sub });
  ok(NEWS_FORMS.includes(t.formatTag), `'${ft}' → news form (got '${t.formatTag}')`);
  ok(!REMOVED_SUBCATS.has(t.subcategory), `'${ft}' silo is NOT a removed subcategory (got '${t.category}/${t.subcategory}')`);
}

console.log("=== missing / null / garbage formatTag → news ===");
ok(canonicalize({ category: "movies", subcategory: "news" }).formatTag === "news", "undefined formatTag → news");
ok(canonicalize({ formatTag: null, category: "celebrity", subcategory: "news" }).formatTag === "news", "null formatTag → news");
ok(canonicalize({ formatTag: "tv/animation", category: "tv", subcategory: "x" }).formatTag === "news", "invented formatTag → news");

console.log("=== the 8 news forms are IDEMPOTENT (canonicalize must not corrupt a valid news topic) ===");
for (const [ft, cat, sub] of [
  ["news", "celebrity", "news"],
  ["news", "movies", "news"],
  ["box-office", "movies", "box-office"],
  ["trailer", "tv", "trailers"],
  ["reaction", "movies", "reactions"],
  ["watchguide", "streaming", "where-to-watch"],
  ["awards", "awards", "winners"],
  ["music-news", "music", "news"],
  ["music-awards", "music", "awards"],
]) {
  const t = canonicalize({ formatTag: ft, category: cat, subcategory: sub });
  ok(t.formatTag === ft && t.category === cat && t.subcategory === sub, `${ft} ${cat}/${sub} unchanged (got ${t.formatTag} ${t.category}/${t.subcategory})`);
}

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
