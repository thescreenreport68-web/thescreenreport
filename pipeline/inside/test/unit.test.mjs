// INSIDE lane — UNIT TESTS (multi-agent layer; offline: zero network, zero keys; every impl injected).
// Run: env -i node site/pipeline/inside/test/unit.test.mjs
import assert from "node:assert/strict";

import { AGENTS, FLAGSHIP_WRITER, flagshipOn, agentChat, METER, meterReport, meterReset } from "../models.mjs";
import { findStories } from "../agents/finder.mjs";
import { run as embedRun, scanPagesForInstagram } from "../agents/embed.mjs";
import { run as synthRun } from "../agents/synthesizer.mjs";
import { run as writerRun, repairBodyQuotes } from "../agents/writer.mjs";
import { factLocks, review as qaReview, webCheck as qaWebCheck, classifyBlocks } from "../agents/qa.mjs";
import { buildInsideMarkdown } from "../assemble.mjs";
import { discoverReddit, redditSearchPosts, redditTopComments } from "../../find/sources/reddit.mjs";
import { gnewsArticleId, decodeGnewsBase64, decodeGnewsUrl } from "../../lib/gnewsDecode.mjs";
import { discoverStories } from "../discover.mjs";
import { norm, quoteIsVerbatim, meetsFloor, fallbackQueries } from "../reactionFinder.mjs";
import { routeForStory, MAX_EMBEDS } from "../config.inside.mjs";
import { loadStore, alreadyPublished, recordInsidePublished, parkAngle, parkedTries, clearParked, insideKey } from "../store.mjs";
import {
  NOW, tmp, Q, SRC_A, NAMED, statsFor,
  fakeTrigger, fakeAngle, fakeFactBlock, fakeArticle, fakeImage, fakeJob,
  fakeTMDBItems, fakeRedditDiscover, redditListing, redditCommentsListing, fakeRedditPost,
  IG_HTML, IG_CODE_A, IG_CODE_B, TWEET_ID_A, TWEET_ID_B,
} from "./fixtures.mjs";

let pass = 0, fail = 0; const fails = [];
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; fails.push(name); console.log(`  ❌ ${name}  ${String(e?.message || e).slice(0, 200)}`); }
};

console.log("\n=== INSIDE UNIT TESTS (multi-agent, offline) ===\n");

// ── models.mjs: agentChat + meter ─────────────────────────────────────────────────────────────────
console.log("— models.mjs (agentChat / meter) —");
const okChat = (usage = { prompt_tokens: 1000, completion_tokens: 500 }) => async (args) => ({ data: { ok: true, got: args }, usage });

await check("agentChat succeeds on primary and meters the call", async () => {
  meterReset();
  const seen = [];
  const res = await agentChat("gatherer", { system: "s", user: "u" }, { chatImpl: async (a) => { seen.push(a); return { data: { x: 1 }, usage: { prompt_tokens: 1000, completion_tokens: 500 } }; } });
  assert.deepEqual(res.data, { x: 1 });
  assert.equal(seen[0].model, AGENTS.gatherer.model);
  assert.equal(seen[0].temperature, AGENTS.gatherer.temperature);
  assert.equal(seen[0].maxTokens, AGENTS.gatherer.maxTokens);
  assert.equal(METER.length, 1);
  assert.equal(METER[0].role, "gatherer");
  assert.equal(METER[0].in, 1000);
  assert.equal(METER[0].out, 500);
});
await check("agentChat falls back to cfg.fallback on primary error (meter records both)", async () => {
  meterReset();
  const tried = [];
  const res = await agentChat("finder", { system: "s", user: "u" }, {
    chatImpl: async (a) => {
      tried.push(a.model);
      if (a.model === AGENTS.finder.model) throw new Error("primary down");
      return { data: { via: a.model }, usage: { prompt_tokens: 10, completion_tokens: 5 } };
    },
  });
  assert.deepEqual(tried, [AGENTS.finder.model, AGENTS.finder.fallback]);
  assert.equal(res.data.via, AGENTS.finder.fallback);
  assert.equal(METER.length, 2);
  assert.ok(METER[0].error, "error metered");
  assert.ok(!METER[1].error, "success metered");
});
await check("agentChat throws when ALL models fail", async () => {
  meterReset();
  await assert.rejects(
    agentChat("finder", { system: "s", user: "u" }, { chatImpl: async () => { throw new Error("all down"); } }),
    /all down/,
  );
  assert.equal(METER.filter((m) => m.error).length, 2, "both attempts metered as errors");
});
await check("agentChat throws on unknown role", async () => {
  await assert.rejects(agentChat("nope", { system: "s", user: "u" }, { chatImpl: okChat() }), /unknown agent role/);
});
await check("writer surgical:true uses surgicalTemperature (0.2), fresh uses 0.7", async () => {
  let temps = [];
  const chatImpl = async (a) => { temps.push(a.temperature); return { data: {}, usage: {} }; };
  await agentChat("writer", { system: "s", user: "u", surgical: true }, { chatImpl });
  await agentChat("writer", { system: "s", user: "u" }, { chatImpl });
  assert.deepEqual(temps, [AGENTS.writer.surgicalTemperature, AGENTS.writer.temperature]);
});
await check("flagshipOn env toggle routes writer to FLAGSHIP_WRITER", async () => {
  assert.equal(flagshipOn(), false, "off under env -i");
  process.env.INSIDE_FLAGSHIP = "1";
  try {
    assert.equal(flagshipOn(), true);
    let model = null;
    await agentChat("writer", { system: "s", user: "u" }, { chatImpl: async (a) => { model = a.model; return { data: {}, usage: {} }; } });
    assert.equal(model, FLAGSHIP_WRITER);
  } finally { delete process.env.INSIDE_FLAGSHIP; }
});
await check("maxTokens override passes through; meterReport computes USD from PRICE", async () => {
  meterReset();
  let mt = null;
  await agentChat("gatherer", { system: "s", user: "u", maxTokens: 123 }, { chatImpl: async (a) => { mt = a.maxTokens; return { data: {}, usage: { prompt_tokens: 1e6, completion_tokens: 1e6 } }; } });
  assert.equal(mt, 123);
  const rep = meterReport();
  // gemini-2.5-flash-lite = $0.10 in + $0.40 out per Mtok → 1M+1M = $0.50
  assert.equal(rep.totalUsd, 0.5);
  assert.equal(rep.byRole.gatherer.calls, 1);
  meterReset();
  assert.equal(meterReport().totalUsd, 0);
});

