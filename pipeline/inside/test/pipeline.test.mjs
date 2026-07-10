// INSIDE lane — FULL agentRun() ORCHESTRATOR TESTS (multi-agent; offline: every impl injected,
// zero network, zero keys). The injected qaReviewImpl is SCRIPTED per call because agentrun.mjs
// re-invokes it after each real cutArticle pass.
// Run: env -i node site/pipeline/inside/test/pipeline.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { agentRun } from "../agentrun.mjs";
import { USAGE } from "../../lib/openrouter.mjs";
import { loadStore, alreadyPublished } from "../store.mjs";
import { GATE, ACCEPT_FLOOR, DATA_DIR } from "../config.inside.mjs";
import { NOW, tmp, fakeTrigger, fakeAngle, fakeArticle, fakeFactBlock, fakeImage, fakeBrief } from "./fixtures.mjs";
import { factBlockText } from "../reactionFinder.mjs";

let pass = 0, fail = 0; const fails = [];
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; fails.push(name); console.log(`  ❌ ${name}  ${String(e?.message || e).slice(0, 220)}`); }
};

console.log("\n=== INSIDE PIPELINE TESTS (agentRun, offline) ===\n");

// agentRun writes DATA_DIR/runs/<runId>.json on non-dry runs and honors DATA_DIR/PAUSED — clean both.
const PAUSED_FILE = path.join(DATA_DIR, "PAUSED");
const RUN_FILE = path.join(DATA_DIR, "runs", "run-2026-07-04T12-00-00.json");
assert.ok(!fs.existsSync(PAUSED_FILE), `pre-existing ${PAUSED_FILE} — the lane is paused for real; refusing to run tests`);
const runFileExistedBefore = fs.existsSync(RUN_FILE);

// A qa result factory — the exact shape qa.review writes to job.qa and agentrun reads.
// pass mirrors the 2026-07-10 contract: cutClaims must be EMPTY to pass.
const qaResult = ({ score = 90, hardBlocks = [], cutClaims = [], weaknesses = [] } = {}) => ({
  score,
  pass: score >= GATE.publishMin && hardBlocks.length === 0 && cutClaims.length === 0,
  subscores: {},
  deterministic: { words: 600, h2s: 2, quoteRatio: 0.2, hardBlocks },
  hardBlocks,
  cutClaims,
  strengths: [],
  weaknesses,
});
// Scripted QA: sets job.qa from a queue, in order; records call count.
const scriptedQA = (queue) => {
  const impl = async (job) => { impl.calls++; job.qa = queue.length ? queue.shift() : qaResult({ score: 90 }); return job; };
  impl.calls = 0;
  return impl;
};

const freshStore = () => loadStore(path.join(tmp("inside-agentrun"), "store.json"));

// Base injected impls — every agent scripted, nothing touches the network.
const baseImpls = (over = {}) => ({
  findImpl: async () => [{ story: fakeTrigger(), angle: fakeAngle("audience-reaction") }],
  gatherImpl: async (job) => {
    job.factBlock = fakeFactBlock(job.angle.form);
    job.bundle = { sources: job.factBlock.sources };
    job.factText = factBlockText(job.factBlock, job.story);
    job.gatherStats = job.factBlock.stats;
    return job;
  },
  embedImpl: async (job) => { job.embeds = { tweetIds: ["1809000000000000001"], instagramUrls: ["https://www.instagram.com/p/RUNIG12345/"] }; return job; },
  synthImpl: async (job) => { job.brief = fakeBrief(job.angle.form); return job; },
  writeArticleImpl: async (job) => { job.article = fakeArticle({ form: job.angle.form }); return job; },
  voiceImpl: async (job) => job, // no-op: the suite stays hermetic; voice has its own unit tests
  qaReviewImpl: scriptedQA([]),
  qaWebCheckImpl: async () => ({ ran: true, ok: true, contradictions: [] }),
  imageImpl: async (job) => { job.image = { ...fakeImage(), alt: "alt" }; return job; },
  publishImpl: () => ({ slug: "sable-agent-article", path: "/tmp/x.md", written: true }),
  webVerify: false,
  hero: true,
  nowMs: NOW,
  ...over,
});

