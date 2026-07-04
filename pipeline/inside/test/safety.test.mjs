// INSIDE lane — SAFETY CONSTITUTION (offline, end-to-end-ish: REAL reactionFinder / gate /
// trigger / store logic; only the chat + network impls are injected). These are the invariants
// that make the lane publishable at all — a failure here is a fabrication or hoax vector.
// Run: node site/pipeline/inside/test/safety.test.mjs
import path from "node:path";
import { harvestReactions } from "../reactionFinder.mjs";
import { loadTriggers } from "../trigger.mjs";
import { deterministicInside, classifyInsideBlocks } from "../gate.mjs";
import { insideRun } from "../insiderun.mjs";
import { loadStore, recordInsidePublished } from "../store.mjs";
import {
  NOW, tmp, Q, SRC_A, SRC_B, TWEET_ID_A,
  fakeTrigger, fakeAngle, fakeFactBlock, fakeArticle, queueTopic, fakeFindFiles,
} from "./fixtures.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (name, cond, detail = "") => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; fails.push(name); console.log(`  ❌ ${name}  ${detail}`); } };

console.log("\n=== INSIDE SAFETY CONSTITUTION (offline, real lane logic) ===\n");

const srcA = { url: "https://variety.example/rex-harmon-tributes", domain: "variety.com", text: SRC_A };
const srcB = { url: "https://ew.example/rex-harmon-fans-react", domain: "ew.com", text: SRC_B };
const noTweets = async () => ({ ids: [] });

// (i) THE VERBATIM WALL — an extractor "quote" that is not literally in the source never reaches
//     the writer; with nothing else harvested the angle dies under the floor.
{
  console.log("— (i) fabricated extraction quote → dropped by the wall → under floor —");
  const trigger = fakeTrigger();
  const angle = fakeAngle("single-voice");
  const fabricated = async () => ({ data: { reactions: [
    { speaker: "Mira Vale", speakerType: "castmate", connection: "his co-star of two decades", platform: "Instagram", date: "", quote: "He was my best friend and I am devastated beyond words tonight", stance: "positive" },
  ] } });
  const h = await harvestReactions(trigger, angle, { findContentImpl: async () => ({ blocked: false, sources: [srcA] }), chatImpl: fabricated, cacheTweetsImpl: noTweets });
  check("fabricated quote → harvest fails closed (under floor)", h.ok === false && /under floor/.test(h.reason), JSON.stringify(h));

  const verbatim = async () => ({ data: { reactions: [
    { speaker: "Mira Vale", speakerType: "castmate", connection: "his co-star of two decades", platform: "Instagram", date: "", quote: Q.mira, stance: "positive" },
  ] } });
  let cachedWith = null;
  const h2 = await harvestReactions(trigger, angle, {
    findContentImpl: async () => ({ blocked: false, sources: [srcA] }),
    chatImpl: verbatim,
    cacheTweetsImpl: async (ids) => { cachedWith = ids; return { ids: [] }; },
  });
  check("the SAME speaker with the REAL verbatim quote passes the wall", h2.ok === true && h2.factBlock.reactions.length === 1 && h2.factBlock.reactions[0].quote === Q.mira);
  check("embeds only via the syndication cache (found id offered, uncached → none kept)",
    JSON.stringify(cachedWith) === JSON.stringify([TWEET_ID_A]) && h2.factBlock.tweetIds.length === 0);
  check("no-material bundle fails closed",
    (await harvestReactions(trigger, angle, { findContentImpl: async () => ({ blocked: true, reason: "no sources" }), chatImpl: verbatim, cacheTweetsImpl: noTweets })).ok === false);
}

