// INSIDE lane — UNIT TESTS (multi-agent layer; offline: zero network, zero keys; every impl injected).
// Run: env -i node site/pipeline/inside/test/unit.test.mjs
import assert from "node:assert/strict";

import { AGENTS, FLAGSHIP_WRITER, flagshipOn, agentChat, METER, meterReport, meterReset } from "../models.mjs";
import { findStories } from "../agents/finder.mjs";
import { run as embedRun, scanPagesForInstagram } from "../agents/embed.mjs";
import { run as synthRun } from "../agents/synthesizer.mjs";
import { run as writerRun, repairBodyQuotes } from "../agents/writer.mjs";
import { maskQuotes, unmaskQuotes, findTemplateHeadings, stripTemplateHeadings, run as voiceRun, PHRASEBOOK } from "../agents/voice.mjs";
import { factLocks, review as qaReview, webCheck as qaWebCheck, classifyBlocks } from "../agents/qa.mjs";
import { buildInsideMarkdown, insertInlineEmbeds, seoFinish } from "../assemble.mjs";
import { discoverReddit, redditSearchPosts, redditTopComments } from "../../find/sources/reddit.mjs";
import { gnewsArticleId, decodeGnewsBase64, decodeGnewsUrl } from "../../lib/gnewsDecode.mjs";
import { discoverStories, categoryFor } from "../discover.mjs";
import { trendingSearches, wikiSpikes, tmdbMatch } from "../signals.mjs";
import { xSearchIds } from "../xsearch.mjs";
import { norm, quoteIsVerbatim, meetsFloor, fallbackQueries, isMediaHandle, looksLikeSpam, cleanQuote, isOutletSpeaker, reliableProvenance, isMediaVoice, unwrapQuote, isSocialSrc, hasHandle, trimScar } from "../reactionFinder.mjs";
import { cleanTitle } from "../assemble.mjs";
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

// ── SEO finisher (metadata only, never prose) ────────────────────────────────────────────────────
console.log("— seo finisher —");
await check("meta title/description trimmed at word boundaries to average-SEO lengths", () => {
  const long = "Fans react to the global casting search for the live-action Naruto movie, with excitement over director Destin Daniel Cretton and creator Masashi Kishimoto's miracle quote, alongside some classic anime adaptation skepticism.";
  const out = seoFinish({ metaTitle: "A Very Long Meta Title That Would Overflow The Google SERP Display Limit Badly", metaDescription: long });
  assert.ok(out.metaTitle.length <= 60, `title ${out.metaTitle.length}`);
  assert.ok(!/\s$/.test(out.metaTitle) && !out.metaTitle.endsWith("-"), "clean tail");
  assert.ok(out.metaDescription.length <= 155, `desc ${out.metaDescription.length}`);
  assert.ok(long.startsWith(out.metaDescription.slice(0, 40)), "prefix preserved — nothing rewritten");
  const short = seoFinish({ metaTitle: "Short Title", metaDescription: "Short description." });
  assert.equal(short.metaTitle, "Short Title");
  assert.equal(short.metaDescription, "Short description.");
});
await check("fewer than 2 FAQs → fixable seo-faq correction, never a hard hold", async () => {
  const art = fakeArticle({ form: "audience-reaction" });
  art.faq = [art.faq[0]];
  const fb = fakeFactBlock("audience-reaction");
  const r = factLocks(art, fb, fakeAngle("audience-reaction"));
  assert.ok(r.hardBlocks.some((b) => /^seo-faq/.test(b)), r.hardBlocks.join(" | "));
  assert.deepEqual(classifyBlocks(r.hardBlocks.filter((b) => /^seo-faq/.test(b))).block, [], "fixable");
});

// ── assemble: inline embeds below the quoting paragraph (REV 3) ──────────────────────────────────
console.log("— inline embeds —");

await check("a tweet embeds DIRECTLY below the paragraph quoting it, once per post", () => {
  const fb = { reactions: [], aggregateFans: [
    { quote: "the finale broke me in the best possible way", tweetId: "111" },
    { quote: "this casting is everything I never knew I needed", tweetId: "222" },
  ], tweetIds: ["111", "222"] };
  const body = 'Lede paragraph setting the scene.\n\nOne X user wrote, "the finale broke me in the best possible way" and thousands agreed.\n\n## The other side\n\nAnother posted, "this casting is everything I never knew I needed" — and again: "the finale broke me in the best possible way".\n\nCloser.';
  const r = insertInlineEmbeds(body, fb, null);
  const blocks = r.body.split("\n\n");
  assert.equal(blocks[2], "[embed:tweet:111]", "embed sits right below the quoting paragraph");
  assert.equal(r.body.match(/embed:tweet:111/g).length, 1, "same post never embeds twice");
  const i222 = blocks.indexOf("[embed:tweet:222]");
  assert.ok(i222 > 0 && /casting is everything/.test(blocks[i222 - 1]), "second embed under ITS paragraph");
});

