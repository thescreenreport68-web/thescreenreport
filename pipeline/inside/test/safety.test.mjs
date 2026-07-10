// INSIDE lane — SAFETY CONSTITUTION (multi-agent; offline, end-to-end-ish: the REAL gatherer agent
// driving the REAL harvestReactions verbatim wall, the REAL qa.factLocks, the REAL store — only the
// chat + network impls are injected). These are the invariants that make the lane publishable at
// all — a failure here is a fabrication or hoax vector.
// Run: env -i node site/pipeline/inside/test/safety.test.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { run as gathererRun } from "../agents/gatherer.mjs";
import { harvestReactions } from "../reactionFinder.mjs";
import { factLocks, review as qaReview } from "../agents/qa.mjs";
import { loadStore, alreadyPublished, recordInsidePublished } from "../store.mjs";
import {
  tmp, Q, SOURCES,
  fakeTrigger, fakeAngle, fakeFactBlock, fakeArticle, fakeJob,
} from "./fixtures.mjs";

let pass = 0, fail = 0; const fails = [];
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; fails.push(name); console.log(`  ❌ ${name}  ${String(e?.message || e).slice(0, 240)}`); }
};

console.log("\n=== INSIDE SAFETY CONSTITUTION (multi-agent, offline) ===\n");

// A chatImpl dispatcher: routes by the system prompt so we can script extraction vs classification.
// The gatherer's metered shim passes {model, temperature, system, user, ...} straight through.
function makeChat({ extract, classifyReddit = () => [], classifyTweets = () => [] }) {
  return async ({ system, user }) => {
    if (/extract REACTIONS & QUOTES/i.test(system)) {
      const m = user.match(/SOURCE (\d+)/);
      return { data: { reactions: extract(m ? Number(m[1]) : 0) }, usage: {} };
    }
    if (/classify Reddit comments/i.test(system)) return { data: { comments: classifyReddit() }, usage: {} };
    if (/classify public X posts/i.test(system)) return { data: { posts: classifyTweets() }, usage: {} };
    return { data: {}, usage: {} };
  };
}

// A findContentImpl that serves our two canned sources on the first query, nothing after.
function makeFinder(sources = SOURCES) {
  let served = false;
  return async () => {
    if (served) return { blocked: true, reason: "no more" };
    served = true;
    return { blocked: false, sources: sources.map((s) => ({ ...s })) };
  };
}

// Drive the REAL gatherer agent (its metered chat shim + the real harvest engine), network-free:
// wrap harvestReactions so the engine's own web/reddit/tweet impls are stubbed out.
const gatherJob = async (form, chatImpl) => {
  const job = { story: fakeTrigger(), angle: fakeAngle(form) };
  const harvestImpl = (story, angle, opts) => harvestReactions(story, angle, {
    ...opts, // keeps the gatherer's chatImpl shim + model routing in play
    findContentImpl: makeFinder(),
    cacheTweetsImpl: async () => ({ tweets: [], ids: [] }),
    scanImpl: async () => [],
    redditSearchImpl: async () => [],
    redditCommentsImpl: async () => [],
    reddit: false,
    embeds: false,
  });
  await gathererRun(job, { harvestImpl, chatImpl });
  return job;
};

// ── 1) A FABRICATED extraction quote dies at the verbatim wall → gatherFail under floor ───────────
await check("fabricated extraction quote dropped at the verbatim wall → gatherFail 'under floor'", async () => {
  const chatImpl = makeChat({
    extract: () => [
      { speaker: "", speakerType: "fan", platform: "X", quote: "This is a completely invented quote nobody ever wrote anywhere", stance: "positive" },
      { speaker: "", speakerType: "fan", platform: "X", quote: "Another fabricated reaction that is not in the source text at all", stance: "negative" },
      { speaker: "", speakerType: "fan", platform: "X", quote: "A third made-up line the model hallucinated on its own", stance: "mixed" },
    ],
  });
  const job = await gatherJob("audience-reaction", chatImpl); // minAnchors 3
  assert.ok(job.gatherFail, "gather must fail");
  assert.ok(/under floor/.test(job.gatherFail), "reason is under-floor: " + job.gatherFail);
  assert.ok(!job.factBlock, "no fact block ever reaches the writer");
});

