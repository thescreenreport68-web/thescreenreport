// DEV-ONLY (no network): the 2026-07-03 restructure libs — the unified cutter (body + takeaways + FAQ +
// structured fields), the deterministic polish pass, and the specifics guard. Run: node site/pipeline/scripts/test-restructure-libs.mjs
import { cutArticle } from "../lib/cutter.mjs";
import { dedupeSentences, trimIncomplete } from "../lib/polish.mjs";
import { specificsGuard } from "../lib/specificsGuard.mjs";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ FAIL: ") + m); };

console.log("=== cutter: one pass over body + takeaways + FAQ + structured fields ===");
const art = {
  body: "Seth Rogen spoke about the film. The movie earned $72.5 million in its opening weekend. He praised the cast.\n\n## What next?\nMore news soon. According to Variety the deal closed.",
  keyTakeaways: ["The movie earned $72.5 million opening weekend", "Seth Rogen praised the cast"],
  faq: [{ q: "How much did it earn?", a: "It earned $72.5 million in its opening weekend." }, { q: "Who spoke?", a: "Seth Rogen discussed the project." }],
  boxOffice: { worldwide: "$1.2B", domestic: "$72.5 million", budget: "$100M" },
  records: ["Biggest July opening with $72.5 million", "First film of the trilogy"],
};
cutArticle(art, ["The movie earned $72.5 million in its opening weekend", "according to Variety"]);
ok(!art.body.includes("72.5"), "body: flagged $72.5M sentence cut");
ok(!art.body.toLowerCase().includes("according to variety"), "body: short attribution phrase cut (substring matcher)");
ok(art.body.includes("praised the cast"), "body: unflagged sentence survives");
ok(art.keyTakeaways.length === 1 && !art.keyTakeaways[0].includes("72.5"), "keyTakeaways: flagged bullet removed (audit D3)");
ok(art.faq.length === 1 && art.faq[0].q === "Who spoke?", "faq: flagged Q&A removed (audit D3)");
ok(!art.boxOffice.domestic, "boxOffice.domestic: cut via numeric-core field match");
ok(art.boxOffice.worldwide === "$1.2B" && art.boxOffice.budget === "$100M", "system-supplied worldwide/budget NEVER cut");
ok(art.records.length === 1 && art.records[0] === "First film of the trilogy", "records: poisoned entry cut, clean entry kept");

console.log("=== polish: dedupe + truncation trim ===");
const dup = "Reps did not respond to a request for comment.\n\nThe deal is big news for the studio. It reshapes the slate.\n\nRepresentatives did not respond to requests for comment.";
ok(!/did not respond[\s\S]*did not respond/i.test(dedupeSentences(dup)), "second no-comment boilerplate collapsed");
ok(trimIncomplete("A complete sentence here. And a trailing fragment that never") === "A complete sentence here.", "trailing fragment dropped");
ok(trimIncomplete("Solid para one.\n\n## Heading\n\n- list item").includes("## Heading"), "markdown structure preserved");

console.log("=== specifics guard: numbers + outlet attributions vs the grounding ===");
const sources = [{ text: "The film opened to $72.5 million this weekend, Variety reported. It began production in 2023.", quotes: [], owner: "PMC", domain: "variety.com", outlet: "Variety" }];
const topic = { facts: [{ title: "CURRENT DATE", extract: "Today is July 2026." }], sources: [{ outlet: "Variety" }] };
const good = { title: "Film opens big", body: "The film earned $72.5 million, according to Variety. Production started in 2023. As of July 2026 it leads.", keyTakeaways: [], faq: [] };
ok(specificsGuard(good, sources, topic).ok, "grounded figures + attribution pass clean");
const bad = { title: "Film opens big", body: "The film earned $85 million, according to Deadline. It cost $200 million to make.", keyTakeaways: [], faq: [] };
const g2 = specificsGuard(bad, sources, topic);
ok(!g2.ok && g2.bad.some((b) => b.text.includes("85")), "ungrounded $85M caught");
ok(g2.bad.some((b) => /deadline/i.test(b.text)), "invented 'according to Deadline' caught");
ok(g2.bad.some((b) => b.text.includes("200")), "ungrounded $200M caught");

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