// ── agents/finder.mjs ─────────────────────────────────────────────────────────────────────────────
console.log("— agents/finder —");
const finderStories = () => [
  { storySlug: "the-sable-coast-2026", kind: "work", primaryEntity: "The Sable Coast", work: { title: "The Sable Coast", type: "movie", year: "2026" }, category: "movies", redditPosts: [fakeRedditPost()], sources: [{ url: "https://a.example/1", outlet: null }], discourseHeat: 1740, signals: { comments: 1940 }, via: "tmdb+reddit", overview: "ov" },
  { storySlug: "nora-idris-buzz", kind: "person", primaryEntity: "Nora Idris", work: null, category: "celebrity", redditPosts: [], sources: [], discourseHeat: 250, signals: {}, via: "tmdb" },
];

await check("findStories maps story→trigger shape + angle from the classify picks", async () => {
  const chatImpl = async () => ({ data: { picks: [{ i: 0, form: "audience-reaction", workingTitle: "WT", focusEntity: "The Sable Coast", angle: "the ending fight", searchQueries: ["sable coast reactions", "sable ending", "extra", "too-many"] }] }, usage: {} });
  const out = await findStories({ discoverImpl: async () => finderStories(), chatImpl, nowMs: NOW });
  assert.equal(out.length, 1);
  const { story, angle } = out[0];
  assert.equal(story.parentEventSlug, "the-sable-coast-2026");
  assert.equal(story.eventType, "discourse");
  assert.equal(story.status, "CONFIRMED");
  assert.equal(story.subjectKind, "title");
  assert.equal(story.priority, 1740);
  assert.equal(story.outletCount, 1);
  assert.deepEqual(story.work, { title: "The Sable Coast", type: "movie", year: "2026" });
  assert.equal(angle.form, "audience-reaction");
  assert.equal(angle.workingTitle, "WT");
  assert.equal(angle.searchQueries.length, 3, "searchQueries capped at 3");
});
await check("form clamp: disallowed/unknown form or bad index dropped (never trust the enum)", async () => {
  const chatImpl = async () => ({ data: { picks: [
    { i: 1, form: "audience-reaction", workingTitle: "bad", focusEntity: "Nora Idris", angle: "x" },  // not allowed for person
    { i: 1, form: "breakout-buzz", workingTitle: "good", focusEntity: "Nora Idris", angle: "x" },     // allowed
    { i: 0, form: "review", workingTitle: "unknown form", angle: "x" },                               // unknown form
    { i: 99, form: "the-debate", workingTitle: "bad index", angle: "x" },                             // bad index
  ] }, usage: {} });
  const out = await findStories({ discoverImpl: async () => finderStories(), chatImpl, nowMs: NOW });
  assert.equal(out.length, 1, "only the legal pick survives");
  assert.equal(out[0].angle.form, "breakout-buzz");
});
await check("finder LLM total failure → deterministic fallback (flagship form per kind)", async () => {
  const out = await findStories({ discoverImpl: async () => finderStories(), chatImpl: async () => { throw new Error("llm down"); }, nowMs: NOW });
  assert.equal(out.length, 2);
  assert.equal(out[0].angle.form, "audience-reaction", "work → first allowed form");
  assert.equal(out[1].angle.form, "breakout-buzz", "person → first allowed form");
  assert.ok(/what people are saying/.test(out[0].angle.workingTitle));
});
await check("findStories respects limit; empty discovery → []", async () => {
  const chatImpl = async () => ({ data: { picks: [
    { i: 0, form: "audience-reaction", workingTitle: "a", angle: "x" },
    { i: 1, form: "breakout-buzz", workingTitle: "b", angle: "x" },
  ] }, usage: {} });
  const out = await findStories({ limit: 1, discoverImpl: async () => finderStories(), chatImpl, nowMs: NOW });
  assert.equal(out.length, 1);
  assert.deepEqual(await findStories({ discoverImpl: async () => [], chatImpl, nowMs: NOW }), []);
});

// ── agents/embed.mjs ──────────────────────────────────────────────────────────────────────────────
console.log("— agents/embed —");
await check("scanPagesForInstagram: IG URL regex (p/reel), shortcode dedup, caption context, tag-strip", async () => {
  const fetchImpl = async () => ({ text: async () => IG_HTML });
  const out = await scanPagesForInstagram([{ url: "https://variety.example/coverage" }], { fetchImpl });
  assert.equal(out.length, 2, "two unique shortcodes (duplicate deduped)");
  assert.equal(out[0].url, `https://www.instagram.com/p/${IG_CODE_A}/`);
  assert.equal(out[1].url, `https://www.instagram.com/p/${IG_CODE_B}/`, "reel normalized to /p/ url");
  assert.ok(/Nora Idris/.test(out[0].context), "caption context captured");
  assert.ok(!/<[^>]+>/.test(out[0].context), "no complete HTML tag survives in context");
});
await check("scanPagesForInstagram skips instagram.com source pages and survives fetch errors", async () => {
  let fetched = [];
  const fetchImpl = async (u) => { fetched.push(u); throw new Error("dead page"); };
  const out = await scanPagesForInstagram([
    { url: "https://www.instagram.com/p/SKIPME123/" },
    { url: "https://ew.example/a" },
  ], { fetchImpl });
  assert.deepEqual(out, []);
  assert.deepEqual(fetched, ["https://ew.example/a"], "IG source page never fetched");
});
await check("embed.run: X ids first, IG capped to remaining room after X", async () => {
  const job = fakeJob("audience-reaction");
  job.factBlock.tweetIds = ["1", "2", "3", "4", "5", "6", "7"]; // 7 → sliced to MAX_EMBEDS(6)
  const candidates = Array.from({ length: 4 }, (_, i) => ({ url: `https://www.instagram.com/p/CODE${i}0000/`, context: "The Sable Coast reaction" }));
  const chatImpl = async () => ({ data: { keep: [0, 1, 2, 3] }, usage: {} });
  await embedRun(job, { scanImpl: async () => candidates, chatImpl });
  assert.equal(job.embeds.tweetIds.length, MAX_EMBEDS, "X capped at MAX_EMBEDS");
  assert.equal(job.embeds.instagramUrls.length, 0, "no IG room left after X");
  const job2 = fakeJob("audience-reaction");
  job2.factBlock.tweetIds = ["1", "2", "3", "4"];
  await embedRun(job2, { scanImpl: async () => candidates, chatImpl });
  assert.equal(job2.embeds.instagramUrls.length, 2, "IG fills the remaining room only");
});
await check("embed.run maps keep indexes to urls; out-of-range/garbage keep dropped", async () => {
  const job = fakeJob("audience-reaction");
  job.factBlock.tweetIds = [];
  const candidates = [{ url: "https://www.instagram.com/p/KEEPME0001/", context: "ctx" }, { url: "https://www.instagram.com/p/DROPME0002/", context: "ad" }];
  await embedRun(job, { scanImpl: async () => candidates, chatImpl: async () => ({ data: { keep: [0, 7] }, usage: {} }) });
  assert.deepEqual(job.embeds.instagramUrls, ["https://www.instagram.com/p/KEEPME0001/"]);
  const job2 = fakeJob("audience-reaction");
  job2.factBlock.tweetIds = [];
  await embedRun(job2, { scanImpl: async () => candidates, chatImpl: async () => ({ data: { keep: "garbage" }, usage: {} }) });
  assert.deepEqual(job2.embeds.instagramUrls, []);
});
await check("embed.run NEVER throws (scan throws, classify throws) → embeds still set", async () => {
  const job = fakeJob("audience-reaction");
  await embedRun(job, { scanImpl: async () => { throw new Error("scan boom"); }, chatImpl: async () => { throw new Error("classify boom"); } });
  assert.deepEqual(job.embeds, { tweetIds: [TWEET_ID_A], instagramUrls: [] });
  const job2 = fakeJob("audience-reaction");
  await embedRun(job2, { scanImpl: async () => [{ url: "https://www.instagram.com/p/ANY1234567/", context: "c" }], chatImpl: async () => { throw new Error("classify boom"); } });
  assert.deepEqual(job2.embeds.instagramUrls, [], "classify failure → no IG, no throw");
});

