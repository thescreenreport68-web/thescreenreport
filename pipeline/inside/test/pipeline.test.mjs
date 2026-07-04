// INSIDE lane — FULL insideRun() ORCHESTRATOR TESTS (offline: every impl injected, zero network,
// zero keys). The injected gateImpl is SCRIPTED per call because insiderun.mjs re-invokes it after
// each real cutArticle pass: attempt N = gate call, then (if cutClaims) a rescore call.
// Run: node site/pipeline/inside/test/pipeline.test.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

import { insideRun } from "../insiderun.mjs";
import { writeInsideArticle } from "../assemble.mjs";
import { loadStore } from "../store.mjs";
import { norm } from "../reactionFinder.mjs";
import { NOW, tmp, Q, fakeTrigger, fakeAngle, fakeFactBlock, fakeArticle } from "./fixtures.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (name, cond, detail = "") => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; fails.push(name); console.log(`  ❌ ${name}  ${detail}`); } };

console.log("\n=== INSIDE PIPELINE TESTS — insideRun(), everything injected ===\n");

// ── scripted/counted impl helpers ─────────────────────────────────────────────────────────────
const counted = (fn) => { const f = async (...a) => { f.calls.push(a); return fn(...a); }; f.calls = []; return f; };
const GATE_DEFAULT = { score: 0, pass: false, subscores: {}, deterministic: {}, hardBlocks: [], cutClaims: [], vgVerdict: null, strengths: [], weaknesses: [] };
function makeGate(script) { const g = counted(async () => ({ ...GATE_DEFAULT, ...script[Math.min(g.calls.length - 1, script.length - 1)] })); return g; }

function kit({ forms = ["peer-tributes"], gateScript = [{ pass: true, score: 88 }], dir = tmp("inside-out"), storeFile = null } = {}) {
  const trigger = fakeTrigger();
  const angles = forms.map((f) => fakeAngle(f));
  const store = loadStore(storeFile || path.join(tmp("inside-store"), "store.json"));
  const k = {
    dir, store, trigger, angles,
    loadTriggersImpl: counted(async () => [trigger]),
    proposeAnglesImpl: counted(async () => angles),
    harvestImpl: counted(async (t, a) => ({ ok: true, factBlock: fakeFactBlock(a.form), bundle: { sources: fakeFactBlock(a.form).sources } })),
    editorialImpl: counted(async () => ({ ran: true, reject: false, reason: "", eventSummary: "editor summary" })),
    generateImpl: counted(async ({ angle, factBlock }) => ({ article: fakeArticle({ form: angle.form, factBlock }) })),
    gateImpl: makeGate(gateScript),
    writeImpl: { calls: [] }, // populated by runWith's sync wrapper around the REAL writeInsideArticle
    heroImpl: counted(async () => ({ candidates: [{ url: "https://cdn.example/rex-hero.jpg", credit: "Photo: Meridian Pictures" }] })),
    measureImpl: counted(async () => ({ imageWidth: 1600, imageHeight: 900 })),
    commonsImpl: counted(async () => null),
    webVerifyImpl: counted(async () => ({ ran: true, ok: true, contradictions: [] })),
  };
  return k;
}
const runWith = (k, opts = {}) => insideRun({
  loadTriggersImpl: k.loadTriggersImpl, proposeAnglesImpl: k.proposeAnglesImpl, harvestImpl: k.harvestImpl,
  editorialImpl: k.editorialImpl, generateImpl: k.generateImpl, gateImpl: k.gateImpl,
  writeImpl: (args) => { k.writeImpl.calls.push([args]); return writeInsideArticle({ ...args, dir: k.dir }); },
  heroImpl: k.heroImpl, measureImpl: k.measureImpl, commonsImpl: k.commonsImpl, webVerifyImpl: k.webVerifyImpl,
  storeImpl: k.store, nowMs: NOW, webVerify: true, hero: true, dryRun: false, ...opts,
});