// ── 1b) REAL extracted quotes pass the wall and fill the work-file (control) ──────────────────────
await check("real extracted quotes pass the wall; gatherer fills factBlock/factText/gatherStats", async () => {
  const chatImpl = makeChat({
    extract: (i) => i === 1 ? [
      { speaker: "", speakerType: "fan", platform: "X", quote: Q.fanLove, stance: "positive" },
      { speaker: "", speakerType: "fan", platform: "X", quote: Q.fanHate, stance: "negative" },
      { speaker: "", speakerType: "fan", platform: "X", quote: Q.fanSplit, stance: "mixed" },
    ] : [],
  });
  const job = await gatherJob("audience-reaction", chatImpl);
  assert.ok(!job.gatherFail, job.gatherFail || "");
  assert.equal(job.factBlock.aggregateFans.length, 3);
  assert.ok(/AUDIENCE POSTS/.test(job.factText), "factText rendered");
  assert.equal(job.gatherStats.fanPosts, 3);
  assert.equal(job.gatherStats.divided, true, "both stances present → honest divided flag");
});

// ── 2) AUDIENCE NAMES NEVER LEAK — a named 'fan' is scrubbed to "" by the harvest split ───────────
await check("aggregateFans speaker forced empty even when the LLM names a fan", async () => {
  const chatImpl = makeChat({
    extract: (i) => i === 1 ? [
      { speaker: "Jane Q. Public", speakerType: "fan", platform: "X", quote: Q.fanLove, stance: "positive" },
      { speaker: "Some Rando", speakerType: "fan", platform: "X", quote: Q.fanHate, stance: "negative" },
      { speaker: "Another Person", speakerType: "fan", platform: "X", quote: Q.fanSplit, stance: "mixed" },
    ] : [],
  });
  const job = await gatherJob("audience-reaction", chatImpl);
  assert.ok(!job.gatherFail, job.gatherFail || "");
  assert.ok(job.factBlock.aggregateFans.length >= 3);
  assert.ok(job.factBlock.aggregateFans.every((r) => r.speaker === ""), "every fan speaker scrubbed to ''");
  assert.equal(job.factBlock.stats.namedVoices, 0, "no named voices from fans");
  assert.ok(!/Jane Q\. Public|Some Rando|Another Person/.test(job.factText), "no fan name leaks into the writer's anchor block");
});

// ── 3) WRITER quoting a NON-ANCHOR speaker → factLocks hard-block ─────────────────────────────────
await check("writer quoting a non-anchor speaker → factLocks hard-block", async () => {
  const fb = fakeFactBlock("creator-answers-critics");
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  art.reactionsRender.push({ speaker: "Imaginary Producer", connection: "", platform: "X", date: "", quote: Q.director, tweetId: "" });
  const r = factLocks(art, fb, fakeAngle("creator-answers-critics"));
  assert.ok(r.hardBlocks.some((b) => /invented-speaker/.test(b)), r.hardBlocks.join(" | "));
});

// ── 4) AUDIENCE quote reattributed to a NAMED creator → factLocks hard-block ──────────────────────
await check("audience quote reattributed to a named creator → factLocks hard-block", async () => {
  const fb = fakeFactBlock("creator-answers-critics"); // has the named director + fan posts
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  art.reactionsRender = [{ speaker: "Priya Anand", connection: "director of The Sable Coast", platform: "interview", date: "", quote: Q.fanHate, tweetId: "" }];
  const r = factLocks(art, fb, fakeAngle("creator-answers-critics"));
  assert.ok(r.hardBlocks.some((b) => /misattributed-or-unverbatim/.test(b)), r.hardBlocks.join(" | "));
});

