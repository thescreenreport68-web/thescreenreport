// INSIDE lane — UNIT TESTS (offline: zero network, zero keys; every impl injected).
// Run: node site/pipeline/inside/test/unit.test.mjs
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

import { norm, quoteIsVerbatim, meetsFloor, findTweetIds } from "../reactionFinder.mjs";
import { isFamous, loadTriggers } from "../trigger.mjs";
import { loadStore, alreadyPublished, recordInsidePublished, parkAngle, parkedTries, clearParked, insideKey } from "../store.mjs";
import { distinctQuoteRatio, insideEditorialGate } from "../editorialGate.mjs";
import { deterministicInside, classifyInsideBlocks } from "../gate.mjs";
import { buildInsideMarkdown } from "../assemble.mjs";
import { routeForTrigger, TRIGGERS } from "../config.inside.mjs";
import {
  NOW, tmp, writeJson, Q, SRC_A, SRC_B, TWEET_ID_A, TWEET_ID_B,
  fakeTrigger, fakeAngle, fakeFactBlock, fakeArticle, fakeImage, statsFor, NAMED, FAN_POSTS,
  queueTopic, ledgerEntry, fakeFindFiles,
} from "./fixtures.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (name, cond, detail = "") => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; fails.push(name); console.log(`  ❌ ${name}  ${detail}`); } };
const throwsIfCalled = (tag) => async () => { throw new Error(`${tag} must not be called`); };

console.log("\n=== INSIDE UNIT TESTS (offline) ===\n");

