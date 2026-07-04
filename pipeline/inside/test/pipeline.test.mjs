// INSIDE lane — FULL insideRun() ORCHESTRATOR TESTS (REV 2; offline: every impl injected, zero
// network, zero keys). The injected gateImpl is SCRIPTED per call because insiderun.mjs re-invokes it
// after each real cutArticle pass. Run: env -i node site/pipeline/inside/test/pipeline.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { insideRun } from "../insiderun.mjs";
import { loadStore, alreadyPublished } from "../store.mjs";
import { GATE, ACCEPT_FLOOR } from "../config.inside.mjs";
import {
  NOW, tmp, fakeTrigger, fakeAngle, fakeArticle, fakeFactBlock, fakeImage,
} from "./fixtures.mjs";

let pass = 0, fail = 0; const fails = [];
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; fails.push(name); console.log(`  ❌ ${name}  ${String(e?.message || e).slice(0, 220)}`); }
};

console.log("\n=== INSIDE PIPELINE TESTS (REV 2, offline) ===\n");

// A gate result factory — the exact shape gateInside returns + insideRun reads.
const gateResult = ({ score = 90, hardBlocks = [], cutClaims = [], weaknesses = [] } = {}) => ({
  score,
  pass: score >= GATE.publishMin && hardBlocks.length === 0,
  subscores: {},
  deterministic: { words: 600, h2s: 2, quoteRatio: 0.2, hardBlocks },
  hardBlocks,
  cutClaims,
  strengths: [],
  weaknesses,
});
// A scripted gate: returns queued results in order; records every call's article snapshot.
const scriptedGate = (queue) => {
  const calls = [];
  const impl = async ({ article }) => {
    calls.push({ body: article.body, keyTakeaways: [...(article.keyTakeaways || [])] });
    return queue.length ? queue.shift() : gateResult({ score: 90 });
  };
  impl.calls = calls;
  return impl;
};

// Fresh temp store per test.
const freshStore = () => loadStore(path.join(tmp("inside-run"), "store.json"));

// Base injected impls that never touch the network.
const baseImpls = (over = {}) => ({
  loadTriggersImpl: async () => [fakeTrigger()],
  proposeAnglesImpl: async () => [fakeAngle("audience-reaction")],
  harvestImpl: async (trigger, angle) => ({ ok: true, factBlock: fakeFactBlock(angle.form), bundle: { sources: fakeFactBlock(angle.form).sources } }),
  generateImpl: async ({ angle }) => ({ article: fakeArticle({ form: angle.form }) }),
  gateImpl: scriptedGate([gateResult({ score: 90 })]),
  writeImpl: () => ({ slug: "the-sable-coast-2026-reaction", path: "/tmp/x.md", written: true }),
  imagePickImpl: async () => fakeImage(),
  webVerifyImpl: async () => ({ ran: true, ok: true, contradictions: [] }),
  webVerify: false,
  hero: true,
  ...over,
});

// ── 1) HAPPY PATH: clean gate → publishes; store records fingerprint + snapshot ───────────────────
await check("happy path publishes; writeImpl called; store records harvestQuoteKeys + trigger snapshot", async () => {
  const store = freshStore();
  let wrote = null;
  const report = await insideRun(baseImpls({
    storeImpl: store,
    writeImpl: (args) => { wrote = args; return { slug: "sable-reaction", path: "/tmp/x.md", written: true }; },
    nowMs: NOW,
  }));
  assert.equal(report.published.length, 1, "one published");
  assert.equal(report.held.length, 0);
  assert.ok(wrote, "writeImpl was called");
  assert.ok(alreadyPublished(store, "the-sable-coast-2026", "audience-reaction"), "store records dedup key");
  const rec = store.published.find((r) => r.form === "audience-reaction");
  assert.ok(Array.isArray(rec.harvestQuoteKeys) && rec.harvestQuoteKeys.length > 0, "harvestQuoteKeys snapshot");
  assert.ok(rec.trigger && Array.isArray(rec.trigger.redditPosts), "trigger.redditPosts snapshot");
  assert.ok(rec.trigger.work && rec.trigger.work.title === "The Sable Coast", "trigger.work snapshot");
  assert.ok(Array.isArray(rec.trigger.sources), "trigger.sources snapshot");
  assert.ok(rec.angle && rec.angle.form === "audience-reaction", "angle snapshot");
});

