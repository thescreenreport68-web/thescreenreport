// STEP 5 — VERIFY GATE + SURGICAL SELF-CORRECT + JUDGE BACKSTOP. All offline (mock writer / verify / judge).
// Proves the owner's design: the WRITER finds + fixes its own mistakes FIRST (verify gate → surgical patch, not a
// rewrite); the JUDGE is the BACKUP that catches what slipped through and hands it back for one more pass.
// Run: node pipeline/gossip/test/verify-test.mjs
import { verifyGate, checkCitedEvidence } from "../verifyGate.mjs";
import { runGossip } from "../run.mjs";

let pass = 0, fail = 0;
const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== STEP 5 VERIFY + SELF-CORRECT + JUDGE BACKSTOP ===\n");

const PEOPLE_TEXT = `People has learned that the two stars were spotted together at a Los Angeles restaurant over the weekend. A source close to the pair told People, "They looked very comfortable and were laughing all night." Reps for both did not immediately respond to a request for comment. The outing is the latest in a string of public appearances. `.repeat(3);
const BUNDLE = { sources: [{ outlet: "People", text: PEOPLE_TEXT, tier: 1 }] };
const TOPIC = { primaryEntity: "Star A", subjectType: "celebrity", title: "Star A dating", claim: "Star A and Star B are dating", sources: [{ outlet: "People", text: PEOPLE_TEXT }] };

// A draft that clears legal + quote + quality gates (so the ONLY variable under test is verify/judge).
const cleanArticle = () => ({
  title: "Star A and Star B spark dating buzz, per People",
  dek: "The two were spotted together this weekend.",
  body: "According to People, Star A and Star B were spotted together at a restaurant this weekend, and the internet is already running with it.\n\nA source told People the pair 'looked very comfortable' over what was described as a long, laughter-filled dinner. Reps for both did not immediately comment, so nothing about the nature of their relationship has been confirmed. " + "For now, the sighting is the only concrete thread fans have to pull on, and the rest remains pure speculation. ".repeat(6),
  pullQuote: "looked very comfortable",
  claims: [{ text: "spotted together at a restaurant", sourceQuote: "spotted together at a Los Angeles restaurant" }],
  faq: [], keyTakeaways: [], whatWeKnow: ["Spotted together, per People"], whatWeDont: ["Whether they're official"], denial: null,
});

// ── verifyGate: L1 deterministic (cited evidence really in the bundle) ──
{
  const goodCite = checkCitedEvidence({ claims: [{ text: "spotted together", sourceQuote: "spotted together at a Los Angeles restaurant" }] }, BUNDLE);
  check("L1: a claim whose cited evidence IS in the bundle is not flagged", goodCite.unsupported.length === 0);
  const fakeCite = checkCitedEvidence({ claims: [{ text: "They got engaged in Paris", sourceQuote: "the couple confirmed their engagement in Paris last spring" }] }, BUNDLE);
  check("L1: a claim citing FAKE evidence is flagged", fakeCite.unsupported.length === 1, JSON.stringify(fakeCite));
}