// ── 1) HAPPY PATH: publishes; publishImpl gets embeds; store records fingerprint + snapshots ──────
await check("happy path publishes; publishImpl receives embeds; store records harvestQuoteKeys + snapshots", async () => {
  const store = freshStore();
  let published = null;
  const report = await agentRun(baseImpls({
    storeImpl: store,
    publishImpl: (args) => { published = args; return { slug: "sable-agent-article", path: "/tmp/x.md", written: true }; },
  }));
  assert.equal(report.published.length, 1, "one published: " + JSON.stringify(report.held) + JSON.stringify(report.blocked));
  assert.ok(published, "publishImpl called");
  assert.deepEqual(published.embeds, { tweetIds: ["1809000000000000001"], instagramUrls: ["https://www.instagram.com/p/RUNIG12345/"] }, "embeds passed to publish");
  assert.ok(published.image, "image passed to publish");
  assert.ok(report.published[0].embeds, "report carries embeds");
  assert.ok(alreadyPublished(store, "the-sable-coast-2026", "audience-reaction"), "dedup key recorded");
  const rec = store.published.find((r) => r.form === "audience-reaction");
  assert.ok(rec.harvestQuoteKeys.length > 0, "harvestQuoteKeys snapshot");
  assert.ok(rec.trigger && Array.isArray(rec.trigger.redditPosts) && rec.trigger.work.title === "The Sable Coast", "trigger snapshot");
  assert.equal(rec.trigger.category, "movies", "snapshot carries category (2026-07-10)");
  assert.ok(typeof rec.trigger.overview === "string" && rec.trigger.overview.length > 0, "snapshot carries overview (2026-07-10)");
  assert.ok(rec.angle && rec.angle.form === "audience-reaction", "angle snapshot");
  assert.ok(report.meter && typeof report.openrouterTotalUsd === "number", "cost report present");
});

// ── 2) PAUSED kill-switch ─────────────────────────────────────────────────────────────────────────
await check("PAUSED file → paused report, nothing runs", async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PAUSED_FILE, "test");
  try {
    let finderRan = false;
    const report = await agentRun(baseImpls({
      storeImpl: freshStore(),
      findImpl: async () => { finderRan = true; return []; },
      dryRun: true,
    }));
    assert.equal(report.paused, true);
    assert.equal(finderRan, false, "finder never ran");
    assert.equal(report.published.length, 0);
  } finally { fs.unlinkSync(PAUSED_FILE); }
});

// ── 3) DAILY CAP ──────────────────────────────────────────────────────────────────────────────────
await check("daily cap: 30 already published today → dailyCapHit, finder never runs", async () => {
  const store = freshStore();
  const day = new Date(NOW).toISOString();
  store.published = Array.from({ length: 30 }, (_, i) => ({ key: `e${i}|audience-reaction`, at: day, slug: `s${i}` }));
  let finderRan = false;
  const report = await agentRun(baseImpls({ storeImpl: store, findImpl: async () => { finderRan = true; return []; }, dryRun: true }));
  assert.equal(report.dailyCapHit, 30);
  assert.equal(finderRan, false);
});
await check("daily cap mid-run: 29 today + limit 5 → publishes 1 then caps", async () => {
  const store = freshStore();
  const day = new Date(NOW).toISOString();
  store.published = Array.from({ length: 29 }, (_, i) => ({ key: `e${i}|the-debate`, at: day, slug: `s${i}` }));
  const report = await agentRun(baseImpls({
    storeImpl: store,
    findImpl: async () => [
      { story: fakeTrigger(), angle: fakeAngle("audience-reaction") },
      { story: fakeTrigger({ parentEventSlug: "other-film", parentTitle: "Other Film", primaryEntity: "Other Film" }), angle: fakeAngle("audience-reaction") },
    ],
    limit: 5,
    dryRun: true,
  }));
  assert.equal(report.published.length, 1, "one published before the cap");
  assert.equal(report.dailyCapHit, true, "cap tripped mid-run");
});