// (ii) THE SPEAKER WALL — a writer voice that isn't in the harvest is a fatal hard stop.
{
  console.log("\n— (ii) invented writer voice → deterministic hard stop —");
  const fb = fakeFactBlock("peer-tributes");
  const angle = fakeAngle("peer-tributes");
  const art = fakeArticle({ form: "peer-tributes", factBlock: fb });
  art.reactionsRender = [...art.reactionsRender, { speaker: "Denzel Whitaker Jr.", connection: "close friend", platform: "X", date: "", quote: Q.mira, tweetId: "" }];
  const det = deterministicInside(art, fb, angle);
  const blocks = det.hardBlocks.filter((b) => b.startsWith("invented-speaker"));
  check("invented speaker detected", blocks.length === 1, JSON.stringify(det.hardBlocks));
  check("invented speaker is a HARD stop, never fixable-by-cutting", classifyInsideBlocks(det.hardBlocks).block.some((b) => b.startsWith("invented-speaker")));

  const art2 = fakeArticle({ form: "peer-tributes", factBlock: fb });
  art2.reactionsRender[0] = { ...art2.reactionsRender[0], quote: Q.mira.replace("grace", "class").replace("kindness", "warmth") };
  check("a 'tidied' quote from a REAL speaker is equally fatal",
    classifyInsideBlocks(deterministicInside(art2, fb, angle).hardBlocks).block.some((b) => b.startsWith("misattributed-or-unverbatim-quote")));

  // per-speaker haystacks: two REAL quotes stitched into one, and a real quote on the wrong
  // person's card, are both fatal — no single-haystack loophole.
  const art3 = fakeArticle({ form: "peer-tributes", factBlock: fb });
  art3.reactionsRender[0] = { ...art3.reactionsRender[0], quote: `${Q.mira} ${Q.onder}` };
  check("two adjacent harvest quotes MERGED into one card → fatal",
    classifyInsideBlocks(deterministicInside(art3, fb, angle).hardBlocks).block.some((b) => b.startsWith("misattributed-or-unverbatim-quote")));
  const art4 = fakeArticle({ form: "peer-tributes", factBlock: fb });
  art4.reactionsRender[1] = { ...art4.reactionsRender[1], speaker: "Paul Onder", quote: Q.mira };
  check("a real quote MISATTRIBUTED to another harvested speaker → fatal",
    classifyInsideBlocks(deterministicInside(art4, fb, angle).hardBlocks).block.some((b) => b.startsWith("misattributed-or-unverbatim-quote")));
}

// (iii) THE HOAX WALL — an unconfirmed death NEVER becomes a trigger, no matter how loud.
{
  console.log("\n— (iii) unconfirmed death never triggers —");
  const { queuePath, ledgerPath } = fakeFindFiles({
    topics: [
      queueTopic({ eventSlug: "gale-brody-dies", primaryEntity: "Gale Brody", priority: 95, verification: { status: "DEVELOPING", outletCount: 9, publishable: true, sensitivity: "high" } }),
      queueTopic(), // the CONFIRMED control
    ],
    entries: [],
  });
  const trs = await loadTriggers({ queuePath, ledgerPath, searchPersonImpl: async () => ({ id: 1 }), nowMs: NOW });
  check("DEVELOPING death dropped even at priority 95 / 9 outlets", !trs.some((t) => t.parentEventSlug === "gale-brody-dies"));
  check("CONFIRMED death control still triggers", trs.some((t) => t.parentEventSlug === "rex-harmon-dies"));
}

// (iv) THE FAMOUS WALL — all three famousness signals miss → no ripple story exists.
{
  console.log("\n— (iv) non-famous subject dropped —");
  const nobody = queueTopic({ eventSlug: "kip-nobody-cast", title: "Kip Nobody cast in indie short", primaryEntity: "Kip Nobody", eventType: "casting", priority: 12, verification: { status: "CONFIRMED", outletCount: 1, publishable: true } });
  const { queuePath, ledgerPath } = fakeFindFiles({ topics: [nobody], entries: [] });
  const none = await loadTriggers({ queuePath, ledgerPath, searchPersonImpl: async () => null, nowMs: NOW });
  check("outlets<3 + priority<55 + TMDB-unknown → dropped, no LLM spent", none.length === 0);
  const fuzzyHit = await loadTriggers({ queuePath, ledgerPath, searchPersonImpl: async () => ({ id: 7, name: "Kip Nobody", popularity: 0.3, knownFor: 0 }), nowMs: NOW });
  check("a popularity-0 fuzzy TMDB HIT is still not fame → dropped", fuzzyHit.length === 0);
  const tmdbKnown = await loadTriggers({ queuePath, ledgerPath, searchPersonImpl: async () => ({ id: 7, name: "Kip Nobody", popularity: 11, knownFor: 3 }), nowMs: NOW });
  check("the SAME event triggers once TMDB knows the person as GENUINELY notable", tmdbKnown.length === 1 && tmdbKnown[0].parentEventSlug === "kip-nobody-cast");
}