// ── agents/synthesizer.mjs ────────────────────────────────────────────────────────────────────────
console.log("— agents/synthesizer —");
await check("synthesizer clamps lengths and counts", async () => {
  const job = fakeJob("audience-reaction", { brief: undefined });
  const big = (n) => "x".repeat(n);
  const chatImpl = async () => ({ data: {
    hook: big(900), mood: big(400),
    sides: Array.from({ length: 7 }, () => ({ stance: big(200), summary: big(900), anchorRefs: Array.from({ length: 12 }, (_, j) => `A${j}`) })),
    standoutRefs: Array.from({ length: 10 }, (_, i) => `A${i}`),
    mustInclude: Array.from({ length: 9 }, (_, i) => `p${i}`),
    suggestedTitle: big(300), seoKeyword: big(200),
  }, usage: {} });
  await synthRun(job, { chatImpl });
  assert.ok(job.brief && !job.synthFail);
  assert.equal(job.brief.hook.length, 400);
  assert.equal(job.brief.mood.length, 200);
  assert.equal(job.brief.sides.length, 4);
  assert.equal(job.brief.sides[0].stance.length, 80);
  assert.equal(job.brief.sides[0].summary.length, 500);
  assert.equal(job.brief.sides[0].anchorRefs.length, 8);
  assert.equal(job.brief.standoutRefs.length, 6);
  assert.equal(job.brief.mustInclude.length, 6);
  assert.equal(job.brief.suggestedTitle.length, 140);
  assert.equal(job.brief.seoKeyword.length, 80);
});
await check("synthesizer synthFail on empty/side-less output", async () => {
  const j1 = fakeJob("audience-reaction", { brief: undefined });
  await synthRun(j1, { chatImpl: async () => ({ data: {}, usage: {} }) });
  assert.ok(j1.synthFail && !j1.brief);
  const j2 = fakeJob("audience-reaction", { brief: undefined });
  await synthRun(j2, { chatImpl: async () => ({ data: { hook: "h", sides: [] }, usage: {} }) });
  assert.ok(j2.synthFail && !j2.brief);
});
await check("synthesizer defaults: suggestedTitle←workingTitle, seoKeyword←primaryEntity", async () => {
  const job = fakeJob("audience-reaction", { brief: undefined });
  await synthRun(job, { chatImpl: async () => ({ data: { hook: "h", mood: "m", sides: [{ stance: "for", summary: "s", anchorRefs: ["A1"] }] }, usage: {} }) });
  assert.equal(job.brief.suggestedTitle, job.angle.workingTitle);
  assert.equal(job.brief.seoKeyword, job.story.primaryEntity);
});

// ── agents/writer.mjs ─────────────────────────────────────────────────────────────────────────────
console.log("— agents/writer —");
await check("writer surgical merge: corrections+previousArticle merges over the previous draft", async () => {
  const job = fakeJob("audience-reaction");
  const prev = fakeArticle({ form: "audience-reaction" });
  let temp = null;
  const chatImpl = async (a) => { temp = a.temperature; return { data: { title: "Fixed Title" }, usage: {} }; };
  await writerRun(job, { corrections: "- fix the title", previousArticle: prev, chatImpl });
  assert.equal(temp, AGENTS.writer.surgicalTemperature, "surgical temp used");
  assert.equal(job.article.title, "Fixed Title", "patched field wins");
  assert.equal(job.article.body, prev.body, "unpatched fields survive from the previous draft");
});
await check("writer retries ONCE on an incomplete draft", async () => {
  const job = fakeJob("audience-reaction");
  const full = fakeArticle({ form: "audience-reaction" });
  let calls = 0;
  const chatImpl = async (a) => {
    calls++;
    if (calls === 1) return { data: { ...full, body: "way too short" }, usage: {} };
    assert.ok(/INCOMPLETE/.test(a.user), "retry prompt flags the incomplete output");
    return { data: full, usage: {} };
  };
  await writerRun(job, { chatImpl });
  assert.equal(calls, 2);
  assert.equal(job.article.body, full.body);
});

await check("writer anchor-id cards substitute the EXACT harvested quote (never model-typed text)", async () => {
  const job = fakeJob("audience-reaction");
  const fb = job.factBlock;
  const full = fakeArticle({ form: "audience-reaction", factBlock: fb });
  const idCards = { ...full, reactionsRender: [
    { anchorId: "A1", tweetId: "999999" },          // writer-guessed tweetId ignored — anchor's own only
    { anchorId: "A2" },                              // audience anchor
    { anchorId: "A99" },                             // unknown id → dropped
    { speaker: "", platform: "X", quote: fb.aggregateFans[2].quote, tweetId: "" }, // legacy card passes through
  ] };
  await writerRun(job, { chatImpl: async () => ({ data: idCards, usage: {} }) });
  const cards = job.article.reactionsRender;
  assert.equal(cards.length, 3, "unknown id dropped");
  assert.equal(cards[0].quote, fb.aggregateFans[0].quote, "A1 quote is the harvested original");
  assert.equal(cards[0].tweetId, fb.aggregateFans[0].tweetId || "", "anchor tweetId only, never the writer's guess");
  assert.equal(cards[1].quote, fb.aggregateFans[1].quote, "A2 → second audience anchor");
  assert.equal(cards[1].speaker, "", "audience cards never carry a name");
  assert.equal(cards[2].quote, fb.aggregateFans[2].quote, "legacy full card untouched");
});