// (a) HAPPY PATH — publishes: write called, store records, report.published populated.
{
  console.log("— (a) happy path publishes —");
  const k = kit();
  const report = await runWith(k);
  check("one article published, nothing held/rejected/blocked",
    report.published.length === 1 && !report.held.length && !report.rejected.length && !report.blocked.length && !report.skipped.length, JSON.stringify(report));
  check("report row carries tag/slug/score/voices",
    report.published[0]?.tag === "rex-harmon-dies×peer-tributes" && !!report.published[0]?.slug && report.published[0]?.score === 88 && report.published[0]?.voices === 4);
  check("writeImpl called exactly once", k.writeImpl.calls.length === 1);
  const file = path.join(k.dir, report.published[0].slug + ".md");
  check("article file actually written", fs.existsSync(file));
  const fm = matter.read(file).data;
  check("published frontmatter carries the resolved hero image", fm.image === "https://cdn.example/rex-hero.jpg" && fm.imageWidth === 1600);
  check("published frontmatter is inside-lane (formatTag/eventSlug)", fm.formatTag === "inside" && fm.eventSlug === "rex-harmon-dies--in-peer-tributes");
  check("store records event×form with angle+trigger snapshots (for the monitor)",
    k.store.published.length === 1 && k.store.published[0].key === "rex-harmon-dies|peer-tributes"
    && k.store.published[0].angle?.form === "peer-tributes" && k.store.published[0].trigger?.parentEventSlug === "rex-harmon-dies");
  check("webVerify ran as the last content gate", k.webVerifyImpl.calls.length === 1);
  check("editorial summary was handed to the writer", k.generateImpl.calls[0][0].trigger.eventSummary === "editor summary");
  check("single clean pass = exactly one gate + one generate call", k.gateImpl.calls.length === 1 && k.generateImpl.calls.length === 1);
  const keys = k.store.published[0].harvestQuoteKeys;
  check("store rec carries the FULL harvest fingerprint (harvestQuoteKeys) for monitor dedup",
    Array.isArray(keys) && keys.length === 4 && keys.includes(norm(Q.mira).slice(0, 90)) && keys.includes(norm(Q.guild).slice(0, 90)));
}

// (a2) EDITORIAL DID NOT RUN — fail-closed HOLD (an editor outage defers, never publishes unchecked).
{
  console.log("\n— (a2) editorial ran:false → held —");
  const k = kit();
  k.editorialImpl = counted(async () => ({ ran: false, reject: false, reason: "editorial error: 529" }));
  const report = await runWith(k);
  check("angle HELD with the did-not-run reason",
    report.held.length === 1 && /editorial gate did not run: editorial error: 529/.test(report.held[0].reason), JSON.stringify(report.held));
  check("no writing money spent, nothing written/recorded",
    k.generateImpl.calls.length === 0 && k.gateImpl.calls.length === 0 && k.writeImpl.calls.length === 0 && k.store.published.length === 0);
  check("held (not parked) — the angle stays retryable next cycle", k.store.parked.length === 0);
}

// (b) HARVEST UNDER FLOOR — rejected + parked; 3 tries → dead; 4th run skipped before harvest.
{
  console.log("\n— (b) harvest under floor → rejected + parked (3 tries → dead) —");
  const k = kit();
  k.harvestImpl = counted(async () => ({ ok: false, reason: "under floor: named voices 2 < 4", stats: null }));
  const r1 = await runWith(k);
  check("run 1: rejected at harvest with try 1", r1.rejected[0]?.stage === "harvest" && /\(try 1\)/.test(r1.rejected[0]?.reason));
  check("run 1: angle parked in the store", k.store.parked.length === 1 && k.store.parked[0].tries === 1);
  const r2 = await runWith(k);
  check("run 2: try 2", /\(try 2\)/.test(r2.rejected[0]?.reason));
  const r3 = await runWith(k);
  check("run 3: try 3 → parked DEAD", /\(try 3\)/.test(r3.rejected[0]?.reason) && k.store.parked[0].dead === true);
  const callsBefore = k.harvestImpl.calls.length;
  const r4 = await runWith(k);
  check("run 4: skipped as parked-dead WITHOUT re-harvesting",
    /parked dead/.test(r4.skipped[0]?.reason) && k.harvestImpl.calls.length === callsBefore && !r4.rejected.length);
  check("nothing was ever published or written", !r4.published.length && k.store.published.length === 0);
}