// ── 5) SAME story×form NEVER published twice ──────────────────────────────────────────────────────
await check("same story×form never published twice (dedup ledger)", async () => {
  const store = loadStore(path.join(tmp("inside-safety"), "store.json"));
  assert.equal(alreadyPublished(store, "the-sable-coast-2026", "audience-reaction"), false);
  recordInsidePublished(store, { parentEventSlug: "the-sable-coast-2026", form: "audience-reaction", slug: "s1", title: "t" });
  assert.equal(alreadyPublished(store, "the-sable-coast-2026", "audience-reaction"), true, "recorded");
  assert.equal(alreadyPublished(store, "the-sable-coast-2026", "the-debate"), false, "a different form of the same story stays open");
  recordInsidePublished(store, { parentEventSlug: "the-sable-coast-2026", form: "audience-reaction", slug: "s1", title: "t" });
  assert.equal(store.published.filter((r) => r.key === "the-sable-coast-2026|audience-reaction").length, 1, "single ledger entry");
});

// ── 6) A STATED NUMBER not in the anchors → specificsGuard cut (via the real qa.review) ───────────
await check("a stated number not in the anchors is flagged for cut AND sinks the pass", async () => {
  const art = fakeArticle({ form: "audience-reaction" });
  art.body += `\n\nThe film has already grossed $412 million worldwide, an unusually strong run.`;
  const job = fakeJob("audience-reaction", { article: art });
  const chatImpl = async () => ({ data: { score: 88, subscores: { readability: 8, engagement: 8, humanVoice: 8 }, strengths: [], weaknesses: [] }, usage: {} });
  await qaReview(job, { chatImpl });
  assert.ok(job.qa.cutClaims.some((c) => /412/.test(c)), "invented $412M figure flagged: " + JSON.stringify(job.qa.cutClaims));
  assert.equal(job.qa.pass, false, "an unsupported specific never rides a passing score (2026-07-10)");
});

// ── 7) SUBJECT LABEL fallback (2026-07-10): person story without a category still gets a sane
// disambiguation label in every extraction prompt ("(a film/TV figure)"), never "(a undefined figure)".
await check("harvest subject label falls back to 'film/TV' when the trigger has no category", async () => {
  const seenUsers = [];
  const chatImpl = async ({ system, user }) => {
    if (/extract REACTIONS & QUOTES/i.test(system)) { seenUsers.push(user); return { data: { reactions: [] }, usage: {} }; }
    return { data: {}, usage: {} };
  };
  const story = fakeTrigger({ work: null, category: undefined, subjectKind: "person", primaryEntity: "Nora Idris" });
  const job = { story, angle: fakeAngle("breakout-buzz", { focusEntity: "Nora Idris" }) };
  const harvestImpl = (s, a, opts) => harvestReactions(s, a, {
    ...opts,
    findContentImpl: makeFinder(),
    cacheTweetsImpl: async () => ({ tweets: [], ids: [] }),
    scanImpl: async () => [], redditSearchImpl: async () => [], redditCommentsImpl: async () => [],
    reddit: false, embeds: false,
  });
  await gathererRun(job, { harvestImpl, chatImpl });
  assert.ok(seenUsers.length > 0, "extraction prompts were issued");
  assert.ok(seenUsers.every((u) => /Nora Idris \(a film\/TV figure\)/.test(u)), "fallback label used: " + seenUsers[0].slice(0, 120));
  assert.ok(!seenUsers.some((u) => /undefined/.test(u)), "no 'undefined' ever reaches a prompt");
});

// ── 6b) control: a fully anchored article produces NO blocks and NO cuts ──────────────────────────
await check("clean anchored article: no factLock blocks, no specificsGuard cuts", async () => {
  const job = fakeJob("audience-reaction", { article: fakeArticle({ form: "audience-reaction" }) });
  const chatImpl = async () => ({ data: { score: 88, subscores: { readability: 8, engagement: 8, humanVoice: 8 }, strengths: [], weaknesses: [] }, usage: {} });
  await qaReview(job, { chatImpl });
  assert.deepEqual(job.qa.hardBlocks, [], "no hard blocks: " + job.qa.hardBlocks.join(" | "));
  assert.deepEqual(job.qa.cutClaims, [], "no cut claims");
  assert.equal(job.qa.pass, true);
});

console.log(`\n=== SAFETY: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log("FAILED: " + fails.join(", ")); process.exit(1); }