// ── 4) COST CAP — the cap reads openrouter's in-process ledger (costReport). USAGE is exported
// and mutable, so it IS injectable offline: push a fake usage row, clear it after (process-lifetime).
await check("cost cap: openrouter ledger above MAX_RUN_COST_USD → costCapHit before the story runs", async () => {
  // 1M output tokens on gemini-2.5-flash = $2.50 > the $0.50 default cap.
  USAGE.push({ model: "google/gemini-2.5-flash", prompt_tokens: 0, completion_tokens: 1e6 });
  try {
    const report = await agentRun(baseImpls({ storeImpl: freshStore(), dryRun: true }));
    assert.equal(report.costCapHit, true);
    assert.equal(report.published.length, 0, "story never processed");
    assert.ok(report.openrouterTotalUsd > 0.5, "reported cost reflects the ledger");
  } finally { USAGE.length = 0; } // never leak the fake spend into later tests
});

// ── 5) GATHER FAIL: under-floor parks, transient does not ─────────────────────────────────────────
await check("gatherFail 'under floor…' → rejected + parked", async () => {
  const store = freshStore();
  const report = await agentRun(baseImpls({
    storeImpl: store,
    gatherImpl: async (job) => { job.gatherFail = "under floor: real anchor posts 1 < 3"; return job; },
  }));
  assert.equal(report.rejected.length, 1);
  assert.ok(/under floor/.test(report.rejected[0].reason));
  assert.equal(store.parked.length, 1, "parked (genuine thin)");
});
await check("gatherFail transient ('no material') → rejected but NOT parked", async () => {
  const store = freshStore();
  const report = await agentRun(baseImpls({
    storeImpl: store,
    gatherImpl: async (job) => { job.gatherFail = "no material"; return job; },
  }));
  assert.equal(report.rejected.length, 1);
  assert.ok(/transient — not parked/.test(report.rejected[0].reason));
  assert.equal(store.parked.length, 0);
});

// ── 6) EMBED THROW is contained (best-effort) ─────────────────────────────────────────────────────
await check("embedImpl throwing → empty embeds fallback, still publishes", async () => {
  let published = null;
  const report = await agentRun(baseImpls({
    storeImpl: freshStore(),
    embedImpl: async () => { throw new Error("embed boom"); },
    publishImpl: (args) => { published = args; return { slug: "s", path: "/tmp/s.md", written: true }; },
  }));
  assert.equal(report.published.length, 1, "embed failure never blocks");
  assert.deepEqual(published.embeds.instagramUrls, []);
  assert.ok(Array.isArray(published.embeds.tweetIds), "tweetIds fall back to factBlock ids");
});

// ── 7) SYNTH FAIL → held + PARKED (quality holds park; 3 strikes → dead) ──────────────────────────
await check("synthFail → held AND parked (quality hold)", async () => {
  const store = freshStore();
  const report = await agentRun(baseImpls({
    storeImpl: store,
    synthImpl: async (job) => { job.synthFail = "synthesizer returned no usable brief"; return job; },
  }));
  assert.equal(report.published.length, 0);
  assert.equal(report.held.length, 1);
  assert.ok(/no usable brief/.test(report.held[0].reason));
  assert.equal(store.parked.length, 1, "quality hold parks");
  assert.equal(store.parked[0].tries, 1);
});
await check("3 quality holds → parked dead → 4th run SKIPS the story", async () => {
  const store = freshStore();
  const impls = () => baseImpls({
    storeImpl: store,
    synthImpl: async (job) => { job.synthFail = "synthesizer returned no usable brief"; return job; },
  });
  for (let i = 1; i <= 3; i++) {
    const r = await agentRun(impls());
    assert.equal(r.held.length, 1, `run ${i} holds`);
    assert.equal(store.parked[0].tries, i, `park strike ${i}`);
  }
  assert.equal(store.parked[0].dead, true, "3rd strike → dead");
  const r4 = await agentRun(impls());
  assert.equal(r4.held.length, 0, "4th run never re-runs the pipeline");
  assert.ok(r4.skipped.some((s) => /parked dead/.test(s.reason)), "skipped as parked dead");
});

// ── 8) QA HARD-BLOCK both attempts → held + parked ────────────────────────────────────────────────
await check("qa hard-block both attempts → held + parked (never published)", async () => {
  const store = freshStore();
  const blocked = () => qaResult({ score: 90, hardBlocks: ["invented-speaker: Ghost not in anchors"] });
  const report = await agentRun(baseImpls({
    storeImpl: store,
    qaReviewImpl: scriptedQA([blocked(), blocked(), blocked(), blocked()]),
  }));
  assert.equal(report.published.length, 0);
  assert.equal(report.held.length, 1);
  assert.ok(/invented-speaker/.test(report.held[0].reason));
  assert.equal(store.published.length, 0, "nothing recorded");
  assert.equal(store.parked.length, 1, "qa-fail hold parks");
});

