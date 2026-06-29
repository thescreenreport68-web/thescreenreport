// DEV-ONLY unit test (no network): prove extractQuotes can't FABRICATE, buildGdeltQuery rejects degenerate
// queries, and safeHttpUrl blocks SSRF. Guards the fixes from the Step-0/1/2 audit.
import { extractQuotes, buildGdeltQuery, safeHttpUrl } from "../lib/contentFinder.mjs";

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ FAIL: " + msg); } };

console.log("=== extractQuotes — straight-quote article (the audit's fabrication trap) ===");
const straight = `Supergirl opened to a soft $38 million domestically. "We are disappointed but remain optimistic about the long game," said director Craig Gillespie. The film surprised some analysts who had tracked higher. Studio chief Mike De Luca told reporters, "Supergirl did not meet our box office expectations, but it is one component of a broader strategy." Critics were split. The B-minus CinemaScore raised eyebrows across the industry.`;
const q1 = extractQuotes(straight);
console.log("   ->", JSON.stringify(q1));
ok(q1.length === 2, "captured exactly the 2 real quotes (not narrative)");
ok(q1.some((q) => /disappointed but remain optimistic/.test(q)), "got the Gillespie quote");
ok(q1.some((q) => /did not meet our box office expectations/.test(q)), "got the De Luca quote");
ok(!q1.some((q) => /surprised some analysts|Critics were split|CinemaScore|told reporters/.test(q)), "NO fabricated narrative captured");

console.log("=== extractQuotes — curly quotes ===");
const curly = `Asked about the stunt, she said, “I had to learn to ride a horse in three weeks for this part.” It was grueling.`;
const q2 = extractQuotes(curly);
console.log("   ->", JSON.stringify(q2));
ok(q2.some((q) => /learn to ride a horse/.test(q)), "captured the curly-quote");

console.log("=== extractQuotes — captions / titles / no-quote prose yield NOTHING ===");
ok(extractQuotes(`The sequel "Jackass: Best and Last" hit theaters. Reviews were mixed.`).length === 0, "movie-title caption (no attribution) -> none");
ok(extractQuotes(`Nominees included "THE DARK KNIGHT RISES" and others.`).length === 0, "ALL-CAPS title -> none");
ok(extractQuotes(`Plenty of prose with no quotation marks at all here, just reporting.`).length === 0, "no quotes -> none");

console.log("=== buildGdeltQuery — degenerate -> null; proper -> quoted-entity query ===");
ok(buildGdeltQuery({ query: "" }) === null, "empty -> null");
ok(buildGdeltQuery({ query: "the latest news today" }) === null, "stopword-leading, no entity -> null");
ok(buildGdeltQuery({ query: "box office numbers today" }) === null, "no proper-noun entity -> null (was '\"box\"')");
const g1 = buildGdeltQuery({ primaryEntity: "Supergirl", query: "Supergirl box office opening weekend" });
console.log("   Supergirl ->", g1);
ok(/^"Supergirl" \(/.test(g1), "proper entity -> quoted entity + OR keywords");
const g2 = buildGdeltQuery({ primaryEntity: "Pedro Pascal", query: "Pedro Pascal Fantastic Four casting" });
console.log("   Pedro Pascal ->", g2);
ok(/^"Pedro Pascal"/.test(g2), "primaryEntity respected, no title-split (was '\"Pedro Pascal Fantastic\"')");

console.log("=== safeHttpUrl — SSRF guard ===");
ok(safeHttpUrl("https://variety.com/x") === true, "public https ok");
ok(safeHttpUrl("http://localhost/x") === false, "localhost blocked");
ok(safeHttpUrl("file:///etc/passwd") === false, "file:// blocked");
ok(safeHttpUrl("http://169.254.169.254/") === false, "link-local metadata IP blocked");

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