await check("writer anchorStatement by id snaps to the named anchor; bad id → null", async () => {
  const job = fakeJob("creator-answers-critics");
  const fb = job.factBlock;
  const full = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  await writerRun(job, { chatImpl: async () => ({ data: { ...full, anchorStatement: { anchorId: "R1" } }, usage: {} }) });
  assert.equal(job.article.anchorStatement.quote, fb.reactions[0].quote);
  assert.equal(job.article.anchorStatement.speaker, fb.reactions[0].speaker);
  const job2 = fakeJob("creator-answers-critics");
  await writerRun(job2, { chatImpl: async () => ({ data: { ...full, anchorStatement: { anchorId: "R42" } }, usage: {} }) });
  assert.equal(job2.article.anchorStatement, null, "unknown id → no anchorStatement");
});

await check("repairBodyQuotes heals markdown-inside-quote and snaps a unique prefix to the full anchor", () => {
  const fb = {
    reactions: [{ quote: "The battle sequence rewired what television can even attempt this year" }],
    aggregateFans: [{ quote: "honestly the finale broke me in the best possible way" }],
  };
  const a = { body: [
    '\u201cThe **battle** sequence rewired what television can even attempt this year\u201d said a critic.',
    'One fan wrote \u201chonestly the finale broke me in the bes\u201d and it was cut mid-word.',
    'Another said \u201chonestly the finale broke me in the\u201d which ends at a word boundary.',
    'And \u201csomething nobody ever posted anywhere at all here\u201d stays untouched.',
  ].join("\n\n") };
  const n = repairBodyQuotes(a, fb);
  assert.equal(n, 2, "two repairs");
  assert.ok(a.body.includes("\u201cThe battle sequence rewired what television can even attempt this year\u201d"), "markdown stripped");
  assert.ok(a.body.includes("\u201chonestly the finale broke me in the best possible way\u201d"), "mid-word scar snapped to the full anchor");
  assert.ok(a.body.includes("\u201chonestly the finale broke me in the\u201d"), "word-boundary shortening is a legit quote — untouched");
  assert.ok(a.body.includes("\u201csomething nobody ever posted anywhere at all here\u201d"), "unanchored span left for the wall");
});

// ── agents/qa.mjs: factLocks (the deterministic walls) ────────────────────────────────────────────
console.log("— qa.factLocks —");
const locks = (article, form, fb) => factLocks(article, fb, fakeAngle(form));

await check("clean fixture article has NO hard blocks", () => {
  const fb = fakeFactBlock("audience-reaction");
  const r = locks(fakeArticle({ form: "audience-reaction", factBlock: fb }), "audience-reaction", fb);
  assert.deepEqual(r.hardBlocks, [], "clean: " + r.hardBlocks.join(" | "));
});
await check("invented speaker in reactionsRender blocked", () => {
  const fb = fakeFactBlock("creator-answers-critics");
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  art.reactionsRender.push({ speaker: "Ghost Nobody", connection: "", platform: "X", date: "", quote: Q.director, tweetId: "" });
  assert.ok(locks(art, "creator-answers-critics", fb).hardBlocks.some((b) => /invented-speaker/.test(b)));
});
await check("misattributed named quote blocked (per-speaker verbatim)", () => {
  const fb = fakeFactBlock("creator-answers-critics");
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  art.reactionsRender = [{ speaker: "Priya Anand", connection: "director", platform: "interview", date: "", quote: Q.fanHate, tweetId: "" }];
  assert.ok(locks(art, "creator-answers-critics", fb).hardBlocks.some((b) => /misattributed-or-unverbatim/.test(b)));
});