// (c) EDITORIAL REJECT — rejected, no writing money spent.
{
  console.log("\n— (c) editorial reject → no write —");
  const k = kit();
  k.editorialImpl = counted(async () => ({ ran: true, reject: true, reason: "one wire statement echoed across outlets" }));
  const report = await runWith(k);
  check("rejected at the editorial stage", report.rejected.length === 1 && report.rejected[0].stage === "editorial" && /echoed/.test(report.rejected[0].reason));
  check("writer, gate, hero, webVerify never invoked",
    k.generateImpl.calls.length === 0 && k.gateImpl.calls.length === 0 && k.heroImpl.calls.length === 0 && k.webVerifyImpl.calls.length === 0);
  check("nothing published or recorded", !report.published.length && k.store.published.length === 0);
}

// (d) GATE HARD-BLOCK on both attempts → held; corrections fed back to attempt 2.
{
  console.log("\n— (d) gate hard-blocks both attempts → held —");
  const hard = { pass: false, score: 74, hardBlocks: ['invented-speaker: "Fake Guy" not in harvest'], cutClaims: [] };
  const k = kit({ gateScript: [hard, hard] });
  const report = await runWith(k);
  check("held with the hard-block reason", report.held.length === 1 && /invented-speaker/.test(report.held[0].reason));
  check("two attempts = two generate + two gate calls (no cut/rescore for a hard stop)",
    k.generateImpl.calls.length === 2 && k.gateImpl.calls.length === 2);
  check("attempt 2 received the block as a mandatory correction", /invented-speaker/.test(k.generateImpl.calls[1][0].corrections || ""));
  check("attempt 2 got the previous draft for a surgical retry", !!k.generateImpl.calls[1][0].previousArticle);
  check("held article never written/recorded", k.writeImpl.calls.length === 0 && k.store.published.length === 0);
}

// (e) TERMINAL ACCEPT — final attempt, no hard blocks, score 66 >= ACCEPT_FLOOR 65, and ZERO
//     residual cutClaims: a residual flagged claim forces ONE more cut + re-gate (the 5th call)
//     before the accept is allowed.
{
  console.log("\n— (e) terminal-accept at 66: cut-only blocks + residual-claim cut before accept —");
  const cut = (score, claim) => ({ pass: false, score, hardBlocks: ["verify-gate CUT: 1 unsupported"], cutClaims: [claim] });
  const k = kit({ gateScript: [
    cut(60, "the ceremony will reportedly move to March according to nobody"), // attempt 1 gate
    { pass: false, score: 60, hardBlocks: ["verify-gate CUT: 1 unsupported"] }, // attempt 1 rescore after cut
    cut(66, "organizers privately expect a bigger event next year somehow"),    // attempt 2 gate
    cut(66, "residual flagged claim the verify chain still sees after the cut"),// attempt 2 rescore — RESIDUAL cutClaims
    { pass: false, score: 66, hardBlocks: [], cutClaims: [] },                  // extra terminal cut+re-gate → clean
  ] });
  const report = await runWith(k);
  check("published via terminal accept", report.published.length === 1 && !report.held.length, JSON.stringify(report.held));
  check("acceptReason recorded on the report row", /terminal-accept/.test(report.published[0]?.acceptReason || "") && report.published[0].score === 66);
  check("gate ran 5 times (2×[gate+rescore] + the terminal residual-claim re-gate)", k.gateImpl.calls.length === 5, String(k.gateImpl.calls.length));
  check("store recorded the terminal-accept publish", k.store.published.length === 1);
}

