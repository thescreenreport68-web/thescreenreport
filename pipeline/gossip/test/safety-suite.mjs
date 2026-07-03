// GOSSIP SAFETY HARNESS (Phase 1/2). Proves the classify/frame engine + the legal gate behave correctly on a
// battery of designed cases BEFORE the automation ever touches the live site — the owner's strategy:
// "we don't gate each article, we gate the PIPELINE by testing it until it's perfect."
//
// Run: cd "/Users/sivajithcu/Movie News site" && node site/pipeline/gossip/test/safety-suite.mjs
// Exit code 0 = all green (safe to proceed); 1 = a safety rule failed (do NOT ship).

import { frameTopic } from "../frame.mjs";
import { legalGate } from "../legalGate.mjs";

// Each case: a topic + the article a writer might produce, and what the SAFE pipeline must do.
const CASES = [
  {
    name: "Tasha-K trap — damaging claims stated as fact, unattributed",
    topic: { primaryEntity: "Cardi B", title: "Cardi B health rumor", claim: "Cardi B has herpes and used cocaine", sources: [{ outlet: "Pop Crave" }] },
    article: { title: "Cardi B has herpes", body: "Cardi B has herpes and used cocaine. She worked as a prostitute before fame." },
    expect: { decision: "PUBLISH", pass: false, blockIncludes: "UNATTRIBUTED_DAMAGING" },
  },
  {
    name: "Court-doc arrest — official record, attributed → publishes plainly",
    topic: { primaryEntity: "Some Actor", title: "Actor arrested", claim: "arrested for DUI", official: true, sources: [{ outlet: "TMZ" }] },
    article: { title: "Some Actor arrested for DUI, according to police", body: "Some Actor was arrested for DUI early Sunday, according to court records and a police statement. The report says he was booked and released on bail." },
    expect: { decision: "PUBLISH", pass: true },
  },
  {
    name: "Unconfirmed death rumor WITH the mandatory disclaimer → publishes",
    topic: { primaryEntity: "A Star", title: "Death rumor", claim: "A Star has died", sources: [{ outlet: "Reddit" }] },
    article: { title: "Rumors swirl about A Star's health", body: "Rumors are circulating online that A Star has died. This has not been confirmed by the family, their representatives, or any official source — it is unverified and currently circulating as speculation." },
    expect: { decision: "PUBLISH", pass: true },
  },
  {
    name: "Unconfirmed death rumor WITHOUT the disclaimer → blocked",
    topic: { primaryEntity: "A Star", title: "Death rumor", claim: "A Star has died", sources: [{ outlet: "Reddit" }] },
    article: { title: "A Star has died?", body: "Social media is buzzing with talk that A Star has died after a cryptic post from a friend." },
    expect: { decision: "PUBLISH", pass: false, blockIncludes: "MISSING_DISCLAIMER" },
  },
  {
    name: "Sexual-assault rumor, NO established outlet → HOLD",
    topic: { primaryEntity: "An Actor", title: "Assault rumor", claim: "accused of sexual assault", sources: [{ outlet: "DeuxMoi" }, { outlet: "Reddit" }] },
    article: { title: "An Actor sexual assault rumor", body: "An anonymous post alleges An Actor committed sexual assault. This is unconfirmed." },
    expect: { decision: "HOLD", pass: false, blockIncludes: "HOLD" },
  },
  {
    name: "Sexual-assault claim, established outlet (Variety) reported → publishes, attributed",
    topic: { primaryEntity: "An Actor", title: "Assault lawsuit", claim: "accused of sexual assault in a lawsuit", sources: [{ outlet: "Variety" }] },
    article: { title: "An Actor named in sexual assault lawsuit, per Variety", body: "According to Variety, An Actor has been accused of sexual assault in a newly filed lawsuit. An Actor's representatives have not responded, the allegations are unproven, and The Screen Report has not independently verified them." },
    expect: { decision: "PUBLISH", pass: true },
  },
  {
    name: "Minor + sexual allegation → never publish (hard block)",
    topic: { primaryEntity: "Some Person", title: "Allegation", claim: "sexual misconduct involving a 16-year-old", sources: [{ outlet: "Variety" }] },
    article: { title: "Some Person accused", body: "According to Variety, Some Person engaged in sexual misconduct with a 16-year-old, per a lawsuit." },
    expect: { pass: false, blockIncludes: "MINOR_ALLEGATION" },
  },
  {
    name: "Normal dating rumor, major outlet, attributed → publishes (no disclaimer needed)",
    topic: { primaryEntity: "Star A", title: "Dating rumor", claim: "Star A and Star B are dating", sources: [{ outlet: "People" }] },
    article: { title: "Star A and Star B spark dating rumors, per People", body: "According to People, Star A and Star B are quietly dating after being spotted together at a restaurant. Reps for both stars did not immediately comment." },
    expect: { decision: "PUBLISH", pass: true },
  },
  {
    name: "Intimate media hosting → blocked",
    topic: { primaryEntity: "Star C", title: "Leak", claim: "leaked content", sources: [{ outlet: "The Shade Room" }] },
    article: { title: "Star C leaked", body: "A leaked sex tape of Star C is going around. Watch the full video here. This is unconfirmed." },
    expect: { pass: false, blockIncludes: "INTIMATE_MEDIA" },
  },
  {
    name: "Affair social-speculation, properly framed + disclaimer → publishes",
    topic: { primaryEntity: "Star D", title: "Affair speculation", claim: "Star D cheated", sources: [{ outlet: "X" }] },
    article: { title: "Why fans think Star D's marriage is in trouble", body: "Fans are speculating that Star D cheated after a cryptic Instagram post sent timelines into a frenzy. This has not been confirmed by Star D or their representatives and remains unverified." },
    expect: { decision: "PUBLISH", pass: true },
  },
];

let passed = 0, failed = 0;
const fails = [];
console.log(`\n=== GOSSIP SAFETY HARNESS · ${CASES.length} cases ===\n`);
for (const c of CASES) {
  const frame = frameTopic(c.topic);
  const gate = legalGate(c.article, frame, c.topic);
  const checks = [];
  if (c.expect.decision != null) checks.push(["decision", frame.decision === c.expect.decision, `${frame.decision} (want ${c.expect.decision})`]);
  if (c.expect.pass != null) checks.push(["gate.pass", gate.pass === c.expect.pass, `${gate.pass} (want ${c.expect.pass})`]);
  if (c.expect.blockIncludes != null) checks.push(["block", gate.blocks.some((b) => b.includes(c.expect.blockIncludes)), `[${gate.blocks.map((b) => b.split(":")[0]).join(", ") || "none"}] (want ${c.expect.blockIncludes})`]);
  const ok = checks.every((c2) => c2[1]);
  if (ok) { passed++; console.log(`  ✅ ${c.name}`); }
  else {
    failed++; fails.push(c.name);
    console.log(`  ❌ ${c.name}`);
    for (const [k, good, detail] of checks) if (!good) console.log(`        ↳ ${k}: ${detail}`);
    if (gate.blocks.length) console.log(`        ↳ blocks: ${gate.blocks.map((b) => b.slice(0, 80)).join(" | ")}`);
  }
}
console.log(`\n── RESULT: ${passed}/${CASES.length} passed${failed ? `, ${failed} FAILED` : ""} ──`);
if (failed) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("All safety cases green. ✅\n");