// PROSE ATTRIBUTION BINDING (2026-07-10 wall): a quote directly attached to a name in prose must be
// verbatim from THAT speaker's own anchors — the pooled wall alone can't catch A's words in B's mouth.
const twoSpeakerFB = () => {
  const named = [{ ...NAMED.director }, { ...NAMED.lead }];
  const fans = fakeFactBlock("creator-answers-critics").aggregateFans;
  return fakeFactBlock("creator-answers-critics", { reactions: named, stats: statsFor(named, fans) });
};
await check("prose binding: speaker A's quote attributed to speaker B → misattributed-prose-quote", () => {
  const fb = twoSpeakerFB();
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  art.body += `\n\nNora Idris said, "${Q.director}." The room went quiet.`;
  const blocks = locks(art, "creator-answers-critics", fb).hardBlocks;
  assert.ok(blocks.some((b) => /misattributed-prose-quote.*Nora Idris/.test(b)), blocks.join(" | "));
});
await check("prose binding: '\"…,\" Name said' form also caught when misattributed", () => {
  const fb = twoSpeakerFB();
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  art.body += `\n\n"${Q.lead}," Priya Anand said after the screening.`;
  const blocks = locks(art, "creator-answers-critics", fb).hardBlocks;
  assert.ok(blocks.some((b) => /misattributed-prose-quote.*Priya Anand/.test(b)), blocks.join(" | "));
});
await check("prose binding: correct attribution passes (full name + partial-name containment)", () => {
  const fb = twoSpeakerFB();
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  art.body += `\n\nPriya Anand said, "${Q.director}." Later, Nora added, "${Q.lead}."`;
  const blocks = locks(art, "creator-answers-critics", fb).hardBlocks;
  assert.ok(!blocks.some((b) => /misattributed-prose-quote/.test(b)), blocks.join(" | "));
});
await check("prose binding: outlet attributions exempt ('Variety wrote…' / '\"…,\" said Variety')", () => {
  const fb = twoSpeakerFB();
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  // The quote is real (in the pool) but attributed to the OUTLET — outlets aren't speakers, exempt.
  art.body += `\n\nVariety wrote, "${Q.director}." And again: "${Q.director}," said Variety.`;
  const blocks = locks(art, "creator-answers-critics", fb).hardBlocks;
  assert.ok(!blocks.some((b) => /misattributed-prose-quote/.test(b)), blocks.join(" | "));
});
await check("GENERIC_AUD strip: lane-mandated aggregate labels pass; a leftover name = named speaker", () => {
  const fb = fakeFactBlock("audience-reaction");
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  // The anchor block's own instructed labels must be aggregate (regression fixed 2026-07-10).
  for (const label of ["One fan on Reddit", "fans on Reddit", "one X user", "A viewer", ""]) {
    art.reactionsRender = [{ speaker: label, connection: "", platform: "Reddit", date: "", quote: Q.fanLove, tweetId: "" }];
    assert.deepEqual(locks(art, "audience-reaction", fb).hardBlocks, [], `aggregate label "${label}" must pass vs fan pool`);
  }
  art.reactionsRender = [{ speaker: "Sable Fanatic", connection: "", platform: "Reddit", date: "", quote: Q.fanLove, tweetId: "" }];
  assert.ok(locks(art, "audience-reaction", fb).hardBlocks.some((b) => /invented-speaker/.test(b)), "a real-looking name is NOT aggregate");
});
await check("unverbatim prose quote in body → routed to CUT, not a hold (publish-everything)", () => {
  const fb = fakeFactBlock("audience-reaction");
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.body += `\n\nAnother viewer declared, "this film changed my entire life forever and always."`;
  const r = locks(art, "audience-reaction", fb);
  assert.ok(r.proseCuts.some((c) => /changed my entire life/.test(c)), "span collected for the cutter");
  assert.ok(!r.hardBlocks.some((b) => /unverbatim-prose-quote/.test(b)), "no hard block for a cuttable span");
});
await check("unknown-attribution ('<Name> said') blocked", () => {
  const fb = fakeFactBlock("audience-reaction");
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.body += `\n\nMarcus Webb said the reaction proved his point about the ending.`;
  assert.ok(locks(art, "audience-reaction", fb).hardBlocks.some((b) => /unknown-attribution/.test(b)));
});
await check("audience handle in prose blocked", () => {
  const fb = fakeFactBlock("audience-reaction");
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.body += `\n\nAs @sablefan99 put it, the ending was perfect.`;
  assert.ok(locks(art, "audience-reaction", fb).hardBlocks.some((b) => /audience-handle-in-prose/.test(b)));
});
await check("divided-claim-without-both-sides blocked", () => {
  const fb = fakeFactBlock("audience-reaction");
  fb.aggregateFans = fb.aggregateFans.filter((r) => r.stance !== "negative");
  fb.stats.hasNegative = false; fb.stats.divided = false;
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.title = "The Sable Coast Fans Are Divided";
  assert.ok(locks(art, "audience-reaction", fb).hardBlocks.some((b) => /divided-claim-without-both-sides/.test(b)));
});
await check("quote-ratio > 35% blocked; word floor enforced", () => {
  const fb = fakeFactBlock("audience-reaction");
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.body = `Intro. "${Q.fanLove}" "${Q.fanHate}" "${Q.fanSplit}"`;
  assert.ok(locks(art, "audience-reaction", fb).hardBlocks.some((b) => /quote-ratio/.test(b)));
  const art2 = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art2.body = "Too short.";
  assert.ok(locks(art2, "audience-reaction", fb).hardBlocks.some((b) => /words \d+ </.test(b)));
});
await check("classifyBlocks splits soft-floor (fixable) from hard", () => {
  const { block, fixable } = classifyBlocks(["soft-floor engagement 4 < 5", "invented-speaker: x"]);
  assert.deepEqual(fixable, ["soft-floor engagement 4 < 5"]);
  assert.deepEqual(block, ["invented-speaker: x"]);
});

// ── qa.review (judge + guards over the extended surface) ─────────────────────────────────────────
console.log("— qa.review —");
const judgeChat = (score = 88, subs = { readability: 8, engagement: 8, humanVoice: 8 }) =>
  async () => ({ data: { score, subscores: subs, strengths: [], weaknesses: [] }, usage: {} });

await check("clean article: pass at judge score >= publishMin, no blocks/cuts", async () => {
  const job = fakeJob("audience-reaction", { article: fakeArticle({ form: "audience-reaction" }) });
  await qaReview(job, { chatImpl: judgeChat(88) });
  assert.equal(job.qa.pass, true, JSON.stringify(job.qa.hardBlocks));
  assert.deepEqual(job.qa.cutClaims, []);
});
await check("judge soft-floors: subscore < 5 → soft-floor block (fixable)", async () => {
  const job = fakeJob("audience-reaction", { article: fakeArticle({ form: "audience-reaction" }) });
  await qaReview(job, { chatImpl: judgeChat(75, { readability: 8, engagement: 4, humanVoice: 8 }) });
  assert.equal(job.qa.pass, false);
  assert.ok(job.qa.hardBlocks.some((b) => /soft-floor engagement 4 < 5/.test(b)));
  assert.deepEqual(classifyBlocks(job.qa.hardBlocks).block, [], "soft-floor is fixable, not hard");
});
await check("fabricated quote in the FAQ (extended surface) → CUT claim, pass stays false until cut", async () => {
  const art = fakeArticle({ form: "audience-reaction" });
  art.faq = [...art.faq, { q: "What did fans say?", a: 'One post read, "a totally invented viral sentence nobody ever posted anywhere online."' }];
  const job = fakeJob("audience-reaction", { article: art });
  await qaReview(job, { chatImpl: judgeChat(88) });
  assert.ok(job.qa.cutClaims.some((c) => /totally invented viral sentence/.test(c)), JSON.stringify(job.qa.cutClaims));
  assert.equal(job.qa.pass, false, "cut must happen before publish");
});