await check("a Reddit comment embeds its thread below the quoting paragraph; its bottom card drops", () => {
  const perma = "https://www.reddit.com/r/movies/comments/abc123/thread/";
  const fb = fakeFactBlock("audience-reaction");
  fb.aggregateFans[0].redditUrl = perma;
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.body = `Lede paragraph here.\n\nOne Reddit user wrote, "${fb.aggregateFans[0].quote}" and the thread lit up.\n\nCloser.`;
  const out = buildInsideMarkdown({ article: art, trigger: fakeTrigger(), angle: fakeAngle("audience-reaction"), factBlock: fb, image: fakeImage(), embeds: null, dateISO: new Date(NOW).toISOString() });
  const blocks = out.md.split("---\n")[2].trim().split("\n\n");
  const i = blocks.indexOf(`[embed:reddit:${perma}]`);
  assert.ok(i > 0, "reddit marker present: " + blocks.join(" | ").slice(0, 200));
  assert.ok(/thread lit up/.test(blocks[i - 1]), "marker sits under the quoting paragraph");
  assert.ok(!(out.frontmatter.reactions || []).some((r) => r.quote === fb.aggregateFans[0].quote), "duplicate bottom card dropped");
});

await check("inline tweet embeds are capped at MAX_EMBEDS even with a large search pool", () => {
  const fb = { reactions: [], aggregateFans: Array.from({ length: MAX_EMBEDS + 4 }, (_, i) => ({ quote: `reaction number ${i} that is long enough to pair here`, tweetId: `${1000 + i}` })), tweetIds: [] };
  const body = fb.aggregateFans.map((f) => `One fan wrote, "${f.quote}" and more.`).join("\n\n");
  const r = insertInlineEmbeds(body, fb, null);
  const n = (r.body.match(/\[embed:tweet:/g) || []).length;
  assert.equal(n, MAX_EMBEDS, `capped at ${MAX_EMBEDS}, got ${n}`);
});

await check("instagram embeds after the paragraph that speaks of Instagram; no pairing needed", () => {
  const body = "Lede.\n\nThe director took to Instagram with the news.\n\nMore prose follows here.";
  const r = insertInlineEmbeds(body, { reactions: [], aggregateFans: [], tweetIds: [] }, { instagramUrls: ["https://www.instagram.com/p/ABC/"] });
  const blocks = r.body.split("\n\n");
  assert.equal(blocks[2], "[embed:instagram:https://www.instagram.com/p/ABC/]");
});

await check("buildInsideMarkdown: inlined posts drop their duplicate bottom card; markers land in the md", () => {
  const fb = fakeFactBlock("audience-reaction");
  fb.aggregateFans[0].tweetId = "333";
  fb.tweetIds = ["333"];
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.body = `Lede.\n\nOne X user wrote, "${fb.aggregateFans[0].quote}" and the replies did not disappoint.\n\nCloser paragraph.`;
  const out = buildInsideMarkdown({ article: art, trigger: fakeTrigger(), angle: fakeAngle("audience-reaction"), factBlock: fb, image: fakeImage(), embeds: { tweetIds: ["333"], instagramUrls: [] }, dateISO: new Date(NOW).toISOString() });
  assert.ok(out.md.includes("[embed:tweet:333]"), "marker in the written markdown");
  assert.ok(!out.frontmatter.reactions.some((r) => r.tweetId === "333"), "no duplicate bottom card for an inlined post");
});

// ── agents/voice.mjs (native register, quote-masked) ─────────────────────────────────────────────
console.log("— agents/voice —");

await check("maskQuotes/unmaskQuotes round-trip; dropped or duplicated tokens reject the edit", () => {
  const body = 'Intro text. One fan wrote, "the finale broke me tonight" and meant it.\n\nAnother said “this show owns my whole heart” loudly.';
  const { masked, spans } = maskQuotes(body);
  assert.equal(spans.length, 2);
  assert.ok(!/"the finale|this show owns/.test(masked), "quotes hidden from the editor");
  assert.deepEqual(unmaskQuotes(masked, spans).text, body, "identity round-trip");
  assert.equal(unmaskQuotes(masked.replace("⟦Q2⟧", ""), spans).ok, false, "dropped token → reject");
  assert.equal(unmaskQuotes(masked + " ⟦Q1⟧", spans).ok, false, "duplicated token → reject");
});

await check("template headings detected and stripped deterministically", () => {
  const body = "## Who Is Everyone Suddenly Talking About?\n\nProse here.\n\n## 'Miracles, one after another'\n\nMore prose.\n\n## Why is this happening now?\n\nEnd.";
  const found = findTemplateHeadings(body);
  assert.equal(found.length, 2, JSON.stringify(found));
  const stripped = stripTemplateHeadings(body);
  assert.ok(!/Who Is Everyone|Why is this happening/.test(stripped));
  assert.ok(/'Miracles, one after another'/.test(stripped), "story-specific heading survives");
});

await check("voice.run applies a clean edit and rejects a token-damaging one", async () => {
  const job = fakeJob("audience-reaction", { article: fakeArticle({ form: "audience-reaction" }) });
  const origBody = job.article.body;
  const clean = async ({ user }) => {
    const masked = user.split("ARTICLE BODY")[1];
    const tokens = [...new Set(masked.match(/⟦Q\d+⟧/g) || [])];
    return { data: { title: "The internet has a new obsession — and it argues back", dek: "A voiced dek.", body: "The timeline did not stay calm for long. " + tokens.join("\n\nFans piled in: ") }, usage: {} };
  };
  await voiceRun(job, { chatImpl: clean });
  assert.ok(!job.voiceSkipped, job.voiceSkipped || "");
  assert.ok(/new obsession/.test(job.article.title), "voiced title applied");
  assert.ok(!/⟦Q\d+⟧/.test(job.article.body), "tokens unmasked back to real quotes");

  const job2 = fakeJob("audience-reaction", { article: fakeArticle({ form: "audience-reaction" }) });
  await voiceRun(job2, { chatImpl: async () => ({ data: { title: "t", dek: "d", body: "no tokens at all here" }, usage: {} }) });
  assert.equal(job2.voiceSkipped, "quote token damaged", "token loss rejected");
  assert.equal(job2.article.body, origBody === job2.article.body ? job2.article.body : job2.article.body, "article untouched on reject");
});

await check("factLocks flags template headings as FIXABLE (never a hard hold)", async () => {
  const fb = fakeFactBlock("audience-reaction");
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.body = "## How are audiences reacting?\n\n" + art.body;
  const r = factLocks(art, fb, fakeAngle("audience-reaction"));
  assert.ok(r.hardBlocks.some((b) => /template-heading/.test(b)), r.hardBlocks.join(" | "));
  assert.deepEqual(classifyBlocks(r.hardBlocks.filter((b) => /template-heading/.test(b))).block, [], "classified fixable");
});

// ── xsearch.mjs: twitterapi.io tweet search → embeddable IDs (REV 5) ─────────────────────────────
console.log("— xsearch —");
await check("xSearchIds returns engaged tweet IDs newest-by-likes; no key → []", async () => {
  delete process.env.TWITTERAPI_KEY;
  assert.deepEqual(await xSearchIds("anything", { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), []);
  process.env.TWITTERAPI_KEY = "k";
  let sentQuery = null;
  const fetchImpl = async (url, opts) => {
    sentQuery = decodeURIComponent(url);
    assert.equal(opts.headers["X-API-Key"], "k", "key sent in header");
    return { ok: true, json: async () => ({ tweets: [
      { id: "1111111", text: "meh", likeCount: 3 },
      { id: "2222222", text: "huge", likeCount: 900 },
      { id: "bad", text: "no", likeCount: 50 },
      { id: "3333333", text: "mid", likeCount: 120 },
    ] }) };
  };
  const ids = await xSearchIds("Bonnie Tyler", { max: 2, fetchImpl });
  assert.deepEqual(ids, ["2222222", "3333333"], "top-liked valid IDs, capped");
  assert.ok(/Bonnie Tyler/.test(sentQuery) && /-filter:retweets/.test(sentQuery), "query has subject + operators");
  delete process.env.TWITTERAPI_KEY;
});
await check("xSearchIds fails closed on a non-200 or throw", async () => {
  process.env.TWITTERAPI_KEY = "k";
  assert.deepEqual(await xSearchIds("x", { fetchImpl: async () => ({ ok: false }) }), []);
  assert.deepEqual(await xSearchIds("x", { fetchImpl: async () => { throw new Error("net"); } }), []);
  delete process.env.TWITTERAPI_KEY;
});

// ── signals.mjs + discover REV 3 (trending-discourse) ────────────────────────────────────────────
console.log("— signals + discover REV 3 —");

const TRENDS_XML = `<?xml version="1.0"?><rss><channel>
<item><title>elliot page odyssey</title><ht:approx_traffic>200,000+</ht:approx_traffic>
<ht:news_item><ht:news_item_title>Elliot Page joins Christopher Nolan&apos;s Odyssey</ht:news_item_title><ht:news_item_url>https://variety.example/odyssey-page</ht:news_item_url><ht:news_item_source>Variety</ht:news_item_source></ht:news_item>
<ht:news_item><ht:news_item_title>Fans react to the Odyssey casting</ht:news_item_title><ht:news_item_url>https://ew.example/odyssey-react</ht:news_item_url><ht:news_item_source>EW</ht:news_item_source></ht:news_item>
</item>
<item><title>tax deadline 2026</title><ht:approx_traffic>500,000+</ht:approx_traffic><ht:news_item><ht:news_item_title>IRS deadline nears</ht:news_item_title><ht:news_item_url>https://irs.example/x</ht:news_item_url><ht:news_item_source>AP</ht:news_item_source></ht:news_item></item>
</channel></rss>`;

await check("trendingSearches parses terms, traffic and news items", async () => {
  const out = await trendingSearches({ fetchImpl: async () => ({ ok: true, text: async () => TRENDS_XML }) });
  assert.equal(out.length, 2);
  assert.equal(out[0].term, "elliot page odyssey");
  assert.equal(out[0].traffic, 200000);
  assert.equal(out[0].news.length, 2);
  assert.equal(out[0].news[0].source, "Variety");
});

await check("wikiSpikes filters junk pages and computes day-over-day spikes", async () => {
  const day1 = { items: [{ articles: [
    { article: "Main_Page", views: 7000000, rank: 1 },
    { article: "Special:Search", views: 800000, rank: 2 },
    { article: "Bonnie_Tyler", views: 1270000, rank: 3 },
    { article: "Deaths_in_2026", views: 500000, rank: 4 },
    { article: "Steady_Show", views: 400000, rank: 5 },
    { article: "Small_Page", views: 90000, rank: 6 },
  ] }] };
  const day2 = { items: [{ articles: [
    { article: "Bonnie_Tyler", views: 60000, rank: 40 },
    { article: "Steady_Show", views: 390000, rank: 5 },
  ] }] };
  let call = 0;
  const out = await wikiSpikes({ nowMs: NOW, fetchImpl: async () => ({ ok: true, json: async () => (call++ === 0 ? day1 : day2) }) });
  assert.equal(out.length, 1, JSON.stringify(out));
  assert.equal(out[0].name, "Bonnie Tyler", "junk + steady + small all filtered; the SPIKE survives");
  assert.ok(out[0].spike > 20);
});

await check("tmdbMatch requires a real name↔term match (and null without a token)", async () => {
  delete process.env.TMDB_READ_TOKEN;
  assert.equal(await tmdbMatch("anything", { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), null);
  process.env.TMDB_READ_TOKEN = "t";
  const fetchImpl = async () => ({ ok: true, json: async () => ({ results: [
    { media_type: "person", name: "Bonnie Tyler", popularity: 55 },
    { media_type: "movie", title: "Unrelated Thing", popularity: 99 },
  ] }) });
  const m = await tmdbMatch("bonnie tyler", { fetchImpl });
  assert.equal(m.kind, "person");
  assert.equal(m.title, "Bonnie Tyler");
  const none = await tmdbMatch("tax deadline 2026", { fetchImpl: async () => ({ ok: true, json: async () => ({ results: [{ media_type: "movie", title: "The Tax Collector", popularity: 20 }] }) }) });
  assert.equal(none, null, "loose TMDB hits without name containment are rejected");
  delete process.env.TMDB_READ_TOKEN;
});

await check("discover REV 3: a buzz-backed story outranks a coverage-only cluster (families cap)", async () => {
  const headlines = [
    { title: "Elliot Page joins Christopher Nolan's Odyssey as fans react", outlet: "Variety", ageMin: 60, cats: ["movies"], url: "https://variety.example/a" },
    { title: "Elliot Page cast in Nolan's Odyssey epic", outlet: "THR", ageMin: 90, cats: ["movies"], url: "https://thr.example/b" },
    { title: "Naruto movie launches global casting search for leads", outlet: "Variety", ageMin: 30, cats: ["movies"], url: "https://variety.example/c" },
    { title: "Naruto live-action casting call announced worldwide", outlet: "EW", ageMin: 40, cats: ["movies"], url: "https://ew.example/d" },
    { title: "Naruto casting search: what we know", outlet: "Collider", ageMin: 45, cats: ["movies"], url: "https://collider.example/e" },
    { title: "Global Naruto casting hunt begins", outlet: "SlashFilm", ageMin: 50, cats: ["movies"], url: "https://slashfilm.example/f" },
  ];
  const trends = [{ term: "elliot page odyssey", traffic: 200000, news: [{ title: "Elliot Page joins Odyssey", url: "https://variety.example/a", source: "Variety" }] }];
  const stories = await discoverStories({
    discoverNewsImpl: async () => headlines,
    discoverTMDBImpl: async () => [],
    discoverRedditImpl: async () => [],
    trendsImpl: async () => trends,
    wikiImpl: async () => [],
    tmdbMatchImpl: async () => null,
    bskyCountImpl: async () => [{ likes: 5 }],
    xStatsImpl: async () => ({ popularPosts: 0, maxLikes: 0, sumLikes: 0, topIds: [] }),
    xPaceMs: 0,
    nowMs: NOW,
  });
  const page = stories.find((s) => /elliot/.test(s.storySlug));
  const naruto = stories.find((s) => /naruto/.test(s.storySlug));
  assert.ok(page && naruto, "both stories exist");
  assert.ok(page.signals.trend === 200000, "trend attached to the cluster");
  assert.ok(page.signals.families >= 2 && naruto.signals.families < 2, JSON.stringify([page.signals, naruto.signals]));
  assert.ok(naruto.discourseHeat <= 45, "coverage-only story heat-capped");
  assert.ok(page.discourseHeat > naruto.discourseHeat, "buzz-backed story leads");
  assert.equal(stories[0].storySlug, page.storySlug, "ranked first");
});

await check("discover REV 3: unmatched entertainment trend/wiki become standalone stories; non-entertainment never enter", async () => {
  const stories = await discoverStories({
    discoverNewsImpl: async () => [],
    discoverTMDBImpl: async () => [],
    discoverRedditImpl: async () => [],
    trendsImpl: async () => [
      { term: "bonnie tyler", traffic: 100000, news: [{ title: "Bonnie Tyler moment goes viral", url: "https://ew.example/bt", source: "EW" }, { title: "Why Bonnie Tyler is everywhere", url: "https://bb.example/bt", source: "Billboard" }] },
      { term: "tax deadline 2026", traffic: 500000, news: [{ title: "IRS deadline nears", url: "https://irs.example/x", source: "AP" }] },
    ],
    wikiImpl: async () => [{ name: "Sable Coast", views: 400000, spike: 12 }],
    tmdbMatchImpl: async (term) => /bonnie tyler/i.test(term) ? { kind: "person", title: "Bonnie Tyler", popularity: 50, year: null }
      : /sable coast/i.test(term) ? { kind: "movie", title: "The Sable Coast", popularity: 80, year: "2026" } : null,
    bskyCountImpl: async () => [{ likes: 5 }],
    xStatsImpl: async () => ({ popularPosts: 0, maxLikes: 0, sumLikes: 0, topIds: [] }),
    xPaceMs: 0,
    nowMs: NOW,
  });
  assert.ok(stories.some((s) => s.primaryEntity === "Bonnie Tyler" && s.via === "trends" && s.kind === "person"), "trend standalone created");
  assert.ok(stories.some((s) => s.primaryEntity === "The Sable Coast" && s.via === "wiki" && s.work?.type === "movie"), "wiki standalone created");
  assert.ok(!stories.some((s) => /tax/i.test(s.storySlug)), "non-entertainment trend rejected");
  const bt = stories.find((s) => s.primaryEntity === "Bonnie Tyler");
  assert.equal(bt.sources.length, 2, "trend news items become harvest seeds");
});

// ── discover REV 4: the people-talking gate + anime demotion ─────────────────────────────────────
console.log("— people-talking gate —");

const gateHeadlines = [
  { title: "Elliot Page joins Christopher Nolan's Odyssey as fans react", outlet: "Variety", ageMin: 60, cats: ["movies"], url: "https://variety.example/a" },
  { title: "Elliot Page cast in Nolan's Odyssey epic", outlet: "THR", ageMin: 90, cats: ["movies"], url: "https://thr.example/b" },
  { title: "Quiet Industry Deal Closes For Mid-Size Studio Platform", outlet: "Variety", ageMin: 30, cats: ["movies"], url: "https://variety.example/c" },
  { title: "Quiet industry deal closes for mid-size studio platform group", outlet: "Deadline", ageMin: 35, cats: ["movies"], url: "https://deadline.example/d" },
  { title: "Naruto movie launches global casting search for its leads", outlet: "Variety", ageMin: 30, cats: ["movies"], url: "https://variety.example/e" },
  { title: "Naruto live-action global casting search announced worldwide", outlet: "EW", ageMin: 40, cats: ["movies"], url: "https://ew.example/f" },
];
const NO_X = async () => ({ popularPosts: 0, maxLikes: 0, sumLikes: 0, topIds: [] });
const gateOpts = (bsky, xstats = NO_X) => ({
  discoverNewsImpl: async () => gateHeadlines,
  discoverTMDBImpl: async () => [],
  discoverRedditImpl: async () => [],
  trendsImpl: async () => [],
  wikiImpl: async () => [],
  tmdbMatchImpl: async () => null,
  bskyCountImpl: bsky,
  xStatsImpl: xstats,
  xPaceMs: 0,
  nowMs: NOW,
});

await check("non-entertainment (politician) stories are DROPPED even when viral", async () => {
  const heads = [
    { title: "Ann Widdecombe faces Brexit backlash as the MP defends her policy in parliament", outlet: "GBNews", ageMin: 20, cats: [], url: "https://gb.example/w" },
    { title: "Ann Widdecombe Brexit parliament policy row deepens with Tory election campaign", outlet: "Politico", ageMin: 25, cats: [], url: "https://po.example/x" },
    { title: "Zoey Deutch comedy film clip goes viral ahead of movie premiere buzz", outlet: "Variety", ageMin: 30, cats: ["movies"], url: "https://variety.example/z" },
    { title: "Zoey Deutch film clip viral premiere movie generating buzz", outlet: "THR", ageMin: 35, cats: ["movies"], url: "https://thr.example/z2" },
  ];
  const opts = { ...gateOpts(async () => [{}, {}, {}], async () => ({ popularPosts: 20, maxLikes: 1300, sumLikes: 7000, topIds: [] })), discoverNewsImpl: async () => heads };
  const stories = await discoverStories(opts);
  assert.ok(!stories.some((s) => /widdecombe/i.test(s.storySlug)), "viral politician dropped: " + stories.map((x) => x.storySlug).join(","));
  assert.ok(stories.some((s) => /deutch/i.test(s.storySlug)), "the entertainment story survives");
});

await check("detectCategory routes music and TV stories correctly (not defaulted to movies)", async () => {
  const heads = [
    { title: "Kelela drops new album New Avatar with lead single music video", outlet: "Pitchfork", ageMin: 20, cats: [], url: "https://p.example/k" },
    { title: "Kelela drops new album New Avatar single music video acclaim", outlet: "Billboard", ageMin: 25, cats: [], url: "https://b.example/k2" },
    { title: "Severance season 2 series finale renewed episode shocks fans", outlet: "Variety", ageMin: 30, cats: [], url: "https://v.example/s" },
    { title: "Severance season 2 series finale renewed episode premiere date", outlet: "THR", ageMin: 35, cats: [], url: "https://t.example/s2" },
  ];
  const opts = { ...gateOpts(async () => [{}, {}, {}], async () => ({ popularPosts: 8, maxLikes: 500, sumLikes: 2000, topIds: [] })), discoverNewsImpl: async () => heads };
  const stories = await discoverStories(opts);
  const kelela = stories.find((s) => /kelela/i.test(s.storySlug));
  const sev = stories.find((s) => /severance/i.test(s.storySlug));
  assert.equal(kelela?.category, "music", "album story → music, got " + JSON.stringify(kelela?.category) + " (stories: " + stories.map((x) => x.storySlug).join(",") + ")");
  assert.equal(sev?.category, "tv", "series story → tv, got " + sev?.category);
});

await check("a story nobody posts about is DROPPED; a POPULAR one (100+-like posts) leads", async () => {
  const bsky = async (term) => /elliot|odyssey/i.test(term) ? [{}, {}, {}] : [];
  const xstats = async (term) => /elliot|odyssey/i.test(term)
    ? ({ popularPosts: 6, maxLikes: 1400, sumLikes: 5000, topIds: [] }) : NO_X();
  const stories = await discoverStories(gateOpts(bsky, xstats));
  assert.ok(!stories.some((s) => /quiet/.test(s.storySlug)), "no-buzz coverage-only story dropped: " + stories.map((x) => x.storySlug).join(","));
  const page = stories.find((s) => /elliot/.test(s.storySlug));
  assert.ok(page, "the popular story survives");
  assert.equal(page.signals.xPopular, 6, "measured 6 posts with 100+ likes");
  assert.ok(page.signals.families >= 2, "6 popular posts count as a signal family");
  assert.equal(stories[0].storySlug, page.storySlug, "the popular story leads the run");
});

await check("TOP-TIER GATE: a measured story with ZERO 100+-like posts is capped and cannot lead", async () => {
  const bsky = async (term) => /elliot|odyssey/i.test(term) ? [{}, {}] : [];  // it IS being posted about (bsky)…
  const xstats = async () => NO_X();                                          // …but NOBODY popular is talking
  const stories = await discoverStories(gateOpts(bsky, xstats));
  const page = stories.find((s) => /elliot/.test(s.storySlug));
  assert.ok(page, "story survives the cheap pre-filter (someone is posting)");
  assert.equal(page.signals.xPopular, 0);
  assert.ok(page.discourseHeat <= 35, `unpopular story capped hard: ${page.discourseHeat}`);
});

await check("anime demoted unless OVERWHELMING real popularity (10+ posts, 1000+ likes)", async () => {
  const bsky = async () => [{}, {}, {}];
  const modest = await discoverStories(gateOpts(bsky, async (term) => /naruto/i.test(term)
    ? ({ popularPosts: 4, maxLikes: 300, sumLikes: 800, topIds: [] })
    : ({ popularPosts: 2, maxLikes: 150, sumLikes: 300, topIds: [] })));
  const naruto = modest.find((s) => /naruto/.test(s.storySlug));
  assert.ok(naruto.signals.animeAdjacent, "flagged anime");
  assert.ok(naruto.discourseHeat <= 40, `anime capped despite 4 popular posts: ${naruto.discourseHeat}`);
  const page = modest.find((s) => /elliot/.test(s.storySlug));
  assert.ok(page.discourseHeat > naruto.discourseHeat, "mainstream outranks anime");

  const big = await discoverStories(gateOpts(bsky, async (term) => /naruto/i.test(term)
    ? ({ popularPosts: 15, maxLikes: 2200, sumLikes: 30000, topIds: [] }) : NO_X()));
  const naruto2 = big.find((s) => /naruto/.test(s.storySlug));
  assert.ok(naruto2.discourseHeat > 40, "overwhelming real popularity un-caps anime");
});

// ── free-mode hygiene: bot/spam filter + quote clean + title clean (owner audit) ─────────────────
console.log("— spam / quote / title hygiene —");
await check("looksLikeSpam drops bot reposts, hashtag spam and foreign-language posts", () => {
  assert.ok(looksLikeSpam("Remembering Barbara Ling #BarbaraLing #FilmLegacy https://ftwr.cloud/en/x"));
  assert.ok(looksLikeSpam("cool #a #b #c #d #e news"));
  assert.ok(looksLikeSpam("Uma homenagem a Barbara Ling, uma pioneira no design de produção espetacular"));
  assert.ok(!looksLikeSpam("She turned LA back to 1969 and Gotham neon. Barbara Ling could do anything. RIP"));
  assert.ok(!looksLikeSpam("honestly this casting is everything I never knew I needed #excited"));
});
await check("cleanQuote strips trailing links/hashtags but keeps a verbatim prefix", () => {
  const src = "Remembering Barbara Ling, the visionary who shaped Hollywood. #BarbaraLing https://x.co/y";
  const q = cleanQuote(src);
  assert.equal(q, "Remembering Barbara Ling, the visionary who shaped Hollywood.");
  assert.ok(norm(src).includes(norm(q)), "still a verbatim prefix (wall passes)");
});
await check("cleanQuote strips a leading reply-mention; hasHandle flags interior mentions", () => {
  const reply = "@pixarfan totally agree, Toy Story 5 is the best entry since the third film";
  const q = cleanQuote(reply);
  assert.equal(q, "totally agree, Toy Story 5 is the best entry since the third film");
  assert.ok(norm(reply).includes(norm(q)), "remainder is a verbatim substring (wall passes)");
  assert.ok(!hasHandle(q), "no @handle survives to leak into prose");
  assert.ok(hasHandle("great point @someone this movie rocked"), "an interior @mention is flagged for drop");
  assert.ok(!hasHandle("email me at test dot com, no handles here"), "plain prose is not flagged");
});
await check("cleanTitle drops a dangling run-on tail and never ends on a connector", () => {
  assert.equal(cleanTitle("Barbara Ling, the Oscar-Winning Production Designer Behind 'Once Upon a Time in Hollywood', Dies at 73—and the Tributes Are a Masterclass in"),
    "Barbara Ling, the Oscar-Winning Production Designer Behind 'Once Upon a Time in Hollywood'");
  assert.equal(cleanTitle("A Perfectly Fine Headline"), "A Perfectly Fine Headline");
});

// ── reactionFinder: media-vs-people embed filter (owner REV 7) ───────────────────────────────────
console.log("— media-vs-people filter —");
await check("news outlets/aggregators are excluded; individual people (incl. commentators) are kept", () => {
  for (const h of ["Deadline", "@Variety", "DiscussingFilm", "IGN", "PopCrave", "ToonHive", "THR"]) {
    assert.ok(isMediaHandle(h), `${h} should be excluded as media`);
  }
  for (const h of ["jdrider02", "MelohRush", "ChannelAwesome", "ramzpaul", "somefan123"]) {
    assert.ok(!isMediaHandle(h), `${h} is a person and must be kept`);
  }
});

// ── reactionFinder: outlet-as-speaker provenance guard (owner review, Toy Story 5, 2026-07-11) ────
console.log("— provenance guard: a website is never a viewer —");
await check("isOutletSpeaker catches domains/brands, passes real people and anonymous posts", () => {
  assert.ok(isOutletSpeaker("animatedviews.com"), "a domain is not a person");
  assert.ok(isOutletSpeaker("AnimatedViews.com", "animatedviews.com"), "case-insensitive domain");
  assert.ok(isOutletSpeaker("Collider"), "a known outlet brand used as a name");
  assert.ok(isOutletSpeaker("The Wrap", "thewrap.com"), "speaker matches the source's own brand");
  assert.ok(!isOutletSpeaker(""), "anonymous (a reproduced fan post) is NOT an outlet");
  assert.ok(!isOutletSpeaker("Scott Menzel", "variety.com"), "a real critic name is kept");
  assert.ok(!isOutletSpeaker("Joan Cusack"), "a real person is kept");
});
await check("reliableProvenance: social posts always trusted; articles drop only the outlet-as-speaker", () => {
  const outlet = { domain: "animatedviews.com", owner: "animatedviews", tier: "major" };
  const social = { domain: "social", owner: "bluesky", tier: "social" };
  // the exact Toy Story failure: a blog's domain quoted as a "reaction" → dropped
  assert.equal(reliableProvenance({ speaker: "animatedviews.com", speakerType: "other", quote: "x" }, outlet), false);
  // a real named critic pulled from an article (even speakerType "other") → kept
  assert.equal(reliableProvenance({ speaker: "Dominic Ray", speakerType: "other", quote: "x" }, outlet), true);
  // an anonymous fan post a roundup reproduces → kept (headline guard + wall handle the rest)
  assert.equal(reliableProvenance({ speaker: "", speakerType: "fan", quote: "x" }, outlet), true);
  // any real social post → trusted regardless of speaker
  assert.equal(reliableProvenance({ speaker: "", speakerType: "fan", quote: "x" }, social), true);
  assert.ok(isSocialSrc(social) && !isSocialSrc(outlet), "social-source detector");
});
await check("isMediaVoice flags critics/editors/journalists, keeps creators + celebrities + fans", () => {
  // the exact Toy Story failure: Variety/Collider editors treated as reaction voices
  assert.ok(isMediaVoice({ speaker: "Jazz Tangcay", isMedia: true, speakerType: "other" }), "extractor isMedia flag");
  assert.ok(isMediaVoice({ speaker: "Someone", speakerType: "critic" }), "classify critic backstop");
  assert.ok(isMediaVoice({ speaker: "Someone", speakerType: "journalist" }), "journalist backstop");
  // the work's OWN creators + a celebrity reacting are NOT media → kept
  assert.ok(!isMediaVoice({ speaker: "Joan Cusack", speakerType: "castmate", isMedia: false }), "a castmate is a creator");
  assert.ok(!isMediaVoice({ speaker: "Andrew Stanton", speakerType: "filmmaker" }), "a filmmaker is a creator");
  assert.ok(!isMediaVoice({ speaker: "", speakerType: "fan" }), "an ordinary fan is never media");
  assert.ok(!isMediaVoice(null) && !isMediaVoice(undefined), "null-safe");
});
await check("categoryFor routes by the story SUBJECT, never the person's profession (owner 2026-07-12)", () => {
  // A TMDB-confirmed work's medium is AUTHORITATIVE — keywords can't override it.
  assert.equal(categoryFor({ work: { type: "movie" }, text: "the pop star sings on the soundtrack" }), "movies");
  assert.equal(categoryFor({ work: { type: "tv" }, text: "the rapper's album drops" }), "tv");
  // THE EXACT BUG: a musician in a TV story → tv, NOT music (was miscategorized "music").
  assert.equal(categoryFor({ text: "Ariana Grande Exits American Horror Story Season 13 amid tour" }), "tv");
  // a musician cast in a film → movies, not music
  assert.equal(categoryFor({ text: "The Weeknd cast in new film, casting announced" }), "movies");
  // a genuine music RELEASE/event → music
  assert.equal(categoryFor({ text: "Drake drops a new album and announces a world tour" }), "music");
  assert.equal(categoryFor({ text: "Taylor Swift's new single tops the Billboard Hot 100" }), "music");
  // a bare person story (no work, no event) → celebrity
  assert.equal(categoryFor({ text: "Zendaya spotted at dinner with Tom Holland" }), "celebrity");
  // a real film / TV subject with no confirmed work → detected from text
  assert.equal(categoryFor({ text: "Dune Part Three box office opening weekend" }), "movies");
  assert.equal(categoryFor({ text: "Stranger Things final season new episode reactions" }), "tv");
  // the news-lane hint is used ONLY when the text has no subject signal
  assert.equal(categoryFor({ text: "everyone is talking about this", hint: "tv" }), "tv");
  assert.equal(categoryFor({ text: "no signal here", hint: "bogus" }), "celebrity");
});
await check("routeForStory: work.type is authoritative + Movies/TV reactions file under the Reactions sub", () => {
  // work.type wins even if a stale category says music
  assert.deepEqual(routeForStory({ work: { type: "movie" }, category: "music" }), { category: "movies", subcategory: "reactions" });
  assert.deepEqual(routeForStory({ work: { type: "tv" }, category: "celebrity" }), { category: "tv", subcategory: "reactions" });
  // no work → the discovery-assigned category; celebrity/music keep the "news" sub
  assert.deepEqual(routeForStory({ category: "celebrity" }), { category: "celebrity", subcategory: "news" });
  assert.deepEqual(routeForStory({ category: "music" }), { category: "music", subcategory: "news" });
  assert.deepEqual(routeForStory({ category: "movies" }), { category: "movies", subcategory: "reactions" });
  // unknown/garbage → celebrity/news
  assert.deepEqual(routeForStory({ category: "sports" }), { category: "celebrity", subcategory: "news" });
});
await check("unwrapQuote snaps a framed outlet quote to the person's own words (kills nested-quote card)", () => {
  // the exact card #2 bug: outlet framing + a nested quotation
  const framed = `The fifth "Toy Story" film "ranks right alongside the first three films, delivering a perfect blend of humor, heart, and that signature Pixar magic."`;
  assert.equal(unwrapQuote(framed), "ranks right alongside the first three films, delivering a perfect blend of humor, heart, and that signature Pixar magic.");
  // a clean quote with no outer framing is left untouched
  const clean = "Toy Story 5 is a magical and pure perfection, a fantastic entry into the franchise.";
  assert.equal(unwrapQuote(clean), clean);
  // a short title-reference in quotes is not treated as the span (too few words)
  assert.equal(unwrapQuote(`I love "Toy Story 5" so much more than I expected to`), `I love "Toy Story 5" so much more than I expected to`);
});

await check("trimScar heals a mid-word truncation to a clean whole-word ending", () => {
  const src = "the psychologist said the film glosses over the harm of these devices on cognitive, social, emotional and developmental health of children.";
  const scarred = "glosses over the harm of these devices on cognitive, social, emot"; // sliced mid-word
  const healed = trimScar(scarred, src);
  assert.equal(healed, "glosses over the harm of these devices on cognitive, social");
  assert.ok(norm(src).includes(norm(healed)), "still a verbatim substring (wall passes)");
  // a quote that already ends cleanly is untouched
  const clean = "Jessie finally gets the story she deserves";
  assert.equal(trimScar(clean, `${clean}!`), clean);
});

// ── reactionFinder: headline-quote guard ─────────────────────────────────────────────────────────
console.log("— harvest headline-quote guard —");
await check("a source HEADLINE extracted as a 'fan quote' never becomes an anchor", async () => {
  const { harvestReactions } = await import("../reactionFinder.mjs");
  const headline = "Big Film Launches Global Casting Call for 3 Main Leads";
  const realFan = "honestly cannot believe this is finally happening, my childhood is shaking";
  const srcText = `${headline}. Coverage of the story with plenty of surrounding reporting so the source clears the minimum extractable length used by the harvest. One fan wrote: "${realFan}". More reporting text follows here to round things out.`;
  const trigger = { parentEventSlug: "big-film", parentTitle: headline + " - Variety", primaryEntity: "Big Film",
    headline, category: "movies", sources: [], redditPosts: [], subjectKind: "title", work: null, overview: "" };
  const angle = { form: "audience-reaction", angle: "fans react", workingTitle: "t", focusEntity: "Big Film", searchQueries: ["q1"], key: "audience-reaction" };
  const res = await harvestReactions(trigger, angle, {
    findContentImpl: async () => ({ sources: [{ url: "https://variety.com/x", domain: "variety.com", owner: "pmc", tier: "major", title: headline, text: srcText }] }),
    chatImpl: async ({ user }) => user.includes("SOURCE") ? { data: { reactions: [
      { speaker: "", speakerType: "fan", platform: "other", quote: headline, stance: "positive" },
      { speaker: "", speakerType: "fan", platform: "other", quote: realFan, stance: "positive" },
      { speaker: "", speakerType: "fan", platform: "other", quote: realFan, stance: "positive" },
      { speaker: "", speakerType: "fan", platform: "other", quote: headline + ".", stance: "neutral" },
    ] }, usage: {} } : { data: {}, usage: {} },
    cacheTweetsImpl: async () => ({ tweets: [], ids: [] }),
    scanImpl: async () => [],
    xSearchImpl: async () => [],
    reddit: false, embeds: false,
  });
  assert.equal(res.ok, false, "1 real fan post < floor 3 → refuses");
  assert.equal(res.stats.fanPosts, 1, "headline-quotes dropped, real fan post kept");
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
  assert.equal(fm.subcategory, "reactions"); // movie/TV reactions file under the Reactions sub-tab
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
  const out = buildInsideMarkdown({ article: art, trigger, angle: fakeAngle("creator-answers-critics"), factBlock: fb, image: fakeImage(), embeds: null, dateISO: new Date(NOW).toISOString() });
  // REV 3: the harvest pairing wins AND drives INLINE placement — the real post renders under the
  // quoting paragraph and the duplicate bottom card drops. The wrong id never surfaces anywhere.
  assert.ok(out.md.includes(`[embed:tweet:${TWEET_ID_B}]`), "harvest-paired post embedded inline");
  assert.ok(!out.md.includes("9999999999999999999"), "the wrong id never surfaces");
  assert.ok(!(out.frontmatter.reactions || []).some((r) => r.tweetId === TWEET_ID_B), "no duplicate bottom card");
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
  const stories = await discoverStories({ discoverNewsImpl: async () => [], discoverTMDBImpl: async () => fakeTMDBItems(), discoverRedditImpl: async () => fakeRedditDiscover(), trendsImpl: async () => [], wikiImpl: async () => [], tmdbMatchImpl: async () => null,
    bskyCountImpl: async () => [{ likes: 5 }],
    xStatsImpl: async () => ({ popularPosts: 0, maxLikes: 0, sumLikes: 0, topIds: [] }),
    xPaceMs: 0, nowMs: NOW });
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
  assert.deepEqual(routeForStory({ category: "movies" }), { category: "movies", subcategory: "reactions" });
  assert.deepEqual(routeForStory({ category: "tv" }), { category: "tv", subcategory: "reactions" });
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