// ── 9) TERMINAL-ACCEPT at 66 with only soft-floor blocks → published ──────────────────────────────
await check("terminal-accept at 66 (only soft-floor blocks, zero cuts) → published", async () => {
  const soft = () => qaResult({ score: 66, hardBlocks: ["soft-floor engagement 4 < 5"] });
  const report = await agentRun(baseImpls({
    storeImpl: freshStore(),
    qaReviewImpl: scriptedQA([soft(), soft(), soft(), soft()]),
  }));
  assert.equal(report.published.length, 1, "published via terminal accept: " + JSON.stringify(report.held));
  assert.ok(/terminal-accept/.test(report.published[0].acceptReason || ""));
  assert.ok(report.published[0].score >= ACCEPT_FLOOR);
});
await check("terminal-accept REFUSED when uncut flagged claims remain (held + parked)", async () => {
  // score 66, no hard blocks, but cutClaims present every review → cut+re-review still flags → held.
  const store = freshStore();
  const flagged = () => qaResult({ score: 66, cutClaims: ["The film grossed 999 million dollars"] });
  const report = await agentRun(baseImpls({
    storeImpl: store,
    qaReviewImpl: scriptedQA(Array.from({ length: 14 }, () => flagged())), // iterative cuts consume more reviews now
  }));
  assert.equal(report.published.length, 0, "never publishes with uncut flagged claims");
  assert.equal(report.held.length, 1);
  assert.equal(store.parked.length, 1, "quality hold parks");
});

