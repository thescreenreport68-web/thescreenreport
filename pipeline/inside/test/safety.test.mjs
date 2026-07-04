// INSIDE lane — SAFETY CONSTITUTION (REV 2; offline, end-to-end-ish: REAL reactionFinder / gate /
// store logic; only the chat + network impls are injected). These are the invariants that make the
// lane publishable at all — a failure here is a fabrication or hoax vector.
// Run: env -i node site/pipeline/inside/test/safety.test.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { harvestReactions } from "../reactionFinder.mjs";
import { deterministicInside, gateInside } from "../gate.mjs";
import { loadStore, alreadyPublished, recordInsidePublished } from "../store.mjs";
import {
  NOW, tmp, Q, SRC_A, SRC_B, SOURCES,
  fakeTrigger, fakeAngle, fakeFactBlock, fakeArticle,
} from "./fixtures.mjs";

let pass = 0, fail = 0; const fails = [];
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; fails.push(name); console.log(`  ❌ ${name}  ${String(e?.message || e).slice(0, 240)}`); }
};

console.log("\n=== INSIDE SAFETY CONSTITUTION (REV 2, offline) ===\n");

// A chatImpl dispatcher: routes by the system prompt so we can script extraction vs classification.
// `extract(source_i)` decides what "reactions" the LLM claims to find in each source.
function makeChat({ extract, classifyReddit = () => [], classifyTweets = () => [] }) {
  return async ({ system, user }) => {
    if (/extract REACTIONS & QUOTES about a specific/i.test(system)) {
      // Identify which source index is in the user prompt.
      const m = user.match(/SOURCE (\d+)/);
      const i = m ? Number(m[1]) : 0;
      return { data: { reactions: extract(i) }, usage: {} };
    }
    if (/classify Reddit comments/i.test(system)) return { data: { comments: classifyReddit() }, usage: {} };
    if (/classify public X posts/i.test(system)) return { data: { posts: classifyTweets() }, usage: {} };
    return { data: {}, usage: {} };
  };
}

// A findContentImpl that returns our two canned sources on the first query, nothing after.
function makeFinder(sources = SOURCES) {
  let served = false;
  return async () => {
    if (served) return { blocked: true, reason: "no more" };
    served = true;
    return { blocked: false, sources: sources.map((s) => ({ ...s })) };
  };
}

const harvestOpts = (over = {}) => ({
  findContentImpl: makeFinder(),
  cacheTweetsImpl: async () => ({ tweets: [], ids: [] }),
  scanImpl: async () => [],
  redditSearchImpl: async () => [],
  redditCommentsImpl: async () => [],
  reddit: false,
  embeds: false,
  ...over,
});

// ── 1) A FABRICATED extraction quote dies at the verbatim wall → under floor ──────────────────────
await check("fabricated extraction quote dropped at verbatim wall → under floor", async () => {
  const trigger = fakeTrigger();
  const angle = fakeAngle("audience-reaction"); // minAnchors 3
  // The LLM 'extracts' ONLY fabricated fan quotes (none exist in SRC_A/SRC_B) → all fail the wall.
  const chatImpl = makeChat({
    extract: () => [
      { speaker: "", speakerType: "fan", platform: "X", quote: "This is a completely invented quote nobody ever wrote anywhere", stance: "positive" },
      { speaker: "", speakerType: "fan", platform: "X", quote: "Another fabricated reaction that is not in the source text at all", stance: "negative" },
      { speaker: "", speakerType: "fan", platform: "X", quote: "A third made-up line the model hallucinated on its own", stance: "mixed" },
    ],
  });
  const h = await harvestReactions(trigger, angle, harvestOpts({ chatImpl }));
  assert.equal(h.ok, false, "harvest fails the floor");
  assert.ok(/under floor/.test(h.reason), "reason is under-floor: " + h.reason);
});

// ── 1b) REAL extracted quotes pass the wall and clear the floor (control) ──────────────────────────
await check("real extracted quotes pass the wall and clear the floor (control)", async () => {
  const trigger = fakeTrigger();
  const angle = fakeAngle("audience-reaction");
  const chatImpl = makeChat({
    extract: (i) => i === 1 ? [
      { speaker: "", speakerType: "fan", platform: "X", quote: Q.fanLove, stance: "positive" },
      { speaker: "", speakerType: "fan", platform: "X", quote: Q.fanHate, stance: "negative" },
      { speaker: "", speakerType: "fan", platform: "X", quote: Q.fanSplit, stance: "mixed" },
    ] : [],
  });
  const h = await harvestReactions(trigger, angle, harvestOpts({ chatImpl }));
  assert.equal(h.ok, true, "control passes: " + (h.reason || ""));
  assert.equal(h.factBlock.aggregateFans.length, 3);
});