// ── 2) HARVEST UNDER FLOOR → rejected + parked (only on 'under floor', NOT 'no material') ─────────
await check("harvest 'under floor' → rejected + parked", async () => {
  const store = freshStore();
  const report = await insideRun(baseImpls({
    storeImpl: store,
    harvestImpl: async () => ({ ok: false, reason: "under floor: real anchor posts 1 < 3", stats: {} }),
    nowMs: NOW,
  }));
  assert.equal(report.published.length, 0);
  assert.equal(report.rejected.length, 1, "rejected");
  assert.ok(/under floor/.test(report.rejected[0].reason));
  assert.equal(store.parked.length, 1, "parked (genuine thin)");
});
await check("harvest 'no material' (transient) → rejected but NOT parked", async () => {
  const store = freshStore();
  const report = await insideRun(baseImpls({
    storeImpl: store,
    harvestImpl: async () => ({ ok: false, reason: "no material", stats: {} }),
    nowMs: NOW,
  }));
  assert.equal(report.rejected.length, 1);
  assert.ok(/transient — not parked/.test(report.rejected[0].reason));
  assert.equal(store.parked.length, 0, "NOT parked on transient");
});

// ── 3) GATE HARD-BLOCK both attempts → held ───────────────────────────────────────────────────────
await check("gate hard-block both attempts → held (never published)", async () => {
  const store = freshStore();
  const blocked = gateResult({ score: 90, hardBlocks: ["invented-speaker: Ghost not in anchors"] });
  const report = await insideRun(baseImpls({
    storeImpl: store,
    gateImpl: scriptedGate([blocked, blocked, blocked, blocked]), // attempt1 + attempt2 (+ any re-gate)
    nowMs: NOW,
  }));
  assert.equal(report.published.length, 0);
  assert.equal(report.held.length, 1, "held");
  assert.ok(/invented-speaker/.test(report.held[0].reason));
  assert.equal(store.published.length, 0, "nothing recorded");
});

// ── 4) TERMINAL-ACCEPT at 66 with only soft-floor blocks → published ──────────────────────────────
await check("terminal-accept at 66 (only soft-floor blocks) → published", async () => {
  const store = freshStore();
  // attempt1: score 66, a soft-floor block (fixable, not hard), no cuts.
  // attempt2 (=MAX_ATTEMPTS): same → block.length(hard)=0, score 66 >= ACCEPT_FLOOR(65) → terminal accept.
  const soft = gateResult({ score: 66, hardBlocks: ["soft-floor engagement 4 < 5"] });
  const gate = scriptedGate([soft, soft, soft, soft]);
  const report = await insideRun(baseImpls({ storeImpl: store, gateImpl: gate, nowMs: NOW }));
  assert.equal(report.published.length, 1, "published via terminal accept");
  assert.ok(/terminal-accept/.test(report.published[0].acceptReason || ""), "acceptReason set");
  assert.ok(report.published[0].score >= ACCEPT_FLOOR);
});

