// DEV-ONLY (no network): the 2026-07-03 architecture-hole fixes (PART HH.3). Deterministic layers only —
// number-boundary grounding (#2) and the cast/role cross-check (#8). The fail-closed web-check (#1/#9/#6) is
// unit-tested inline in the session run; run: node site/pipeline/scripts/test-arch-fixes.mjs
import { verifyGroundTruth } from "../lib/verifyEngine.mjs";
import { webVerifyArticle } from "../lib/webVerify.mjs";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ FAIL: ") + m); };

console.log("=== #8 cast/role cross-check vs TMDB credits (high-precision) ===");
const topic = { formatTag: "news", primaryEntity: "Supergirl", _titleFacts: { title: "Supergirl", cast: [
  { name: "David Corenswet", character: "Kal-El / Superman" }, { name: "Jason Momoa", character: "Lobo" }, { name: "Milly Alcock", character: "Kara Zor-El" },
] }, facts: [] };
ok(verifyGroundTruth({ title: "x", body: "David Corenswet plays Lobo in the movie." }, topic).contradicted.some((f) => f.layer === "cast"),
   "catches Corenswet-plays-Lobo (TMDB says Superman)");
ok(!verifyGroundTruth({ title: "x", body: "David Corenswet plays Superman and Milly Alcock plays Kara Zor-El." }, topic).contradicted.some((f) => f.layer === "cast"),
   "does NOT flag correct pairings (token overlap)");
ok(!verifyGroundTruth({ title: "x", body: "Some Other Actor plays Brainiac in the film." }, topic).contradicted.some((f) => f.layer === "cast"),
   "does NOT flag an actor TMDB doesn't list (incomplete-cast safe)");

console.log("=== #1/#9/#6 web-check fail-closed + receipts (mocked chat) ===");
const body = "A full news article body. ".repeat(20);
// no evidence at all → ran:false (HOLD)
let r = await webVerifyArticle({ article: { title: "T", body }, topic: { primaryEntity: "X" }, attempts: 2, chatImpl: async () => ({ data: { contradictions: [], checked: [] }, citations: [] }) });
ok(r.ran === false, "no citations + no checks + no contradictions → ran:false (fail-closed HOLD)");
// citations present, no contradictions → ran:true, ok
r = await webVerifyArticle({ article: { title: "T", body }, topic: { primaryEntity: "X" }, attempts: 2, chatImpl: async () => ({ data: { contradictions: [], checked: [] }, citations: ["https://en.wikipedia.org/wiki/X"] }) });
ok(r.ran === true && r.ok === true, "plugin citations present + no contradictions → verified (ran:true, ok)");
// a contradiction WITHOUT a receipt is dropped; WITH a receipt is kept
r = await webVerifyArticle({ article: { title: "T", body }, topic: { primaryEntity: "X" }, attempts: 2, chatImpl: async () => ({ data: { contradictions: [
  { claim: "unbacked wrong thing", problem: "p", correct: "c", confidence: "high" },
  { claim: "backed wrong thing", problem: "p", correct: "c", confidence: "high", source: "https://variety.com/x", quote: "the verbatim proof sentence" },
], checked: [] }, citations: [] }) });
ok(r.contradictions.length === 1 && /backed/.test(r.contradictions[0].claim), "contradiction WITHOUT a receipt is dropped; WITH url+quote is kept (#6)");

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