// ── 2) AUDIENCE NAMES NEVER LEAK — a 'fan' with a name gets speaker forced to "" ──────────────────
await check("aggregateFans speaker is forced empty even if the LLM names a fan", async () => {
  const trigger = fakeTrigger();
  const angle = fakeAngle("audience-reaction");
  const chatImpl = makeChat({
    extract: (i) => i === 1 ? [
      // LLM wrongly attaches a real-looking name to an ordinary fan → the split() must scrub it.
      { speaker: "Jane Q. Public", speakerType: "fan", platform: "X", quote: Q.fanLove, stance: "positive" },
      { speaker: "Some Rando", speakerType: "fan", platform: "X", quote: Q.fanHate, stance: "negative" },
      { speaker: "Another Person", speakerType: "fan", platform: "X", quote: Q.fanSplit, stance: "mixed" },
    ] : [],
  });
  const h = await harvestReactions(trigger, angle, harvestOpts({ chatImpl }));
  assert.equal(h.ok, true, h.reason || "");
  assert.ok(h.factBlock.aggregateFans.length >= 3);
  assert.ok(h.factBlock.aggregateFans.every((r) => r.speaker === ""), "every fan speaker scrubbed to ''");
  assert.equal(h.factBlock.stats.namedVoices, 0, "no named voices from fans");
});

// ── 3) WRITER quoting a NON-ANCHOR speaker → deterministicInside hard-block ───────────────────────
await check("writer quoting a non-anchor speaker → hard-block", async () => {
  const fb = fakeFactBlock("creator-answers-critics");
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  art.reactionsRender.push({ speaker: "Imaginary Producer", connection: "", platform: "X", date: "", quote: Q.director, tweetId: "" });
  const r = deterministicInside(art, fb, fakeAngle("creator-answers-critics"));
  assert.ok(r.hardBlocks.some((b) => /invented-speaker/.test(b)), r.hardBlocks.join(" | "));
});

// ── 4) AUDIENCE quote reattributed to a NAMED creator → hard-block ────────────────────────────────
await check("audience quote reattributed to a named creator → hard-block", async () => {
  const fb = fakeFactBlock("creator-answers-critics"); // has named director + fan posts
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  // Put a fan's quote in the director's mouth (a real speaker, but not HER verbatim line).
  art.reactionsRender = [{ speaker: "Priya Anand", connection: "director of The Sable Coast", platform: "interview", date: "", quote: Q.fanHate, tweetId: "" }];
  const r = deterministicInside(art, fb, fakeAngle("creator-answers-critics"));
  assert.ok(r.hardBlocks.some((b) => /misattributed-or-unverbatim/.test(b)), r.hardBlocks.join(" | "));
});

// ── 5) SAME story×form NEVER published twice ──────────────────────────────────────────────────────
await check("same story×form never published twice (dedup ledger)", async () => {
  const store = loadStore(path.join(tmp("inside-safety"), "store.json"));
  assert.equal(alreadyPublished(store, "the-sable-coast-2026", "audience-reaction"), false);
  recordInsidePublished(store, { parentEventSlug: "the-sable-coast-2026", form: "audience-reaction", slug: "s1", title: "t" });
  assert.equal(alreadyPublished(store, "the-sable-coast-2026", "audience-reaction"), true, "recorded");
  // a different form of the SAME story is still open (per-form dedup), but the same one is closed forever.
  assert.equal(alreadyPublished(store, "the-sable-coast-2026", "the-debate"), false);
  // re-recording the same key does not create a duplicate.
  recordInsidePublished(store, { parentEventSlug: "the-sable-coast-2026", form: "audience-reaction", slug: "s1", title: "t" });
  assert.equal(store.published.filter((r) => r.key === "the-sable-coast-2026|audience-reaction").length, 1, "single ledger entry");
});

// ── 6) A STATED NUMBER not in the anchors → specificsGuard cut ─────────────────────────────────────
await check("a stated number not in the anchors is flagged for cut (specificsGuard via gateInside)", async () => {
  const trigger = fakeTrigger();
  const angle = fakeAngle("audience-reaction");
  const fb = fakeFactBlock("audience-reaction"); // no numbers in any anchor quote
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  // Inject an invented box-office figure that appears nowhere in the anchors/sources.
  art.body += `\n\nThe film has already grossed $412 million worldwide, an unusually strong run.`;
  // The judge (chatImpl) is only called when there are no fatal blocks; return a clean high score.
  const chatImpl = async () => ({ data: { score: 88, subscores: { readability: 8, engagement: 8, humanVoice: 8 }, strengths: [], weaknesses: [] }, usage: {} });
  const scored = await gateInside({ article: art, trigger, angle, factBlock: fb, chatImpl });
  assert.ok(scored.cutClaims.some((c) => /412/.test(c)), "invented $412 million figure flagged: " + JSON.stringify(scored.cutClaims));
});

// ── 6b) control: an article with only anchored content produces NO cutClaims ───────────────────────
await check("clean anchored article produces no specificsGuard cuts", async () => {
  const trigger = fakeTrigger();
  const angle = fakeAngle("audience-reaction");
  const fb = fakeFactBlock("audience-reaction");
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  const chatImpl = async () => ({ data: { score: 88, subscores: { readability: 8, engagement: 8, humanVoice: 8 }, strengths: [], weaknesses: [] }, usage: {} });
  const scored = await gateInside({ article: art, trigger, angle, factBlock: fb, chatImpl });
  assert.deepEqual(scored.hardBlocks, [], "no hard blocks: " + scored.hardBlocks.join(" | "));
  assert.deepEqual(scored.cutClaims, [], "no cut claims: " + JSON.stringify(scored.cutClaims));
});

console.log(`\n=== SAFETY: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log("FAILED: " + fails.join(", ")); process.exit(1); }