// ── 10) webCheck contradiction → cut + re-review → held when not re-clean ─────────────────────────
await check("webCheck contradiction → cut + re-review; held + parked when re-review blocks", async () => {
  const store = freshStore();
  const qaQueue = scriptedQA([
    qaResult({ score: 90 }),                                            // write→qa: pass
    qaResult({ score: 90, hardBlocks: ["invented-speaker: X"] }),       // post-web-cut re-review: residual block
  ]);
  const report = await agentRun(baseImpls({
    storeImpl: store,
    qaReviewImpl: qaQueue,
    webVerify: true,
    qaWebCheckImpl: async () => ({ ran: true, ok: false, contradictions: [{ claim: "The film grossed 400 million dollars" }] }),
  }));
  assert.equal(report.published.length, 0);
  assert.equal(report.held.length, 1);
  assert.ok(/web-check cuts didn't re-clear/.test(report.held[0].reason), report.held[0].reason);
  assert.equal(store.parked.length, 1, "web-cut-not-reclear hold parks (quality)");
});
await check("webCheck ran:false → held unverified, NOT parked (transient infra)", async () => {
  const store = freshStore();
  const report = await agentRun(baseImpls({
    storeImpl: store,
    webVerify: true,
    qaWebCheckImpl: async () => ({ ran: false, ok: false, contradictions: [], error: "provider outage" }),
  }));
  assert.equal(report.published.length, 0, "never publish unverified");
  assert.equal(report.held.length, 1);
  assert.ok(/web-check did not run.*held unverified/.test(report.held[0].reason), report.held[0].reason);
  assert.equal(store.parked.length, 0, "transient hold does NOT park — retries next tick");
});
await check("webCheck throwing → same fail-closed hold (catch shapes ran:false)", async () => {
  const store = freshStore();
  const report = await agentRun(baseImpls({
    storeImpl: store,
    webVerify: true,
    qaWebCheckImpl: async () => { throw new Error("hard crash"); },
  }));
  assert.equal(report.published.length, 0);
  assert.ok(/web-check did not run/.test(report.held[0].reason), report.held[0].reason);
  assert.equal(store.parked.length, 0, "not parked");
});
await check("webCheck clean (ran:true, no contradictions) → publishes", async () => {
  const report = await agentRun(baseImpls({
    storeImpl: freshStore(),
    webVerify: true,
    qaWebCheckImpl: async () => ({ ran: true, ok: true, contradictions: [] }),
  }));
  assert.equal(report.published.length, 1);
});

// ── 11) IMAGE null → held + parked ────────────────────────────────────────────────────────────────
await check("image agent returns null → held 'no >=1200px…' + parked", async () => {
  const store = freshStore();
  const report = await agentRun(baseImpls({
    storeImpl: store,
    imageImpl: async (job) => { job.image = null; return job; },
  }));
  assert.equal(report.published.length, 0);
  assert.equal(report.held.length, 1);
  assert.ok(/1200px/.test(report.held[0].reason));
  assert.equal(store.parked.length, 1, "image hold parks");
});

// ── 12) DEDUP second run ──────────────────────────────────────────────────────────────────────────
await check("dedup: second run skips already-published story×form", async () => {
  const store = freshStore();
  const r1 = await agentRun(baseImpls({ storeImpl: store }));
  assert.equal(r1.published.length, 1);
  const r2 = await agentRun(baseImpls({ storeImpl: store }));
  assert.equal(r2.published.length, 0);
  assert.ok(r2.skipped.some((s) => /already published/.test(s.reason)));
});

// ── 13) DRY-RUN writes nothing (but DOES run in-memory cuts since 2026-07-10) ─────────────────────
await check("dry-run: publishImpl gets dryRun:true, no store record, no park, no run file", async () => {
  const store = freshStore();
  const dryRunFile = path.join(DATA_DIR, "runs", "run-2026-07-05T12-00-00.json");
  let dryFlag = null;
  const report = await agentRun(baseImpls({
    storeImpl: store,
    dryRun: true,
    nowMs: Date.parse("2026-07-05T12:00:00Z"),
    publishImpl: (args) => { dryFlag = args.dryRun; return { slug: "s", path: "/tmp/s.md", written: false }; },
  }));
  assert.equal(report.published.length, 1, "reported as published (dry)");
  assert.equal(dryFlag, true, "publishImpl received dryRun:true");
  assert.equal(store.published.length, 0, "no store record");
  assert.equal(store.parked.length, 0, "dry-run never parks");
  assert.ok(!fs.existsSync(dryRunFile), "no run report file in dry-run");
});
await check("dry-run RUNS cutArticle in-memory: flagged sentence removed from the dry-published article", async () => {
  const store = freshStore();
  const claim = "The film grossed 999 million dollars at the global box office";
  let publishedBody = null;
  const report = await agentRun(baseImpls({
    storeImpl: store,
    dryRun: true,
    nowMs: Date.parse("2026-07-05T13:00:00Z"),
    writeArticleImpl: async (job) => {
      const art = fakeArticle({ form: job.angle.form });
      art.body += `\n\n${claim} worldwide, a stunning figure.`;
      job.article = art;
      return job;
    },
    // review 1: flags the invented figure (pass=false because cuts pending) → orchestrator cuts
    // (now ALSO in dry-run) → re-review: clean pass.
    qaReviewImpl: scriptedQA([qaResult({ score: 90, cutClaims: [claim] }), qaResult({ score: 90 })]),
    publishImpl: (args) => { publishedBody = args.article.body; return { slug: "s", path: "/tmp/s.md", written: false }; },
  }));
  assert.equal(report.published.length, 1, "published after the in-memory cut: " + JSON.stringify(report.held));
  assert.ok(!/999 million/.test(publishedBody), "the flagged sentence was actually cut in dry-run");
  assert.equal(store.published.length, 0, "still no store record");
});

// ── 14) LIMIT respected ───────────────────────────────────────────────────────────────────────────
await check("limit respected (stops after N published)", async () => {
  const report = await agentRun(baseImpls({
    storeImpl: freshStore(),
    findImpl: async () => [
      { story: fakeTrigger(), angle: fakeAngle("audience-reaction") },
      { story: fakeTrigger({ parentEventSlug: "other-film", parentTitle: "Other Film", primaryEntity: "Other Film" }), angle: fakeAngle("audience-reaction") },
    ],
    limit: 1,
  }));
  assert.equal(report.published.length, 1);
});

// ── 15) ONE THROWING STORY contained; others continue ─────────────────────────────────────────────
await check("one throwing story contained (report.blocked); the next story still publishes", async () => {
  const impls = baseImpls({
    storeImpl: freshStore(),
    findImpl: async () => [
      { story: fakeTrigger({ parentEventSlug: "boom-film", parentTitle: "Boom Film", primaryEntity: "Boom Film" }), angle: fakeAngle("audience-reaction") },
      { story: fakeTrigger(), angle: fakeAngle("audience-reaction") },
    ],
  });
  const gatherOK = impls.gatherImpl;
  impls.gatherImpl = async (job) => {
    if (job.story.parentEventSlug === "boom-film") throw new Error("boom in gatherer");
    return gatherOK(job);
  };
  const report = await agentRun(impls);
  assert.equal(report.blocked.length, 1);
  assert.ok(/boom in gatherer/.test(report.blocked[0].reason));
  assert.equal(report.published.length, 1, "second story unaffected");
});
await check("finder totally down → report.blocked stage finder, run ends cleanly", async () => {
  const report = await agentRun(baseImpls({
    storeImpl: freshStore(),
    findImpl: async () => { throw new Error("finder exploded"); },
    dryRun: true,
  }));
  assert.equal(report.blocked.length, 1);
  assert.equal(report.blocked[0].stage, "finder");
  assert.equal(report.published.length, 0);
});

// ── cleanup: remove the run-report file the non-dry tests wrote into the real DATA_DIR ────────────
if (!runFileExistedBefore && fs.existsSync(RUN_FILE)) fs.unlinkSync(RUN_FILE);


await check("voice pass: a lock-damaging edit REVERTS to the QA-passed draft; a clean edit ships", async () => {
  const store = freshStore();
  const good = await agentRun(baseImpls({
    storeImpl: store, dryRun: true,
    voiceImpl: async (job) => { job.article = { ...job.article, title: "The internet has a new obsession", body: job.article.body }; return job; },
  }));
  assert.equal(good.published.length, 1, JSON.stringify(good.held));

  const store2 = freshStore();
  let mangledTitle = null;
  const bad = await agentRun(baseImpls({
    storeImpl: store2, dryRun: true,
    voiceImpl: async (job) => {
      // the "editor" invents a quoted span that anchors nowhere — the lock recheck must revert
      job.article = { ...job.article, title: "Mangled", body: job.article.body + '\n\nOne fan supposedly said, "a completely invented viral line that exists nowhere online at all."' };
      mangledTitle = job.article.title;
      return job;
    },
    publishImpl: (args) => { assert.notEqual(args.article.title, "Mangled", "reverted article publishes, not the mangled one"); return { slug: "s", path: "/tmp/x" }; },
  }));
  assert.equal(mangledTitle, "Mangled", "voice impl actually ran");
  assert.equal(bad.published.length, 1, "still publishes — the PRE-voice draft");
});


await check("REVIEW MODE: records a flagged ledger entry, never repeats, never eats the daily cap", async () => {
  process.env.INSIDE_REVIEW_DIR = tmp("review-out");
  try {
    const store = freshStore();
    let publishedDir = null;
    const r1 = await agentRun(baseImpls({
      storeImpl: store,
      publishImpl: (args) => { publishedDir = args.dir || null; return { slug: "review-slug", path: "/tmp/x" }; },
    }));
    assert.equal(r1.published.length, 1, JSON.stringify(r1));
    assert.ok(publishedDir && /review-out/.test(publishedDir), "article routed to the review dir");
    const rec = store.published.find((x) => x.slug === "review-slug");
    assert.ok(rec?.review === true, "ledger entry flagged review");

    const r2 = await agentRun(baseImpls({ storeImpl: store }));
    assert.equal(r2.published.length, 0, "same story never previews twice");
    assert.ok(r2.skipped.some((x) => /already published/.test(x.reason)), JSON.stringify(r2.skipped));
  } finally { delete process.env.INSIDE_REVIEW_DIR; }
});

await check("review ledger entries do NOT consume the live daily cap", async () => {
  const store = freshStore();
  for (let i = 0; i < 40; i++) store.published.push({ key: `k${i}|audience-reaction`, review: true, at: new Date(NOW).toISOString(), slug: `s${i}`, parentEventSlug: `k${i}`, form: "audience-reaction" });
  const r = await agentRun(baseImpls({ storeImpl: store, dryRun: true, nowMs: NOW }));
  assert.equal(r.published.length, 1, "40 review records today, cap untouched → still publishes: " + JSON.stringify(r));
});

console.log(`\n=== PIPELINE: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log("FAILED: " + fails.join(", ")); process.exit(1); }
