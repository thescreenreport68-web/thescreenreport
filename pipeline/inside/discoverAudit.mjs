// DISCOVER-AUDIT (owner: "review what the finder finds BEFORE it writes"). Runs discovery ONLY —
// no gathering, no writing, no cost beyond the free signal calls — and prints the ranked story
// candidates with their REAL X-popularity evidence (how many posts already have 100+ likes, the
// single most-liked reaction, total engagement). This is the "let the finder find, then rate it"
// checkpoint. Run: cd site && set -a; . ../.env; set +a; node pipeline/inside/discoverAudit.mjs
import { discoverStories } from "./discover.mjs";

const stories = await discoverStories({});
console.log(`\n=== FINDER PICKS — ${stories.length} candidates, ranked by real X popularity ===\n`);
stories.forEach((s, i) => {
  const g = s.signals || {};
  const pop = g.xPopular != null
    ? `X: ${g.xPopular} posts @100+ likes · top ${g.xMaxLikes || 0} likes · ${g.xSumLikes || 0} total`
    : "X: (not measured — rank>8)";
  console.log(`${String(i + 1).padStart(2)}. [heat ${String(s.discourseHeat).padStart(3)}] ${(s.headline || s.primaryEntity).slice(0, 72)}`);
  console.log(`     cat=${s.category} form-kind=${s.kind} via=${s.via}${g.animeAdjacent ? " ANIME-DEMOTED" : ""}`);
  console.log(`     ${pop}${g.outlets ? ` · ${g.outlets} outlets` : ""}${g.trend ? " · search-trend" : ""}${g.wiki ? ` · wiki ${Math.round(g.wiki / 1000)}k` : ""}\n`);
});
// Machine-readable line for programmatic capture.
console.log("JSON:" + JSON.stringify(stories.map((s) => ({
  headline: s.headline || s.primaryEntity, slug: s.storySlug, category: s.category, heat: s.discourseHeat,
  xPopular: s.signals?.xPopular ?? null, xMaxLikes: s.signals?.xMaxLikes ?? null, xSumLikes: s.signals?.xSumLikes ?? null,
  anime: !!s.signals?.animeAdjacent,
}))));