// (e2) TERMINAL ACCEPT REFUSED — residual cutClaims survive even the extra cut → held, never
//      published with claims the verify chain flagged.
{
  console.log("\n— (e2) terminal-accept refused on stubborn residual cutClaims —");
  const cut = (claim) => ({ pass: false, score: 68, hardBlocks: ["verify-gate CUT: 1 unsupported"], cutClaims: [claim] });
  const k = kit({ gateScript: [
    cut("first flagged claim about an unverified donation figure"),  // attempt 1 gate
    cut("second flagged claim about an unverified donation figure"), // attempt 1 rescore
    cut("third flagged claim about an unverified donation figure"),  // attempt 2 gate
    cut("fourth flagged claim about an unverified donation figure"), // attempt 2 rescore — residual
    cut("fifth flagged claim STILL uncut after the extra pass"),     // terminal extra re-gate — STILL residual
  ] });
  const report = await runWith(k);
  check("held — score above floor but flagged claims never cleared",
    report.held.length === 1 && !report.published.length && /verify-gate CUT/.test(report.held[0].reason), JSON.stringify(report.held));
  check("the terminal extra cut+re-gate was attempted (5 gate calls), then refused", k.gateImpl.calls.length === 5, String(k.gateImpl.calls.length));
  check("nothing written or recorded", k.writeImpl.calls.length === 0 && k.store.published.length === 0);
}

// (e3) webVerify rescue path — three outcomes after a post-pass contradiction cut.
{
  console.log("\n— (e3a) webVerify cut guts the article → held —");
  const k = kit({ gateScript: [{ pass: true, score: 90 }, { pass: false, score: 50, hardBlocks: [], cutClaims: [] }] });
  k.webVerifyImpl = counted(async () => ({ ran: true, ok: false, contradictions: [{ claim: "the studio confirmed a sequel would shoot next spring" }] }));
  const report = await runWith(k);
  check("gutted (score under ACCEPT_FLOOR) → held, not published",
    report.held.length === 1 && /web-verify cut gutted/.test(report.held[0].reason) && !report.published.length);
  check("one rescore after the web-cut (no claims to re-cut)", k.gateImpl.calls.length === 2);
  check("gutted article never written", k.writeImpl.calls.length === 0);
}
{
  console.log("\n— (e3b) residual HARD block after the web-cut → held —");
  const k = kit({ gateScript: [
    { pass: true, score: 90 },
    { pass: false, score: 80, hardBlocks: ["back-to-back-quotes"], cutClaims: [] }, // the cut created a structural defect
  ] });
  k.webVerifyImpl = counted(async () => ({ ran: true, ok: false, contradictions: [{ claim: "an award total the live web contradicts outright" }] }));
  const report = await runWith(k);
  check("re-gate after web-cut reports the residual hard block → held",
    report.held.length === 1 && /re-gate after web-cut: back-to-back-quotes/.test(report.held[0].reason) && !report.published.length, JSON.stringify(report.held));
  check("held despite a score (80) above the floor — hard blocks are not negotiable", report.held[0].score === 80);
  check("never written/recorded", k.writeImpl.calls.length === 0 && k.store.published.length === 0);
}
{
  console.log("\n— (e3c) web-cut rescue: residual claims cut once more, article re-clears → published —");
  const k = kit({ gateScript: [
    { pass: true, score: 90 },
    { pass: false, score: 75, hardBlocks: ["verify-gate CUT: 1 unsupported"], cutClaims: ["a leftover flagged claim the web-cut exposed"] },
    { pass: false, score: 75, hardBlocks: [], cutClaims: [] }, // after the second cut: clean, above ACCEPT_FLOOR
  ] });
  k.webVerifyImpl = counted(async () => ({ ran: true, ok: false, contradictions: [{ claim: "one contradicted figure in the ripple summary" }] }));
  const report = await runWith(k);
  check("rescued article publishes at the re-scored value",
    report.published.length === 1 && report.published[0].score === 75 && !report.held.length, JSON.stringify(report));
  check("web-cut → rescore → residual-claim cut → final re-gate (3 gate calls)", k.gateImpl.calls.length === 3, String(k.gateImpl.calls.length));
  check("written + recorded once", k.writeImpl.calls.length === 1 && k.store.published.length === 1);
}