// ── verifyGate: L2 (mock LLM) + merge/dedup + severity + degraded ──
{
  const llmFlag = async () => ({ list: [{ claim: "They are engaged", why: "not in the bundle", contradicted: false }], ran: true });
  const v = await verifyGate({ article: cleanArticle(), bundle: BUNDLE, llmImpl: llmFlag });
  check("L2: LLM-found unsupported claim surfaces", !v.ok && v.unsupported.some((u) => /engaged/i.test(u.claim)));

  // L1 + L2 catch the SAME claim → it appears once
  const sameClaimArticle = { ...cleanArticle(), claims: [{ text: "They are engaged", sourceQuote: "the couple confirmed their engagement in Paris" }] };
  const v2 = await verifyGate({ article: sameClaimArticle, bundle: BUNDLE, llmImpl: async () => ({ list: [{ claim: "They are engaged", why: "not in the bundle" }], ran: true }) });
  check("merge de-dupes a claim caught by BOTH layers", v2.unsupported.filter((u) => /engaged/i.test(u.claim)).length === 1, JSON.stringify(v2.unsupported));

  const vContra = await verifyGate({ article: cleanArticle(), bundle: BUNDLE, llmImpl: async () => ({ list: [{ claim: "They split", why: "bundle says they were spotted together", contradicted: true }], ran: true }) });
  check("a CONTRADICTED claim makes severity major", vContra.severity === "major" && vContra.contradicted === true);

  const vDegraded = await verifyGate({ article: cleanArticle(), bundle: BUNDLE, llmImpl: async () => ({ list: [], ran: false }) });
  check("verify L2 error → degraded flag (falls back to L1, doesn't hard-block)", vDegraded.degraded === true && vDegraded.ok === true);

  const vClean = await verifyGate({ article: cleanArticle(), bundle: BUNDLE, llmImpl: async () => ({ list: [], ran: true }) });
  check("a fully-supported article passes verify (ok:true)", vClean.ok === true && vClean.unsupported.length === 0);
}

// ── run.mjs loop: clean draft + judge passes → PUBLISH (auto attached, writer called ONCE) ──
{
  let writes = 0;
  const writeImpl = async () => { writes++; return cleanArticle(); };
  const verifyImpl = async () => ({ ok: true, unsupported: [], contradicted: false, severity: "minor", brokenRatio: 0, degraded: false });
  const judgeImpl = async () => ({ score: 88, subscores: { voice: 8, readability: 8, safety: 9, attribution: 9, structure: 8 }, issues: [] });
  const r = await runGossip(TOPIC, { writeImpl, verifyImpl, judgeImpl, verify: true, judge: true, corroborate: false });
  check("clean+judge-ok → PUBLISH", r.status === "PUBLISH", JSON.stringify(r.status) + " " + (r.reason || ""));
  check("judge score attached to the PUBLISH result", r.auto?.score === 88);
  check("no fixes needed → writer called exactly once", writes === 1, `writes=${writes}`);
  check("provenance carries corroborationCount", Number.isFinite(r.provenance?.corroborationCount));
}

// ── run.mjs loop: WRITER SELF-CORRECTS (verify flags draft 1, passes draft 2) — SURGICAL, not rewrite ──
{
  const writeCalls = [];
  const writeImpl = async (a) => { writeCalls.push(a); return cleanArticle(); };
  let vCall = 0;
  const verifyImpl = async () => { vCall++; return vCall === 1
    ? { ok: false, unsupported: [{ claim: "They are engaged", why: "not in the bundle", contradicted: false }], contradicted: false, severity: "minor", brokenRatio: 0.25, degraded: false }
    : { ok: true, unsupported: [], contradicted: false, severity: "minor", brokenRatio: 0, degraded: false }; };
  const judgeImpl = async () => ({ score: 86, subscores: { safety: 9 }, issues: [] });
  const r = await runGossip(TOPIC, { writeImpl, verifyImpl, judgeImpl, verify: true, judge: true, corroborate: false });
  check("verify-flagged draft → writer self-corrects → PUBLISH", r.status === "PUBLISH", r.reason || "");
  check("self-correct happened (writer called twice)", writeCalls.length === 2, `calls=${writeCalls.length}`);
  const corr = writeCalls[1];
  check("the correction pass gets the PRIOR draft (surgical, not blank rewrite)", !!corr?.priorArticle && corr.rewrite === false);
  check("the correction pass is handed the specific UNSUPPORTED_CLAIM issue", (corr?.issues || []).some((i) => /UNSUPPORTED_CLAIM/.test(i)), JSON.stringify(corr?.issues));
}