// (v) THE PRIVACY WALL — fan reactions never carry a private person's name into the fact block.
{
  console.log("\n— (v) fan names never survive the harvest —");
  const trigger = fakeTrigger();
  const angle = fakeAngle("fan-pulse");
  const namedFans = async () => ({ data: { reactions: [
    { speaker: "Jane Crowley", speakerType: "fan", platform: "X", date: "", quote: Q.fan1, stance: "positive" },
    { speaker: "@rexstan4ever", speakerType: "fan", platform: "X", date: "", quote: Q.fan2, stance: "positive" },
    { speaker: "Bob from Ohio", speakerType: "fan", platform: "X", date: "", quote: Q.fan3, stance: "negative" },
    { speaker: "moviemom88", speakerType: "fan", platform: "X", date: "", quote: Q.fan4, stance: "positive" },
  ] } });
  const h = await harvestReactions(trigger, angle, { findContentImpl: async () => ({ blocked: false, sources: [srcB] }), chatImpl: namedFans, cacheTweetsImpl: noTweets });
  check("fan-pulse harvest passes its floor on 4 verbatim fan posts", h.ok === true, JSON.stringify(h));
  check("EVERY fan speaker forced to empty string", h.factBlock.aggregateFans.length === 4 && h.factBlock.aggregateFans.every((r) => r.speaker === ""));
  check("no named-voice entry was minted from a fan", h.factBlock.reactions.length === 0);
  check("divided sentiment computed honestly from the harvest", h.factBlock.stats.divided === true);
}

// (vi) THE NEVER-TWICE WALL — one event×form publishes once, forever; a different form stays free.
{
  console.log("\n— (vi) same event×form never published twice —");
  const store = loadStore(path.join(tmp("inside-safety-store"), "store.json"));
  recordInsidePublished(store, { parentEventSlug: "rex-harmon-dies", form: "peer-tributes", slug: "already-live", title: "t" }, { now: new Date(NOW) });
  const trigger = fakeTrigger();
  let wrote = 0;
  const impls = (form) => ({
    loadTriggersImpl: async () => [trigger],
    proposeAnglesImpl: async () => [fakeAngle(form)],
    harvestImpl: async (t, a) => ({ ok: true, factBlock: fakeFactBlock(a.form), bundle: { sources: [] } }),
    editorialImpl: async () => ({ ran: true, reject: false }),
    generateImpl: async ({ angle, factBlock }) => ({ article: fakeArticle({ form: angle.form, factBlock }) }),
    gateImpl: async () => ({ score: 90, pass: true, subscores: {}, deterministic: {}, hardBlocks: [], cutClaims: [], vgVerdict: null, strengths: [], weaknesses: [] }),
    writeImpl: (a) => { wrote++; return { slug: "x-" + a.angle.form, written: false }; },
    storeImpl: store, hero: false, webVerify: false, nowMs: NOW,
  });
  const again = await insideRun(impls("peer-tributes"));
  check("re-running the published event×form → skipped, zero writes",
    again.skipped.length === 1 && /already published/.test(again.skipped[0].reason) && wrote === 0 && !again.published.length);
  const otherForm = await insideRun(impls("cast-crew-voices"));
  check("a DIFFERENT form of the same event still publishes (dedup is per form, not per event)",
    otherForm.published.length === 1 && wrote === 1);
  check("...and is then itself locked forever", (await insideRun(impls("cast-crew-voices"))).skipped.length === 1 && wrote === 1);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Inside safety constitution green. ✅\n");