// (f) DEDUP — second run over the same store skips the event×form.
{
  console.log("\n— (f) cross-run dedup skip —");
  const storeFile = path.join(tmp("inside-store"), "store.json");
  const k1 = kit({ storeFile });
  const r1 = await runWith(k1);
  const k2 = kit({ storeFile }); // fresh impls + fresh store LOADED FROM THE SAME FILE
  const r2 = await runWith(k2);
  check("run 1 published", r1.published.length === 1);
  check("run 2 skipped as already published", r2.skipped.length === 1 && /already published/.test(r2.skipped[0].reason) && !r2.published.length);
  check("run 2 never harvested/wrote/gated", k2.harvestImpl.calls.length === 0 && k2.writeImpl.calls.length === 0 && k2.gateImpl.calls.length === 0);
}

// (g) HERO LADDER FAILS — nothing >=1200px anywhere → held.
{
  console.log("\n— (g) no >=1200px hero → held —");
  const k = kit();
  k.measureImpl = counted(async () => ({ imageWidth: 800, imageHeight: 600 }));
  const report = await runWith(k);
  check("held with the no-hero reason", report.held.length === 1 && report.held[0].reason === "no >=1200px hero image on any ladder");
  check("Commons fallback was actually tried", k.commonsImpl.calls.length >= 1);
  check("held article never written/recorded", k.writeImpl.calls.length === 0 && k.store.published.length === 0);
}

// (h) DRY RUN — full flow, nothing touches disk or state.
{
  console.log("\n— (h) dry-run writes nothing —");
  const k = kit({ forms: ["peer-tributes"] });
  const failAngle = fakeAngle("single-voice");
  k.proposeAnglesImpl = counted(async () => [k.angles[0], failAngle]);
  k.harvestImpl = counted(async (t, a) => a.form === "single-voice"
    ? { ok: false, reason: "under floor: named voices 0 < 1", stats: null }
    : { ok: true, factBlock: fakeFactBlock(a.form), bundle: { sources: [] } });
  const report = await runWith(k, { dryRun: true });
  check("dry-run still reports the would-be publish", report.published.length === 1);
  check("no file written to the content dir", fs.readdirSync(k.dir).length === 0, JSON.stringify(fs.readdirSync(k.dir)));
  check("store untouched (no publish record, no parking)", k.store.published.length === 0 && k.store.parked.length === 0 && !fs.existsSync(k.store.file));
  check("under-floor angle reported with try 0 (not parked in dry-run)", /\(try 0\)/.test(report.rejected[0]?.reason || ""));
  check("webVerify and hero ladders skipped in dry-run", k.webVerifyImpl.calls.length === 0 && k.heroImpl.calls.length === 0);
}

// (i) LIMIT respected across angles.
{
  console.log("\n— (i) limit respected —");
  const k = kit({ forms: ["peer-tributes", "cast-crew-voices", "single-voice"] });
  const report = await runWith(k, { limit: 1 });
  check("limit=1 → exactly one publish from three viable angles", report.published.length === 1);
  check("only one write/generate spent", k.writeImpl.calls.length === 1 && k.generateImpl.calls.length === 1);
}

// (j) ONE ANGLE THROWING doesn't kill the run.
{
  console.log("\n— (j) throwing angle is contained —");
  const k = kit({ forms: ["single-voice", "peer-tributes"] });
  k.harvestImpl = counted(async (t, a) => {
    if (a.form === "single-voice") throw new Error("extractor exploded");
    return { ok: true, factBlock: fakeFactBlock(a.form), bundle: { sources: [] } };
  });
  const report = await runWith(k);
  check("the throwing angle lands in report.blocked with its tag",
    report.blocked.length === 1 && report.blocked[0].tag === "rex-harmon-dies×single-voice" && /exploded/.test(report.blocked[0].reason));
  check("the sibling angle still published", report.published.length === 1 && report.published[0].tag === "rex-harmon-dies×peer-tributes");
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Inside pipeline suite green. ✅\n");