// ── run.mjs loop: broadly-broken draft (brokenRatio>0.6) → FULL REWRITE, not surgical ──
{
  const writeCalls = [];
  const writeImpl = async (a) => { writeCalls.push(a); return cleanArticle(); };
  let vCall = 0;
  const verifyImpl = async () => { vCall++; return vCall === 1
    ? { ok: false, unsupported: [{ claim: "x", why: "no" }, { claim: "y", why: "no" }, { claim: "z", why: "no" }], contradicted: false, severity: "major", brokenRatio: 0.8, degraded: false }
    : { ok: true, unsupported: [], severity: "minor", brokenRatio: 0, degraded: false }; };
  const judgeImpl = async () => ({ score: 80, subscores: { safety: 9 }, issues: [] });
  const r = await runGossip(TOPIC, { writeImpl, verifyImpl, judgeImpl, verify: true, judge: true, corroborate: false });
  check("broadly-broken draft → PUBLISH after a rewrite", r.status === "PUBLISH");
  check("a >0.6 broken draft triggers REWRITE mode (rewrite:true)", writeCalls[1]?.rewrite === true, `rewrite=${writeCalls[1]?.rewrite}`);
}

// ── run.mjs loop: JUDGE BACKSTOP catches what the writer missed → one surgical fix → re-judge passes ──
{
  const writeCalls = [];
  const writeImpl = async (a) => { writeCalls.push(a); return cleanArticle(); };
  const verifyImpl = async () => ({ ok: true, unsupported: [], severity: "minor", brokenRatio: 0, degraded: false });
  let jCall = 0;
  const judgeImpl = async () => { jCall++; return jCall === 1
    ? { score: 58, subscores: { safety: 6 }, issues: ["a claim is not supported by the bundle"] }
    : { score: 91, subscores: { safety: 9 }, issues: [] }; };
  const r = await runGossip(TOPIC, { writeImpl, verifyImpl, judgeImpl, verify: true, judge: true, corroborate: false });
  check("judge backstop fix → PUBLISH", r.status === "PUBLISH", r.reason || "");
  check("judge re-ran after the backstop fix (called twice)", jCall === 2);
  check("backstop did one more surgical writer pass (called twice)", writeCalls.length === 2);
  check("final attached score is the RE-JUDGE score", r.auto?.score === 91);
  check("the backstop pass carried the JUDGE's issue back to the writer", (writeCalls[1]?.issues || []).some((i) => /not supported/.test(i)));
}

// ── run.mjs loop: judge STILL unsafe after the backstop → BLOCKED_JUDGE ──
{
  let writes = 0;
  const writeImpl = async () => { writes++; return cleanArticle(); };
  const verifyImpl = async () => ({ ok: true, unsupported: [], severity: "minor", brokenRatio: 0, degraded: false });
  const judgeImpl = async () => ({ score: 40, subscores: { safety: 4 }, issues: ["fabricated quote not in the source"] });
  const r = await runGossip(TOPIC, { writeImpl, verifyImpl, judgeImpl, verify: true, judge: true, corroborate: false });
  check("judge stays unsafe after backstop → BLOCKED_JUDGE", r.status === "BLOCKED_JUDGE", JSON.stringify(r.status));
  check("BLOCKED_JUDGE still carries the judge score", r.auto?.score === 40);
}

// ── run.mjs loop: verify DISABLED → no verifyImpl calls (back-compat with the old gate-only path) ──
{
  let vCalls = 0;
  const writeImpl = async () => cleanArticle();
  const verifyImpl = async () => { vCalls++; return { ok: true, unsupported: [], severity: "minor", brokenRatio: 0 }; };
  const r = await runGossip(TOPIC, { writeImpl, verifyImpl, verify: false, judge: false, corroborate: false });
  check("verify:false never calls the verifier", vCalls === 0);
  check("verify:false + judge:false still PUBLISHes a clean piece", r.status === "PUBLISH");
  check("judge:false leaves auto null", r.auto === null);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Step 5 verify + self-correct + judge-backstop green. ✅\n");