// ── 5) WEB-VERIFY contradiction → cut + re-gate → hold if gutted ───────────────────────────────────
await check("webVerify contradiction → cut + re-gate; hold if re-gate blocks", async () => {
  const store = freshStore();
  // Publish path clears the WRITE→GATE loop cleanly (call 1 passes), then webVerify contradicts,
  // cutArticle runs, re-gate (call 2) returns a residual hard block → HOLD.
  const gate = scriptedGate([
    gateResult({ score: 90 }),                                             // attempt 1: pass
    gateResult({ score: 90, hardBlocks: ["invented-speaker: X"] }),        // web re-gate: residual block → hold
  ]);
  const report = await insideRun(baseImpls({
    storeImpl: store,
    gateImpl: gate,
    webVerify: true,
    webVerifyImpl: async () => ({ ran: true, ok: false, contradictions: [{ claim: "The film grossed 400 million dollars" }] }),
    nowMs: NOW,
  }));
  assert.equal(report.published.length, 0, "not published after web-cut gutted it");
  assert.equal(report.held.length, 1, "held");
  assert.ok(/re-gate after web-cut|web-verify cut/.test(report.held[0].reason), report.held[0].reason);
});
await check("webVerify with NO contradictions → publishes", async () => {
  const store = freshStore();
  const report = await insideRun(baseImpls({
    storeImpl: store,
    webVerify: true,
    webVerifyImpl: async () => ({ ran: true, ok: true, contradictions: [] }),
    nowMs: NOW,
  }));
  assert.equal(report.published.length, 1);
});

// ── 6) DEDUP: second run skips an already-published event×form ────────────────────────────────────
await check("dedup: second run skips already-published event×form", async () => {
  const store = freshStore();
  const impls = () => baseImpls({ storeImpl: store, nowMs: NOW });
  const r1 = await insideRun(impls());
  assert.equal(r1.published.length, 1, "first run publishes");
  const r2 = await insideRun(impls());
  assert.equal(r2.published.length, 0, "second run publishes nothing");
  assert.ok(r2.skipped.some((s) => /already published/.test(s.reason)), "skipped as already published");
});

// ── 7) IMAGE PICKER null → held ('no >=1200px relevant featured image') ────────────────────────────
await check("image picker returns null → held (no featured image)", async () => {
  const store = freshStore();
  const report = await insideRun(baseImpls({
    storeImpl: store,
    imagePickImpl: async () => null,
    nowMs: NOW,
  }));
  assert.equal(report.published.length, 0);
  assert.equal(report.held.length, 1);
  assert.ok(/1200px/.test(report.held[0].reason), report.held[0].reason);
});

// ── 8) DRY-RUN writes nothing (writeImpl written:false, no store record) ───────────────────────────
await check("dry-run writes nothing and records nothing", async () => {
  const store = freshStore();
  let writtenFlag = null;
  const report = await insideRun(baseImpls({
    storeImpl: store,
    dryRun: true,
    writeImpl: (args) => { writtenFlag = args.dryRun; return { slug: "s", path: "/tmp/s.md", written: false }; },
    nowMs: NOW,
  }));
  assert.equal(report.published.length, 1, "reported as published (dry)");
  assert.equal(writtenFlag, true, "writeImpl received dryRun:true");
  assert.equal(store.published.length, 0, "no store record in dry-run");
});

// ── 9) LIMIT respected ─────────────────────────────────────────────────────────────────────────────
await check("limit respected (stops after N published)", async () => {
  const store = freshStore();
  const report = await insideRun(baseImpls({
    storeImpl: store,
    loadTriggersImpl: async () => [fakeTrigger(), fakeTrigger({ parentEventSlug: "other-film-2026", parentTitle: "Other Film", primaryEntity: "Other Film" })],
    limit: 1,
    nowMs: NOW,
  }));
  assert.equal(report.published.length, 1, "only 1 published under limit");
});

// ── 10) ONE THROWING ANGLE is contained → report.blocked ─────────────────────────────────────────
await check("a throwing harvest for one angle is contained (report.blocked)", async () => {
  const store = freshStore();
  const report = await insideRun(baseImpls({
    storeImpl: store,
    harvestImpl: async () => { throw new Error("boom in harvest"); },
    nowMs: NOW,
  }));
  assert.equal(report.published.length, 0);
  assert.equal(report.blocked.length, 1, "contained in report.blocked");
  assert.ok(/boom in harvest/.test(report.blocked[0].reason));
});

console.log(`\n=== PIPELINE: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log("FAILED: " + fails.join(", ")); process.exit(1); }