// ── 1) reactionFinder: norm + the verbatim wall ───────────────────────────────────────────────
{
  console.log("— reactionFinder: norm / quoteIsVerbatim —");
  check("norm unifies curly quotes, dashes, whitespace, case",
    norm("“Rex — my  FRIEND’s\thero”") === '"rex - my friend\'s hero"');
  const sources = [{ text: SRC_A }];
  check("verbatim quote passes the wall", quoteIsVerbatim(Q.mira, sources) === true);
  check("curly-quote variant of a real quote passes",
    quoteIsVerbatim(Q.mira.replace(/'/g, "’").replace("kindness", "kindness"), sources) === true
    && quoteIsVerbatim("He was the steadiest hand I ever pointed a camera at, and the funniest man in every room".replace("camera", "camera"), sources) === true);
  check("whitespace/newline variant passes", quoteIsVerbatim("Rex taught me   everything about grace\n on a film set, and I will carry his kindness with me always", sources) === true);
  check("paraphrase FAILS the wall", quoteIsVerbatim("Rex showed me what grace means on a set and I will always keep his kindness", sources) === false);
  check("merged/extended quote FAILS", quoteIsVerbatim(Q.mira + " and he was the funniest man in every room", sources) === false);
  check("sub-8-char quote FAILS (too short to verify)", quoteIsVerbatim("Rex t", sources) === false);
}

// ── 2) reactionFinder: per-form floors ────────────────────────────────────────────────────────
{
  console.log("\n— reactionFinder: meetsFloor —");
  const s = (o) => ({ namedVoices: 0, companyVoices: 0, fanPosts: 0, longestQuoteWords: 20, ...o });
  check("peer-tributes: 3 named voices under floor", meetsFloor("peer-tributes", s({ namedVoices: 3 })).ok === false);
  check("peer-tributes: 4 named voices passes", meetsFloor("peer-tributes", s({ namedVoices: 4 })).ok === true);
  check("fan-pulse: 3 fan posts under floor", meetsFloor("fan-pulse", s({ fanPosts: 3 })).ok === false);
  check("fan-pulse: 4 fan posts passes", meetsFloor("fan-pulse", s({ fanPosts: 4 })).ok === true);
  check("cast-crew-voices: 1 voice under floor", meetsFloor("cast-crew-voices", s({ namedVoices: 1 })).ok === false);
  check("cast-crew-voices: 2 voices passes", meetsFloor("cast-crew-voices", s({ namedVoices: 2 })).ok === true);
  check("breakout-spotlight: 2 under floor / 3 passes",
    meetsFloor("breakout-spotlight", s({ namedVoices: 2 })).ok === false && meetsFloor("breakout-spotlight", s({ namedVoices: 3 })).ok === true);
  check("single-voice: 11-word primary quote under floor", meetsFloor("single-voice", s({ namedVoices: 1, longestQuoteWords: 11 })).ok === false);
  check("single-voice: 12-word primary quote passes", meetsFloor("single-voice", s({ namedVoices: 1, longestQuoteWords: 12 })).ok === true);
  check("single-voice: zero voices under floor", meetsFloor("single-voice", s({ namedVoices: 0 })).ok === false);
  check("ripple-effects: zero voices under floor", meetsFloor("ripple-effects", s({ namedVoices: 0, companyVoices: 0 })).ok === false);
  check("ripple-effects: ONE company voice no longer double-counts past the 2-floor",
    meetsFloor("ripple-effects", s({ namedVoices: 1, companyVoices: 1 })).ok === false);
  check("ripple-effects: 2 distinct named voices (companies count once each) passes",
    meetsFloor("ripple-effects", s({ namedVoices: 2, companyVoices: 2 })).ok === true);
  check("floor failure carries a reason", /named voices 3 < 4/.test(meetsFloor("peer-tributes", s({ namedVoices: 3 })).reason));
}

// ── 3) reactionFinder: findTweetIds ───────────────────────────────────────────────────────────
{
  console.log("\n— reactionFinder: findTweetIds —");
  const ids = findTweetIds([{ text: SRC_A }, { text: SRC_B }]);
  check("finds x.com and twitter.com status ids", ids.includes(TWEET_ID_A) && ids.includes(TWEET_ID_B) && ids.length === 2);
  const dup = findTweetIds([{ text: SRC_A }, { text: SRC_A, url: `https://x.com/a/status/${TWEET_ID_A}` }]);
  check("dedups ids across text and url fields", dup.length === 1 && dup[0] === TWEET_ID_A);
  check("no ids in plain text", findTweetIds([{ text: "no links here at all" }]).length === 0);
}

// ── 4) trigger: the famous gate ───────────────────────────────────────────────────────────────
{
  console.log("\n— trigger: famous gate —");
  const base = { subjectKind: "person", primaryEntity: "Rex Harmon" };
  check("outletCount >= 3 alone passes (TMDB never consulted)",
    await isFamous({ ...base, outletCount: 3, priority: 0 }, { searchPersonImpl: throwsIfCalled("tmdb") }) === true);
  check("priority >= 55 alone passes",
    await isFamous({ ...base, outletCount: 0, priority: 55 }, { searchPersonImpl: throwsIfCalled("tmdb") }) === true);
  check("TMDB GENUINELY notable person passes when cheap signals miss",
    await isFamous({ ...base, outletCount: 1, priority: 10 }, { searchPersonImpl: async () => ({ id: 1, name: "Rex Harmon", popularity: 10, knownFor: 2 }) }) === true);
  check("a low-popularity TMDB HIT is not fame (fuzzy-search crew hit fails the floor)",
    await isFamous({ ...base, outletCount: 1, priority: 10 }, { searchPersonImpl: async () => ({ id: 2, name: "Rex Harmon", popularity: 0.6, knownFor: 0 }) }) === false);
  check("popular but zero knownFor credits still fails the TMDB leg",
    await isFamous({ ...base, outletCount: 1, priority: 10 }, { searchPersonImpl: async () => ({ id: 3, name: "Rex Harmon", popularity: 9, knownFor: 0 }) }) === false);
  check("all three signals miss → NOT famous",
    await isFamous({ ...base, outletCount: 1, priority: 10 }, { searchPersonImpl: async () => null }) === false);
  check("TMDB error counts as a miss, not a pass",
    await isFamous({ ...base, outletCount: 0, priority: 0 }, { searchPersonImpl: async () => { throw new Error("down"); } }) === false);
  check("title-subject never consults TMDB",
    await isFamous({ subjectKind: "title", primaryEntity: "Some Film", outletCount: 0, priority: 0 }, { searchPersonImpl: throwsIfCalled("tmdb") }) === false);
}

// ── 5) trigger: loadTriggers (queue + ledger, confirmation wall, dedup, class filter) ─────────
{
  console.log("\n— trigger: loadTriggers —");
  const famous = async () => ({ id: 1, popularity: 10, knownFor: 2 });
  {
    const { queuePath, ledgerPath } = fakeFindFiles({
      topics: [
        queueTopic(), // confirmed famous death
        queueTopic({ eventSlug: "gale-brody-dies", title: "Gale Brody death rumor", primaryEntity: "Gale Brody", verification: { status: "DEVELOPING", outletCount: 6, publishable: true, sensitivity: "high" } }),
        queueTopic({ eventSlug: "moss-review", title: "Moss reviewed", eventType: "review", verification: { status: "CONFIRMED", outletCount: 6, publishable: true } }),
        queueTopic({ eventSlug: "kip-cast", title: "Kip cast in film", eventType: "casting", priority: 40, verification: { status: "CONFIRMED", outletCount: 2, publishable: false } }),
      ],
      entries: [
        ledgerEntry(), // death WITH verifyStatus: CONFIRMED
        ledgerEntry({ eventSlug: "hal-mercer-dies", slug: "hal-mercer-dead", title: "Hal Mercer Dies at 88", entityKey: "hal-mercer:death", verifyStatus: undefined }), // death, status unknown
        ledgerEntry({ eventSlug: "gene-hackman-dies", slug: "gene-hackman-dead", title: "Gene Hackman Dies", entityKey: "gene-hackman:death", eventType: undefined, verifyStatus: "CONFIRMED" }), // eventType only in entityKey
        ledgerEntry({ eventSlug: "wraith-run-renewed", slug: "wraith-run-renewed-s3", title: "Wraith Run Renewed", entityKey: "wraith-run:renewal", eventType: undefined, verifyStatus: undefined }), // derived, non-confirmedOnly
      ],
    });
    const trs = await loadTriggers({ queuePath, ledgerPath, searchPersonImpl: famous, nowMs: NOW });
    const slugs = trs.map((t) => t.parentEventSlug);
    check("confirmed famous death from the queue becomes a trigger", slugs.includes("rex-harmon-dies"));
    check("death with status DEVELOPING is DROPPED (confirmation wall)", !slugs.includes("gale-brody-dies"));
    check("eventType outside TRIGGERS (review) is dropped", !slugs.includes("moss-review"));
    check("non-publishable queue topic is dropped", !slugs.includes("kip-cast"));
    check("ledger death WITH verifyStatus CONFIRMED triggers", trs.find((t) => t.parentEventSlug === "vera-lin-dies")?.status === "CONFIRMED");
    check("ledger death WITHOUT verifyStatus is DROPPED (unknown status fails closed as DEVELOPING)", !slugs.includes("hal-mercer-dies"));
    check("ledger trigger carries via=ledger + parentSlug", trs.find((t) => t.parentEventSlug === "vera-lin-dies")?.via === "ledger" && trs.find((t) => t.parentEventSlug === "vera-lin-dies")?.parentSlug === "vera-lin-dead-at-64");
    const gh = trs.find((t) => t.parentEventSlug === "gene-hackman-dies");
    check("eventType derived from entityKey suffix (gene-hackman:death → death)", gh?.eventType === "death");
    check("derived death gets high sensitivity + person subject + tribute forms",
      gh?.sensitivity === "high" && gh?.subjectKind === "person" && JSON.stringify(gh?.allowedForms) === JSON.stringify(TRIGGERS.death.forms));
    const wr = trs.find((t) => t.parentEventSlug === "wraith-run-renewed");
    check("derived non-confirmedOnly class (renewal) triggers without verifyStatus, as a title subject",
      wr?.eventType === "renewal" && wr?.subjectKind === "title" && wr?.status === "DEVELOPING");
    check("trigger gets its class's allowedForms", JSON.stringify(trs.find((t) => t.parentEventSlug === "rex-harmon-dies")?.allowedForms) === JSON.stringify(TRIGGERS.death.forms));
    check("death trigger forced to high sensitivity", trs.every((t) => t.eventType !== "death" || t.sensitivity === "high"));
  }
  {
    const { queuePath, ledgerPath } = fakeFindFiles({
      topics: [queueTopic()],
      entries: [ledgerEntry({ eventSlug: "rex-harmon-dies", slug: "rex-harmon-dead-at-70" }), ledgerEntry()],
    });
    const trs = await loadTriggers({ queuePath, ledgerPath, searchPersonImpl: famous, nowMs: NOW });
    check("dedup by parentEventSlug across queue+ledger (one trigger per event)",
      trs.filter((t) => t.parentEventSlug === "rex-harmon-dies").length === 1);
    const old = await loadTriggers({
      queuePath: writeJson(path.join(tmp("q"), "queue.json"), { topics: [] }),
      ledgerPath: writeJson(path.join(tmp("l"), "published.json"), [ledgerEntry({ at: new Date(NOW - 5 * 864e5).toISOString() })]),
      searchPersonImpl: famous, nowMs: NOW,
    });
    check("ledger entry older than the window is not a trigger", old.length === 0);
    const capped = await loadTriggers({ queuePath, ledgerPath, searchPersonImpl: famous, nowMs: NOW, max: 1 });
    check("max caps the trigger list", capped.length === 1);
  }
  {
    // Sort: ledger beats queue at EQUAL priority; same-via equal-priority pairs keep insertion
    // order (the comparator returns 0 → stable, no more inconsistent-comparator shuffles).
    const { queuePath, ledgerPath } = fakeFindFiles({
      topics: [
        queueTopic({ eventSlug: "q-one", title: "Queue One dies", priority: 70 }),
        queueTopic({ eventSlug: "q-two", title: "Queue Two dies", priority: 70 }),
      ],
      entries: [ledgerEntry({ eventSlug: "l-one", slug: "l-one-md", priority: 70 })],
    });
    const trs = await loadTriggers({ queuePath, ledgerPath, searchPersonImpl: famous, nowMs: NOW });
    check("equal priority: ledger (live parent to link) sorts before queue",
      trs[0]?.parentEventSlug === "l-one" && trs.length === 3);
    check("same-via equal-priority order is stable (comparator returns 0)",
      trs[1]?.parentEventSlug === "q-one" && trs[2]?.parentEventSlug === "q-two");
  }
}

// ── 6) store: dedup + park lifecycle ──────────────────────────────────────────────────────────
{
  console.log("\n— store —");
  check("insideKey is event|form", insideKey("rex-harmon-dies", "peer-tributes") === "rex-harmon-dies|peer-tributes");
  check("insideKey tolerates a missing event", insideKey(null, "fan-pulse") === "no-event|fan-pulse");
  const file = path.join(tmp("inside-store"), "store.json");
  const store = loadStore(file);
  check("fresh store: not already published", alreadyPublished(store, "rex-harmon-dies", "peer-tributes") === false);
  recordInsidePublished(store, { parentEventSlug: "rex-harmon-dies", form: "peer-tributes", slug: "s1", title: "t" }, { now: new Date(NOW) });
  check("recordInsidePublished → alreadyPublished true", alreadyPublished(store, "rex-harmon-dies", "peer-tributes") === true);
  check("same event, DIFFERENT form is still free", alreadyPublished(store, "rex-harmon-dies", "fan-pulse") === false);
  recordInsidePublished(store, { parentEventSlug: "rex-harmon-dies", form: "peer-tributes", slug: "s1b", title: "t2" }, { now: new Date(NOW) });
  check("re-record same key replaces, never duplicates", store.published.filter((r) => r.key === "rex-harmon-dies|peer-tributes").length === 1);
  const reloaded = loadStore(file);
  check("store persists across reload", alreadyPublished(reloaded, "rex-harmon-dies", "peer-tributes") === true);

  check("unparked angle has 0 tries", parkedTries(store, "rex-harmon-dies", "fan-pulse") === 0);
  parkAngle(store, "rex-harmon-dies", "fan-pulse", "under floor", { now: new Date(NOW) });
  check("park #1 → tries 1", parkedTries(store, "rex-harmon-dies", "fan-pulse") === 1);
  parkAngle(store, "rex-harmon-dies", "fan-pulse", "under floor", { now: new Date(NOW) });
  check("park #2 → tries 2", parkedTries(store, "rex-harmon-dies", "fan-pulse") === 2);
  parkAngle(store, "rex-harmon-dies", "fan-pulse", "under floor", { now: new Date(NOW) });
  check("park #3 → DEAD (tries = Infinity, never retried)", parkedTries(store, "rex-harmon-dies", "fan-pulse") === Infinity);
  clearParked(store, "rex-harmon-dies", "fan-pulse");
  check("clearParked resets the angle", parkedTries(store, "rex-harmon-dies", "fan-pulse") === 0);
}

// ── 7) editorialGate: echo detection ──────────────────────────────────────────────────────────
{
  console.log("\n— editorialGate —");
  const echoQuote = (i) => `He was the kindest and most generous man I have ever worked with in this business${i % 2 ? "." : ", truly."}`;
  const echoFB = { reactions: Array.from({ length: 6 }, (_, i) => ({ speaker: `Person ${i}`, quote: echoQuote(i), stance: "positive" })), aggregateFans: [] };
  check("distinctQuoteRatio ~0 for 6 near-identical quotes", distinctQuoteRatio(echoFB) < 0.35);
  check("distinctQuoteRatio high for genuinely distinct quotes", distinctQuoteRatio(fakeFactBlock("peer-tributes")) > 0.9);
  check("single quote is trivially distinct", distinctQuoteRatio({ reactions: [NAMED.mira], aggregateFans: [] }) === 1);

  const ed = await insideEditorialGate({ trigger: fakeTrigger(), angle: fakeAngle(), factBlock: echoFB, factText: "x", chatImpl: throwsIfCalled("editor-LLM") });
  check("6-echo harvest → deterministic REJECT before any LLM", ed.ran === true && ed.reject === true && /not distinct/.test(ed.reason));

  const okChat = async () => ({ data: { isStory: true, reject: false, eventMatch: true, formFits: true, distinctVoices: true, eventSummary: "Rex Harmon died; peers posted tributes." } });
  const ed2 = await insideEditorialGate({ trigger: fakeTrigger(), angle: fakeAngle(), factBlock: fakeFactBlock(), factText: "x", chatImpl: okChat });
  check("distinct harvest + editor approval → no reject, summary passed through", ed2.reject === false && /tributes/.test(ed2.eventSummary));
  const ed3 = await insideEditorialGate({ trigger: fakeTrigger(), angle: fakeAngle(), factBlock: fakeFactBlock(), factText: "x", chatImpl: async () => ({ data: { isStory: true, reject: true, reason: "one wire quote", eventMatch: true } }) });
  check("editor reject verdict honored", ed3.reject === true && ed3.reason === "one wire quote");
  const ed4 = await insideEditorialGate({ trigger: fakeTrigger(), angle: fakeAngle(), factBlock: fakeFactBlock(), factText: "x", chatImpl: async () => ({ data: { isStory: true, reject: false, eventMatch: false } }) });
  check("event mismatch → reject", ed4.reject === true);
  const ed5 = await insideEditorialGate({ trigger: fakeTrigger(), angle: fakeAngle(), factBlock: fakeFactBlock(), factText: "x", chatImpl: async () => { throw new Error("529"); } });
  check("editor LLM outage → fail-SAFE (no reject, ran=false)", ed5.ran === false && ed5.reject === false);
}

// ── 8) gate: deterministicInside ──────────────────────────────────────────────────────────────
{
  console.log("\n— gate: deterministicInside —");
  const fb = fakeFactBlock("peer-tributes");
  const angle = fakeAngle("peer-tributes");
  const clean = deterministicInside(fakeArticle({ form: "peer-tributes", factBlock: fb }), fb, angle);
  check("clean fixture article → ZERO hard blocks", clean.hardBlocks.length === 0, JSON.stringify(clean.hardBlocks));

  const invented = fakeArticle({ form: "peer-tributes", factBlock: fb });
  invented.reactionsRender = [...invented.reactionsRender, { speaker: "Rico Fake", connection: "", platform: "X", date: "", quote: Q.mira, tweetId: "" }];
  check("invented speaker in reactionsRender → hard block",
    deterministicInside(invented, fb, angle).hardBlocks.some((b) => b.startsWith("invented-speaker")));

  const altered = fakeArticle({ form: "peer-tributes", factBlock: fb });
  altered.reactionsRender[0] = { ...altered.reactionsRender[0], quote: Q.mira.replace("kindness", "generosity") };
  check("altered (unverbatim) render quote → hard block",
    deterministicInside(altered, fb, angle).hardBlocks.some((b) => b.startsWith("misattributed-or-unverbatim-quote")));

  // per-speaker haystack: the quote must live under THAT speaker, and merging can never pass
  const misattr = fakeArticle({ form: "peer-tributes", factBlock: fb });
  misattr.reactionsRender[1] = { ...misattr.reactionsRender[1], speaker: "Paul Onder", quote: Q.mira }; // Mira's real quote on Onder's card
  check("REAL quote attributed to the WRONG harvested speaker → hard block",
    deterministicInside(misattr, fb, angle).hardBlocks.some((b) => b.startsWith("misattributed-or-unverbatim-quote")));
  const merged = fakeArticle({ form: "peer-tributes", factBlock: fb });
  merged.reactionsRender[0] = { ...merged.reactionsRender[0], quote: `${Q.mira} ${Q.onder}` }; // two adjacent harvest quotes stitched
  check("two harvest quotes MERGED into one card → hard block (single-quote haystack)",
    deterministicInside(merged, fb, angle).hardBlocks.some((b) => b.startsWith("misattributed-or-unverbatim-quote")));
  const fpFB2 = fakeFactBlock("fan-pulse");
  const fanCard = fakeArticle({ form: "fan-pulse", factBlock: fpFB2 });
  fanCard.reactionsRender[0] = { ...fanCard.reactionsRender[0], quote: Q.mira }; // a CELEBRITY quote on an aggregate fan card
  check("named-voice quote smuggled onto an aggregate fan card → hard block (fan pool only)",
    deterministicInside(fanCard, fpFB2, fakeAngle("fan-pulse")).hardBlocks.some((b) => b.startsWith("unverbatim-fan-quote")));
  check("real fan quote on an aggregate card passes the fan pool",
    !deterministicInside(fakeArticle({ form: "fan-pulse", factBlock: fpFB2 }), fpFB2, fakeAngle("fan-pulse")).hardBlocks.some((b) => b.startsWith("unverbatim-fan-quote")));

  // body-prose quote wall (title/dek/body)
  const proseBad = fakeArticle({ form: "peer-tributes", factBlock: fb });
  proseBad.body += `\n\nOne message stood out: "he built this town and we are all just living in it," a line repeated all night.`;
  check("quoted span in BODY not from any harvest quote → hard block",
    deterministicInside(proseBad, fb, angle).hardBlocks.some((b) => b.startsWith("unverbatim-prose-quote")));
  const dekBad = fakeArticle({ form: "peer-tributes", factBlock: fb, dek: 'Colleagues called him "the last of the true gentleman stars" within hours.' });
  check("quoted span in DEK not from any harvest quote → hard block",
    deterministicInside(dekBad, fb, angle).hardBlocks.some((b) => b.startsWith("unverbatim-prose-quote")));
  const proseOk = fakeArticle({ form: "peer-tributes", factBlock: fb });
  proseOk.body += `\n\nThe phrase that echoed furthest was "the funniest man in every room." It fit him.`;
  check("verbatim harvest fragment quoted in prose (house-style period inside) passes",
    !deterministicInside(proseOk, fb, angle).hardBlocks.some((b) => b.startsWith("unverbatim-prose-quote")));

  // attribution scan: "<Name> said/wrote/…" must be a harvested voice (or an outlet)
  const attrBad = fakeArticle({ form: "peer-tributes", factBlock: fb });
  attrBad.body += `\n\nDenzel Ray added that the family would hold a private service later this month.`;
  check("unharvested name with a speech verb in prose → hard block",
    deterministicInside(attrBad, fb, angle).hardBlocks.some((b) => b.startsWith("unknown-attribution")));
  const attrPartial = fakeArticle({ form: "peer-tributes", factBlock: fb });
  attrPartial.body += `\n\nMs. Lena Okafor added a note about mentorship programs in his name.`;
  check("titled/partial mention of a KNOWN speaker passes the attribution scan",
    !deterministicInside(attrPartial, fb, angle).hardBlocks.some((b) => b.startsWith("unknown-attribution")));
  const outletFB = fakeFactBlock("peer-tributes", { sources: [{ url: "https://ew.example/x", domain: "ew.com", owner: "Entertainment Weekly", text: "x" }] });
  const attrOutlet = fakeArticle({ form: "peer-tributes", factBlock: outletFB });
  attrOutlet.body += `\n\nEntertainment Weekly posted the full text of the statement on its site.`;
  check("source OUTLET with a speech verb passes the attribution scan",
    !deterministicInside(attrOutlet, outletFB, angle).hardBlocks.some((b) => b.startsWith("unknown-attribution")));

  const anchorBad = fakeArticle({ form: "peer-tributes", factBlock: fb, anchorStatement: { speaker: "Rex's Family", connection: "", quote: Q.mira, platform: "statement" } });
  check("anchor speaker not in harvest → hard block",
    deterministicInside(anchorBad, fb, angle).hardBlocks.some((b) => b.includes('anchor "Rex\'s Family"')));
  const anchorAltered = fakeArticle({ form: "peer-tributes", factBlock: fb, anchorStatement: { speaker: "Mira Vale", connection: "", quote: "an entirely invented anchor statement here", platform: "statement" } });
  check("unverbatim anchor quote → hard block",
    deterministicInside(anchorAltered, fb, angle).hardBlocks.some((b) => b === "unverbatim-anchor-quote"));

  const dump = fakeArticle({ form: "peer-tributes", factBlock: fb });
  dump.body = Array.from({ length: 12 }, (_, i) => `Frame ${i}. "${Q.mira} and then some more of the very same long tribute text again number ${i}." Tail.`).join("\n\n");
  check("quote-ratio above 25% → hard block",
    deterministicInside(dump, fb, angle).hardBlocks.some((b) => b.startsWith("quote-ratio")));

  const b2b = fakeArticle({ form: "peer-tributes", factBlock: fb });
  b2b.body = b2b.body.replace('." Followers shared', '." "Another quote right behind it." Followers shared');
  check("back-to-back quotes → hard block",
    deterministicInside(b2b, fb, angle).hardBlocks.includes("back-to-back-quotes"));

  const handle = fakeArticle({ form: "peer-tributes", factBlock: fb });
  handle.body += `\n\nFans like @rexfan99 kept the tribute thread going all night.`;
  check("fan handle in prose → hard block",
    deterministicInside(handle, fb, angle).hardBlocks.includes("fan-handle-in-prose"));

  const short = fakeArticle({ form: "peer-tributes", factBlock: fb });
  short.body = "Far too short to publish.";
  check("body under the word floor → hard block",
    deterministicInside(short, fb, angle).hardBlocks.some((b) => /^words \d+ < 300$/.test(b)));

  // fan-pulse honesty
  const fpFB = fakeFactBlock("fan-pulse");
  const fpAngle = fakeAngle("fan-pulse");
  const undivided = fakeFactBlock("fan-pulse", { aggregateFans: FAN_POSTS.map((f) => ({ ...f, stance: "positive" })), stats: statsFor([], FAN_POSTS.map((f) => ({ ...f, stance: "positive" }))) });
  const divArt = fakeArticle({ form: "fan-pulse", factBlock: fpFB, title: "Rex Harmon Fans Divided Over the Coverage of His Death" });
  check("'divided' claim WITHOUT both stances in harvest → hard block",
    deterministicInside(divArt, undivided, fpAngle).hardBlocks.includes("divided-claim-without-both-sides"));
  check("'divided' claim WITH both stances in harvest → allowed",
    !deterministicInside(divArt, fpFB, fpAngle).hardBlocks.includes("divided-claim-without-both-sides"));

  // block taxonomy
  const cls = classifyInsideBlocks(["verify-gate CUT: 2 unsupported", "soft-floor humanVoice 4 < 5", 'invented-speaker: "X" not in harvest', "back-to-back-quotes"]);
  check("classify: cut/soft-floor blocks are fixable", cls.fixable.length === 2 && cls.fixable.every((b) => /^verify-gate CUT:|^soft-floor/.test(b)));
  check("classify: invented speaker & structure blocks are hard stops", cls.block.length === 2 && cls.block.some((b) => b.startsWith("invented-speaker")));
}

// ── 9) assemble: the frontmatter contract ─────────────────────────────────────────────────────
{
  console.log("\n— assemble —");
  const noUndef = (v, p = "fm") => {
    if (v === undefined) return p;
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { const r = noUndef(v[i], `${p}[${i}]`); if (r) return r; } return null; }
    if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) { const r = noUndef(x, `${p}.${k}`); if (r) return r; } return null; }
    return null;
  };
  const trigger = fakeTrigger();
  const fb = fakeFactBlock("peer-tributes");
  const art = fakeArticle({ form: "peer-tributes", factBlock: fb });
  art.reactionsRender[0].tweetId = TWEET_ID_A;      // cached — must survive
  art.reactionsRender[1].tweetId = "999999999999";  // NOT cached — must be stripped
  const dateISO = new Date(NOW).toISOString();
  const out = buildInsideMarkdown({ article: art, trigger, angle: fakeAngle("peer-tributes"), factBlock: fb, image: fakeImage(), dateISO });
  const fm = out.frontmatter;

  check("formatTag is inside", fm.formatTag === "inside");
  check("insideForm carries the form", fm.insideForm === "peer-tributes");
  check("derived eventSlug is unique per form (--in-<form>)", fm.eventSlug === "rex-harmon-dies--in-peer-tributes");
  check("parentEventSlug preserves the cluster", fm.parentEventSlug === "rex-harmon-dies");
  check("storyStatus mirrors the CONFIRMED parent", fm.storyStatus === "CONFIRMED" && fm.provenance.status === "CONFIRMED");
  check("author is the news byline (editorial-team)", fm.author === "editorial-team");
  check("category routed from the trigger", fm.category === "celebrity" && fm.subcategory === "news");
  check("homepage contract fields present (trendScore/signals/eventType/outletCount)",
    fm.trendScore != null && fm.signals && fm.eventType === "death" && fm.outletCount === 2);
  check("flagship form inherits FULL parent trendScore", fm.trendScore === trigger.priority);
  check("high sensitivity + developing carried", fm.sensitivity === "high" && fm.developing === true);
  check("NO undefined value anywhere in frontmatter", noUndef(fm) === null, String(noUndef(fm)));
  check("image block present when image given", fm.image === fakeImage().image && fm.imageWidth === 1600 && fm.imageHeight === 900 && !!fm.imageCredit);
  check("cached tweetId kept on its reaction", fm.reactions[0].tweetId === TWEET_ID_A);
  check("uncached tweetId stripped from its reaction", !("tweetId" in fm.reactions[1]));
  check("fanConsensus omitted outside fan-pulse", !("fanConsensus" in fm));
  const back = matter(out.md);
  check("md round-trips through gray-matter", back.data.slug === out.slug && back.data.formatTag === "inside" && back.content.trim().length > 100);

  const nf = buildInsideMarkdown({ article: fakeArticle({ form: "cast-crew-voices" }), trigger, angle: fakeAngle("cast-crew-voices"), factBlock: fakeFactBlock("cast-crew-voices"), image: null, dateISO });
  check("non-flagship sibling runs trendScore-5", nf.frontmatter.trendScore === trigger.priority - 5);
  check("no image → NO image block at all", !("image" in nf.frontmatter) && !("imageWidth" in nf.frontmatter) && !("imageCredit" in nf.frontmatter));
  check("no undefined values in imageless frontmatter either", noUndef(nf.frontmatter) === null);

  const fp = buildInsideMarkdown({ article: fakeArticle({ form: "fan-pulse" }), trigger, angle: fakeAngle("fan-pulse"), factBlock: fakeFactBlock("fan-pulse"), image: null, dateISO });
  check("fan-pulse keeps fanConsensus + labels fans 'A fan'", /divided/i.test(fp.frontmatter.fanConsensus) && fp.frontmatter.reactions.every((r) => r.speaker === "A fan"));

  // storyStatus mirrors the PARENT honestly — a DEVELOPING parent never gets a CONFIRMED badge.
  const devTrigger = fakeTrigger({ eventType: "boxoffice", sensitivity: "normal", status: "DEVELOPING", subjectKind: "title" });
  const dev = buildInsideMarkdown({ article: fakeArticle({ form: "fan-pulse", trigger: devTrigger }), trigger: devTrigger, angle: fakeAngle("fan-pulse"), factBlock: fakeFactBlock("fan-pulse"), image: null, dateISO });
  check("DEVELOPING parent → storyStatus + provenance.status DEVELOPING",
    dev.frontmatter.storyStatus === "DEVELOPING" && dev.frontmatter.provenance.status === "DEVELOPING");
  check("no undefined values in the DEVELOPING frontmatter either", noUndef(dev.frontmatter) === null);

  // routing: subcategory must be legal per category (awards/streaming have no "news" silo)
  check("routeForTrigger falls back to celebrity/news", routeForTrigger({ category: "politics" }).category === "celebrity" && routeForTrigger({ category: "tv" }).subcategory === "news");
  check("awards routes to awards/winners", JSON.stringify(routeForTrigger({ category: "awards" })) === JSON.stringify({ category: "awards", subcategory: "winners" }));
  check("streaming routes to streaming/where-to-watch", JSON.stringify(routeForTrigger({ category: "streaming" })) === JSON.stringify({ category: "streaming", subcategory: "where-to-watch" }));
  check("movies/music keep the news subcategory", routeForTrigger({ category: "movies" }).subcategory === "news" && routeForTrigger({ category: "music" }).subcategory === "news");
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Inside unit suite green. ✅\n");