await check("a draft SATURATED with fabricated prose quotes (>4) still holds — cut cap", async () => {
  const art = fakeArticle({ form: "audience-reaction" });
  for (let i = 1; i <= 5; i++) art.body += `\n\nSomeone posted, "completely invented viral reaction number ${i} that exists nowhere online."`;
  const job = fakeJob("audience-reaction", { article: art });
  await qaReview(job, { chatImpl: judgeChat(88) });
  assert.ok(job.qa.hardBlocks.some((b) => /cut cap exceeded/.test(b)), job.qa.hardBlocks.join(" | "));
});
await check("specificsGuard: un-anchored number → cutClaims AND pass=false even at score 90", async () => {
  const art = fakeArticle({ form: "audience-reaction" });
  art.body += `\n\nThe film has already grossed $412 million worldwide, an unusually strong run.`;
  const job = fakeJob("audience-reaction", { article: art });
  await qaReview(job, { chatImpl: judgeChat(90) });
  assert.ok(job.qa.cutClaims.some((c) => /412/.test(c)), JSON.stringify(job.qa.cutClaims));
  assert.equal(job.qa.hardBlocks.length, 0, "no hard blocks — cuts alone must sink the pass");
  assert.equal(job.qa.pass, false, "an unsupported specific can never ride a passing score");
});
await check("qa.webCheck fail-closed: an error is NEVER ok (ran:false, ok:false, error)", async () => {
  const job = fakeJob("audience-reaction", { article: fakeArticle({ form: "audience-reaction" }) });
  const wv = await qaWebCheck(job, { webVerifyImpl: async () => { throw new Error("sonar down"); } });
  assert.equal(wv.ran, false);
  assert.equal(wv.ok, false, "never reported ok on an outage");
  assert.deepEqual(wv.contradictions, []);
  assert.ok(/sonar down/.test(wv.error));
});
await check("fatal fact-lock skips the judge entirely (score stays 0)", async () => {
  const art = fakeArticle({ form: "audience-reaction" });
  art.reactionsRender = [{ speaker: "Ghost Nobody", quote: Q.fanLove }];
  let judgeCalled = 0;
  const job = fakeJob("audience-reaction", { article: art });
  await qaReview(job, { chatImpl: async () => { judgeCalled++; return { data: { score: 99 }, usage: {} }; } });
  assert.equal(judgeCalled, 0, "judge never called on a fatal block");
  assert.equal(job.qa.score, 0);
  assert.equal(job.qa.pass, false);
});
await check("judge outage → score 0 → held, never auto-published", async () => {
  const job = fakeJob("audience-reaction", { article: fakeArticle({ form: "audience-reaction" }) });
  await qaReview(job, { chatImpl: async () => { throw new Error("judge down"); } });
  assert.equal(job.qa.score, 0);
  assert.equal(job.qa.pass, false);
});

// ── assemble contract (embeds-aware) ──────────────────────────────────────────────────────────────
console.log("— assemble —");
const mkFM = (form, { image = fakeImage(), embeds = null, trigger = fakeTrigger() } = {}) =>
  buildInsideMarkdown({ article: fakeArticle({ form, trigger }), trigger, angle: fakeAngle(form), factBlock: fakeFactBlock(form), image, embeds, dateISO: new Date(NOW).toISOString() }).frontmatter;

await check("formatTag inside, insideForm, unique eventSlug --in-<form>", () => {
  const fm = mkFM("audience-reaction");
  assert.equal(fm.formatTag, "inside");
  assert.equal(fm.insideForm, "audience-reaction");
  assert.equal(fm.eventSlug, "the-sable-coast-2026--in-audience-reaction");
  assert.equal(fm.category, "movies");
  assert.equal(fm.subcategory, "news");
  assert.notEqual(mkFM("the-debate").eventSlug, fm.eventSlug, "sibling forms distinct");
});
await check("tweetIds prefer embeds over factBlock; instagramUrls emitted only when non-empty", () => {
  const withEmbeds = mkFM("audience-reaction", { embeds: { tweetIds: [TWEET_ID_B], instagramUrls: [`https://www.instagram.com/p/${IG_CODE_A}/`] } });
  assert.deepEqual(withEmbeds.tweetIds, [TWEET_ID_B], "embeds tweetIds win");
  assert.deepEqual(withEmbeds.instagramUrls, [`https://www.instagram.com/p/${IG_CODE_A}/`]);
  const noEmbeds = mkFM("audience-reaction", { embeds: null });
  assert.deepEqual(noEmbeds.tweetIds, [TWEET_ID_A], "falls back to factBlock tweetIds");
  assert.equal(noEmbeds.instagramUrls, undefined, "no empty instagramUrls key");
  const emptyEmbeds = mkFM("audience-reaction", { embeds: { tweetIds: [], instagramUrls: [] } });
  assert.deepEqual(emptyEmbeds.tweetIds, [TWEET_ID_A], "empty embeds fall back too");
  assert.equal(emptyEmbeds.instagramUrls, undefined);
});
await check("tweet↔quote pairing is DETERMINISTIC from the harvest (writer's wrong id overridden)", () => {
  const trigger = fakeTrigger();
  const fb = fakeFactBlock("creator-answers-critics");
  fb.reactions[0].tweetId = TWEET_ID_B; // the harvest KNOWS this anchor came from post B
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb, trigger });
  // The writer pairs the director's quote with a WRONG id — the harvest's own pairing must win.
  art.reactionsRender = [{ speaker: "Priya Anand", connection: "director", platform: "X", date: "", quote: Q.director, tweetId: "9999999999999999999" }];
  const fm = buildInsideMarkdown({ article: art, trigger, angle: fakeAngle("creator-answers-critics"), factBlock: fb, image: fakeImage(), embeds: null, dateISO: new Date(NOW).toISOString() }).frontmatter;
  assert.equal(fm.reactions[0].tweetId, TWEET_ID_B, "harvest pairing wins over the writer's id");
});
await check("writer's id honored ONLY when cached and the harvest has no pairing for that quote", () => {
  const trigger = fakeTrigger();
  const fb = fakeFactBlock("audience-reaction"); // no anchor carries a tweetId; cached pool = [TWEET_ID_A]
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb, trigger });
  art.reactionsRender = [
    { speaker: "", connection: "", platform: "X", date: "", quote: Q.fanLove, tweetId: TWEET_ID_A },        // cached → kept
    { speaker: "", connection: "", platform: "X", date: "", quote: Q.fanHate, tweetId: "1111111111111111" }, // uncached → dropped
  ];
  const fm = buildInsideMarkdown({ article: art, trigger, angle: fakeAngle("audience-reaction"), factBlock: fb, image: fakeImage(), embeds: null, dateISO: new Date(NOW).toISOString() }).frontmatter;
  assert.equal(fm.reactions[0].tweetId, TWEET_ID_A, "cached writer id kept when harvest has no match");
  assert.ok(!("tweetId" in fm.reactions[1]), "uncached writer id stripped");
});
await check("no undefined/null/empty keys; image only when given; fan speaker default; fanConsensus", () => {
  const fm = mkFM("audience-reaction");
  for (const [k, v] of Object.entries(fm)) assert.ok(v !== undefined && v !== null && v !== "", `key ${k} is empty`);
  assert.ok(fm.image, "image present when given");
  assert.equal(mkFM("audience-reaction", { image: null }).image, undefined, "no image key when null");
  assert.ok(fm.reactions.every((r) => r.speaker && r.speaker.length), "no empty speaker");
  assert.ok(fm.reactions.some((r) => r.speaker === "A viewer"), "fan cards → 'A viewer'");
  assert.ok(fm.fanConsensus.length > 5, "fanConsensus present");
});

