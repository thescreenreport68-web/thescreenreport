// DEV-ONLY unit test (no network): prove the content-finder trust-gate fixes (Phase A+B review G1/G2/G3) — a
// single outlet arriving via BOTH the inline (gnews display name) and extracted (publisher domain) paths must
// collapse to ONE independent owner, and a tabloid must NOT satisfy the major-outlet bar.
import { canonOwner, tierFor, inlineSource } from "../lib/contentFinder.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ FAIL: " + m); } };

console.log("=== G3: a tabloid is tiered 'tabloid', not 'major' (can't satisfy the major-outlet trust bar) ===");
ok(tierFor("tmz.com").tier === "tabloid", "tmz.com → tabloid (was wrongly 'major' because it is in DOMAIN_OWNER)");
ok(tierFor("pagesix.com").tier === "tabloid", "pagesix.com → tabloid");
ok(tierFor("variety.com").tier === "major", "variety.com → still major");
ok(tierFor("bleedingcool.com").tier === "other", "an unlisted real outlet → other");

console.log("=== G1: one 'other' outlet via inline (display name) + extracted (domain) collapses to ONE owner ===");
const inlineBC = inlineSource({ outlet: "Bleeding Cool", tier: 5, url: "https://news.google.com/rss/articles/XYZ", summary: "A real sentence of reporting about the casting news that is plenty long enough." });
ok(inlineBC && inlineBC.url === null, "a gnews redirect url → url-less inline source (tiered by outlet, not the redirect host)");
ok(canonOwner(inlineBC.owner) === canonOwner("bleedingcool.com"),
  `inline 'Bleeding Cool' (${canonOwner(inlineBC.owner)}) collapses with extracted 'bleedingcool.com' (${canonOwner("bleedingcool.com")}) → ONE owner, gate-bypass closed`);

console.log("=== G2: a major outlet via inline (gnews) + extracted (domain) collapses to its parent owner ===");
const inlineVar = inlineSource({ outlet: "Variety", tier: 7, url: "https://news.google.com/rss/articles/ABC", summary: "Variety reports the studio has set a release date for the long-delayed sequel." });
ok(inlineVar.tier === "major", "inline Variety keeps major tier");
ok(canonOwner(inlineVar.owner) === canonOwner(tierFor("variety.com").owner),
  `inline Variety owner (${canonOwner(inlineVar.owner)}) === extracted variety.com owner (${canonOwner(tierFor("variety.com").owner)}) → not double-counted`);

console.log("=== a real article URL on an inline source is kept + tiered by its publisher domain ===");
const inlineUrl = inlineSource({ outlet: "Bleeding Cool", tier: 5, url: "https://bleedingcool.com/some-story/", summary: "Bleeding Cool has the first look at the new trailer and breaks down what it reveals about the plot." });
ok(inlineUrl.url === "https://bleedingcool.com/some-story/" && inlineUrl.tier === "other", "an unlisted publisher URL is kept on the inline source + tiered 'other'");

console.log("=== too-thin summary (<40 chars) yields no inline source ===");
ok(inlineSource({ outlet: "Variety", tier: 7, url: null, summary: "Short." }) === null, "a bare-label summary → null (not grounding)");

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