// ── ENGINE (still load-bearing): reddit / discover / floors / walls / store / routing ─────────────
console.log("— engine: reddit.mjs —");
const rawPost = (id, nc, ageH, extra = {}) => ({ id, subreddit: "movies", title: ` t-${id}  x `, selftext: "body", permalink: `/r/movies/comments/${id}/`, url: "https://ew.com/a", score: 12, num_comments: nc, created_utc: Math.round((NOW - ageH * 3600000) / 1000), ...extra });
await check("discoverReddit maps fields, dedups, drops stale/thin/stickied, sorts by comments", async () => {
  const fetchImpl = async (u) => /hot\.json/.test(u)
    ? { ok: true, json: async () => redditListing([rawPost("fresh", 100, 1), rawPost("stale", 500, 200), rawPost("thin", 5, 1), rawPost("big", 900, 2), rawPost("sticky", 900, 1, { stickied: true })]) }
    : { ok: true, json: async () => redditListing([rawPost("fresh", 100, 1)]) };
  const out = await discoverReddit({ subs: ["movies", "television"], minComments: 25, freshHours: 72, fetchImpl, nowMs: NOW });
  assert.deepEqual(out.map((p) => p.id), ["big", "fresh"], "dedup + filters + sort");
  const p = out.find((x) => x.id === "fresh");
  assert.equal(p.title, "t-fresh x");
  assert.equal(p.permalink, "https://www.reddit.com/r/movies/comments/fresh/");
  assert.equal(p.numComments, 100);
  assert.equal(p.ageMin, 60);
});
await check("discoverReddit fail-closed on non-200; search + comments filters", async () => {
  assert.deepEqual(await discoverReddit({ subs: ["movies"], fetchImpl: async () => ({ ok: false }), nowMs: NOW }), []);
  const sOut = await redditSearchPosts("q", { sinceDays: 14, fetchImpl: async () => ({ ok: true, json: async () => redditListing([rawPost("a", 40, 1), rawPost("old", 200, 24 * 40)]) }), nowMs: NOW });
  assert.deepEqual(sOut.map((p) => p.id), ["a"]);
  const c = (body, score) => ({ body, score, author: "u" });
  const cOut = await redditTopComments("https://www.reddit.com/r/movies/comments/p/", { fetchImpl: async () => ({ ok: true, json: async () => redditCommentsListing([c("This ending was incredible", 10), c("[deleted]", 99), c("short", 50), c("x".repeat(400), 70)]) }) });
  assert.equal(cOut.length, 1, "deleted/short/too-long filtered");
});
console.log("— engine: discover.mjs —");
await check("discoverStories shapes work+person+orphan, drops low-pop-no-discourse, heat sort", async () => {
  const stories = await discoverStories({ discoverNewsImpl: async () => [], discoverTMDBImpl: async () => fakeTMDBItems(), discoverRedditImpl: async () => fakeRedditDiscover(), nowMs: NOW });
  assert.ok(stories.find((s) => s.kind === "work" && s.primaryEntity === "The Sable Coast"));
  assert.ok(stories.find((s) => s.kind === "person" && s.primaryEntity === "Nora Idris"));
  assert.ok(stories.find((s) => s.kind === "discourse"));
  assert.ok(!stories.some((s) => s.primaryEntity === "Quiet Nobody Cares"));
  for (let i = 1; i < stories.length; i++) assert.ok(stories[i - 1].discourseHeat >= stories[i].discourseHeat);
});
console.log("— engine: norm / verbatim wall / floors —");
await check("norm drops quote marks + apostrophes, unifies dashes/whitespace/case (orthography rule)", () => {
  assert.equal(norm("“The  Sable — Coast’s\tending”"), "the sable - coasts ending");
});
await check("verbatim + curly/whitespace/emphasis-quote variants pass; paraphrase/merge fail", () => {
  const src = [{ text: SRC_A }];
  assert.equal(quoteIsVerbatim(Q.director, src), true);
  assert.equal(quoteIsVerbatim(Q.director.replace("ambiguous", "'ambiguous'"), src), true, "added emphasis quotes = orthography");
  assert.equal(quoteIsVerbatim("The people arguing about the final scene are exactly the audience I hoped\nto reach", src), true);
  assert.equal(quoteIsVerbatim("I wanted the finale open-ended and I have no regrets", src), false);
  assert.equal(quoteIsVerbatim(Q.director + " " + Q.lead, src), false, "merged two quotes fails");
  assert.equal(quoteIsVerbatim("I al", src), false, "sub-8-char fails");
});
await check("meetsFloor per form (anchors = named + fans; creator form needs a named quote)", () => {
  assert.equal(meetsFloor("audience-reaction", { namedVoices: 0, fanPosts: 3 }).ok, true);
  assert.equal(meetsFloor("audience-reaction", { namedVoices: 1, fanPosts: 1 }).ok, false);
  // the-debate now ALSO requires both stances in the anchors (2026-07-10 calibration: a one-sided
  // harvest parks at the floor instead of tempting a dishonest "divided" framing).
  assert.equal(meetsFloor("the-debate", { namedVoices: 1, fanPosts: 2, hasPositive: true, hasNegative: true }).ok, true);
  assert.equal(meetsFloor("the-debate", { namedVoices: 1, fanPosts: 2, hasPositive: true, hasNegative: false }).ok, false);
  assert.ok(/one-sided/.test(meetsFloor("the-debate", { namedVoices: 3, fanPosts: 3, hasPositive: false, hasNegative: true }).reason));
  assert.equal(meetsFloor("breakout-buzz", { namedVoices: 1, fanPosts: 1 }).ok, false);
  assert.equal(meetsFloor("creator-answers-critics", { namedVoices: 0, fanPosts: 3 }).ok, false);
  assert.equal(meetsFloor("creator-answers-critics", { namedVoices: 1, fanPosts: 1 }).ok, true);
  assert.equal(meetsFloor("creator-answers-critics", { namedVoices: 1, fanPosts: 0 }).ok, false);
});
await check("fallbackQueries disambiguates a title with its medium", () => {
  const qs = fallbackQueries(fakeTrigger(), fakeAngle("creator-answers-critics"));
  assert.ok(qs.some((q) => /The Sable Coast movie (responds criticism|addresses backlash)/.test(q)), JSON.stringify(qs));
});
console.log("— engine: store / routing —");
await check("store lifecycle: park 3→dead, record+dedup, clearParked, insideKey", () => {
  const store = loadStore(tmp("inside-store") + "/store.json");
  assert.equal(insideKey("ev", "the-debate"), "ev|the-debate");
  parkAngle(store, "ev", "the-debate", "under floor");
  parkAngle(store, "ev", "the-debate", "under floor");
  assert.notEqual(parkedTries(store, "ev", "the-debate"), Infinity);
  parkAngle(store, "ev", "the-debate", "under floor");
  assert.equal(parkedTries(store, "ev", "the-debate"), Infinity, "3rd park → dead");
  assert.equal(alreadyPublished(store, "ev", "audience-reaction"), false);
  recordInsidePublished(store, { parentEventSlug: "ev", form: "audience-reaction", slug: "s", title: "t" });
  assert.equal(alreadyPublished(store, "ev", "audience-reaction"), true);
  parkAngle(store, "ev", "breakout-buzz", "under floor");
  clearParked(store, "ev", "breakout-buzz");
  assert.equal(parkedTries(store, "ev", "breakout-buzz"), 0);
});
await check("routeForStory maps every category", () => {
  assert.deepEqual(routeForStory({ category: "awards" }), { category: "awards", subcategory: "winners" });
  assert.deepEqual(routeForStory({ category: "streaming" }), { category: "streaming", subcategory: "where-to-watch" });
  assert.deepEqual(routeForStory({ category: "movies" }), { category: "movies", subcategory: "news" });
  assert.deepEqual(routeForStory({ category: "tv" }), { category: "tv", subcategory: "news" });
  assert.deepEqual(routeForStory({ category: "celebrity" }), { category: "celebrity", subcategory: "news" });
  assert.deepEqual(routeForStory({ category: "music" }), { category: "music", subcategory: "news" });
  assert.deepEqual(routeForStory({ category: "unknown-x" }), { category: "celebrity", subcategory: "news" });
});


// ── gnewsDecode.mjs: keyless Google-News redirect decoding (the datacenter-runner supply fix) ────
console.log("— gnewsDecode.mjs —");

await check("gnewsArticleId parses rss/articles, articles and read paths; rejects non-gnews", () => {
  assert.equal(gnewsArticleId("https://news.google.com/rss/articles/ABC123?oc=5"), "ABC123");
  assert.equal(gnewsArticleId("https://news.google.com/articles/XYZ_9-8"), "XYZ_9-8");
  assert.equal(gnewsArticleId("https://news.google.com/read/QQ#frag"), "QQ");
  assert.equal(gnewsArticleId("https://variety.com/rss/articles/ABC"), null);
  assert.equal(gnewsArticleId("not a url"), null);
});

await check("decodeGnewsBase64 pulls the embedded publisher URL from a legacy blob", () => {
  const url = "https://variety.com/2026/film/news/some-story-1236012345/";
  const blob = "\x08\x13\x22" + String.fromCharCode(url.length) + url + "\xd2\x01\x00";
  const id = Buffer.from(blob, "latin1").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  assert.equal(decodeGnewsBase64(id), url);
});

await check("decodeGnewsBase64 skips google/amp URLs (incl. bare host) and returns null on garbage", () => {
  const g = "https://news.google.com";
  const a = "https://cdn.ampproject.org/y";
  const blob = "\x22" + String.fromCharCode(g.length) + g + "\x22" + String.fromCharCode(a.length) + a;
  const id = Buffer.from(blob, "latin1").toString("base64");
  assert.equal(decodeGnewsBase64(id), null);
  assert.equal(decodeGnewsBase64("AU_yqLNoUrlHere"), null);
});

await check("decodeGnewsBase64 exact-field parse: no glued trailing byte, no UTF-8 truncation", () => {
  const url = "https://variety.com/2026/film/story-123/";
  // printable tag byte 'B' RIGHT AFTER the field — the old regex glued it onto the URL
  const glued = "\x22" + String.fromCharCode(url.length) + url + "B\x00";
  assert.equal(decodeGnewsBase64(Buffer.from(glued, "latin1").toString("base64")), url);
  // raw UTF-8 byte INSIDE the field — the old regex truncated at it and returned a wrong prefix
  const utf = "https://variety.com/caf\xe9-story/";
  const trunc = "\x22" + String.fromCharCode(utf.length) + utf + "\x00";
  assert.equal(decodeGnewsBase64(Buffer.from(trunc, "latin1").toString("base64")), null);
});

await check("decodeGnewsUrl falls back to batchexecute and parses the RPC response", async () => {
  const real = "https://deadline.com/2026/07/fans-react-story/";
  const calls = [];
  const fetchImpl = async (u, opts = {}) => {
    calls.push(u);
    if (String(u).includes("/rss/articles/")) {
      return { ok: true, text: async () => '<c-wiz data-n-a-sg="SIG9" data-n-a-ts="1720000000"></c-wiz>' };
    }
    assert.ok(String(u).includes("batchexecute"));
    assert.ok(String(opts.body).includes("SIG9"));
    const payload = JSON.stringify(["garturlres", real]);
    return { ok: true, text: async () => ")]}'\n\n123\n" + JSON.stringify([["wrb.fr", "Fbv4je", payload, null, null, null, "generic"]]) };
  };
  // AU_-prefixed id → fast path yields nothing → network path (cache-busted with a unique id)
  assert.equal(await decodeGnewsUrl("https://news.google.com/rss/articles/AU_testONE?oc=5", { fetchImpl }), real);
  // cached: no further fetches
  const n = calls.length;
  assert.equal(await decodeGnewsUrl("https://news.google.com/rss/articles/AU_testONE", { fetchImpl }), real);
  assert.equal(calls.length, n);
});

await check("decodeGnewsUrl returns null (and caches it) when the page has no signature", async () => {
  const fetchImpl = async (u) => ({ ok: true, text: async () => "<html>consent wall</html>" });
  assert.equal(await decodeGnewsUrl("https://news.google.com/rss/articles/AU_testTWO", { fetchImpl }), null);
  const boom = async () => { throw new Error("no network allowed on cache hit"); };
  assert.equal(await decodeGnewsUrl("https://news.google.com/rss/articles/AU_testTWO", { fetchImpl: boom }), null);
});

console.log(`\n=== UNIT: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log("FAILED: " + fails.join(", ")); process.exit(1); }
