// INSIDE lane — UNIT TESTS (REV 2; offline: zero network, zero keys; every impl injected).
// Run: env -i node site/pipeline/inside/test/unit.test.mjs
import assert from "node:assert/strict";

import { discoverReddit, redditSearchPosts, redditTopComments } from "../../find/sources/reddit.mjs";
import { discoverStories } from "../discover.mjs";
import { loadTriggers } from "../trigger.mjs";
import { norm, quoteIsVerbatim, meetsFloor, fallbackQueries } from "../reactionFinder.mjs";
import { routeForStory } from "../config.inside.mjs";
import { loadStore, alreadyPublished, recordInsidePublished, parkAngle, parkedTries, clearParked, insideKey } from "../store.mjs";
import { deterministicInside, classifyInsideBlocks } from "../gate.mjs";
import { buildInsideMarkdown } from "../assemble.mjs";
import {
  NOW, tmp, Q, SRC_A,
  fakeTrigger, fakeAngle, fakeFactBlock, fakeArticle, fakeImage,
  fakeTMDBItems, fakeRedditDiscover, redditListing, redditCommentsListing, fakeRedditPost,
} from "./fixtures.mjs";

let pass = 0, fail = 0; const fails = [];
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; fails.push(name); console.log(`  ❌ ${name}  ${String(e?.message || e).slice(0, 200)}`); }
};

console.log("\n=== INSIDE UNIT TESTS (REV 2, offline) ===\n");

// ── reddit.mjs (field mapping via discoverReddit + dedup/freshness/minComments) ───────────────────
console.log("— reddit.mjs —");
const rawPost = (id, nc, ageH, extra = {}) => ({ id, subreddit: "movies", title: ` t-${id}  x `, selftext: "body", permalink: `/r/movies/comments/${id}/`, url: "https://ew.com/a", score: 12, num_comments: nc, created_utc: Math.round((NOW - ageH * 3600000) / 1000), ...extra });

await check("mapPost fields (via discoverReddit): id/title/permalink/url/numComments/ageMin", async () => {
  const fetchImpl = async (u) => /hot\.json/.test(u)
    ? { ok: true, json: async () => redditListing([rawPost("x1", 30, 1)]) }
    : { ok: true, json: async () => redditListing([]) };
  const [p] = await discoverReddit({ subs: ["movies"], minComments: 25, fetchImpl, nowMs: NOW });
  assert.equal(p.id, "x1");
  assert.equal(p.title, "t-x1 x", "title stripped/collapsed");
  assert.equal(p.permalink, "https://www.reddit.com/r/movies/comments/x1/");
  assert.equal(p.url, "https://ew.com/a");
  assert.equal(p.numComments, 30);
  assert.equal(p.ageMin, 60);
});
await check("mapPost drops stickied and over_18 posts", async () => {
  const fetchImpl = async (u) => /hot\.json/.test(u)
    ? { ok: true, json: async () => redditListing([rawPost("ok", 50, 1), rawPost("sticky", 99, 1, { stickied: true }), rawPost("nsfw", 99, 1, { over_18: true })]) }
    : { ok: true, json: async () => redditListing([]) };
  const out = await discoverReddit({ subs: ["movies"], minComments: 25, fetchImpl, nowMs: NOW });
  const ids = out.map((p) => p.id);
  assert.ok(ids.includes("ok"));
  assert.ok(!ids.includes("sticky") && !ids.includes("nsfw"));
});
await check("discoverReddit dedups across subs, drops stale + low-comment, sorts by comments", async () => {
  const fetchImpl = async (u) => /hot\.json/.test(u)
    ? { ok: true, json: async () => redditListing([rawPost("fresh", 100, 1), rawPost("stale", 500, 200), rawPost("thin", 5, 1), rawPost("big", 900, 2)]) }
    : { ok: true, json: async () => redditListing([rawPost("fresh", 100, 1)]) }; // dup of fresh across subs
  const out = await discoverReddit({ subs: ["movies", "television"], minComments: 25, freshHours: 72, fetchImpl, nowMs: NOW });
  const ids = out.map((p) => p.id);
  assert.ok(ids.includes("fresh") && ids.includes("big"));
  assert.ok(!ids.includes("stale"), "stale dropped");
  assert.ok(!ids.includes("thin"), "low-comment dropped");
  assert.equal(new Set(ids).size, ids.length, "deduped");
  assert.equal(out[0].id, "big", "sorted by comments desc");
});
await check("discoverReddit returns [] on non-200 (fail-closed)", async () => {
  assert.deepEqual(await discoverReddit({ subs: ["movies"], fetchImpl: async () => ({ ok: false }), nowMs: NOW }), []);
});
await check("redditSearchPosts returns matching posts sorted, freshness-filtered", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => redditListing([rawPost("a", 40, 1), rawPost("b", 90, 2), rawPost("old", 200, 24 * 40)]) });
  const out = await redditSearchPosts("The Sable Coast", { sinceDays: 14, fetchImpl, nowMs: NOW });
  assert.deepEqual(out.map((p) => p.id), ["b", "a"], "sorted by comments, stale dropped");
});
await check("redditTopComments filters deleted/removed/too-long/link, sorts by score", async () => {
  const c = (body, score) => ({ body, score, author: "u" });
  const listing = redditCommentsListing([
    c("This ending was incredible", 10),
    c("[deleted]", 99), c("[removed]", 99),
    c("short", 50),                              // < 12 chars
    c("https://only-a-link.example/path", 80),   // link-only
    c("x".repeat(400), 70),                       // too long
    c("A genuinely good and quotable comment here", 25),
  ]);
  const out = await redditTopComments("https://www.reddit.com/r/movies/comments/p/", { fetchImpl: async () => ({ ok: true, json: async () => listing }) });
  assert.equal(out.length, 2, "only 2 valid comments");
  assert.equal(out[0].score, 25, "sorted by score desc");
});
await check("redditTopComments returns [] for no permalink", async () => {
  assert.deepEqual(await redditTopComments(null, {}), []);
});

// ── discover.mjs (postMatchesWork phrase/token match + shaping + heat sort) ───────────────────────
console.log("— discover.mjs —");
{
  const discoverTMDBImpl = async () => fakeTMDBItems();
  const discoverRedditImpl = async () => fakeRedditDiscover();
  await check("discoverStories shapes work + person + orphan, sorts by heat", async () => {
    const stories = await discoverStories({ discoverTMDBImpl, discoverRedditImpl, nowMs: NOW });
    assert.ok(stories.length >= 3, "multiple stories");
    const work = stories.find((s) => s.primaryEntity === "The Sable Coast");
    assert.ok(work && work.kind === "work" && work.category === "movies", "sable coast work story");
    assert.ok(work.redditPosts.length >= 1, "matched reddit posts attached");
    assert.equal(work.work.title, "The Sable Coast");
    assert.ok(stories.some((s) => s.kind === "person" && s.primaryEntity === "Nora Idris"), "person story");
    assert.ok(stories.some((s) => s.kind === "discourse"), "orphan discourse story");
    for (let i = 1; i < stories.length; i++) assert.ok(stories[i - 1].discourseHeat >= stories[i].discourseHeat, "heat desc");
  });
  await check("postMatchesWork drops a low-pop work with no matching discourse", async () => {
    const stories = await discoverStories({ discoverTMDBImpl, discoverRedditImpl, nowMs: NOW });
    assert.ok(!stories.some((s) => s.primaryEntity === "Quiet Nobody Cares"));
  });
  await check("discoverStories respects max", async () => {
    assert.equal((await discoverStories({ discoverTMDBImpl, discoverRedditImpl, max: 1, nowMs: NOW })).length, 1);
  });
}

// ── trigger.mjs ────────────────────────────────────────────────────────────────────────────────────
console.log("— trigger.mjs —");
await check("loadTriggers maps story→trigger fields (injected discoverImpl)", async () => {
  const discoverImpl = async () => [{
    storySlug: "the-sable-coast-2026", kind: "work", primaryEntity: "The Sable Coast",
    work: { title: "The Sable Coast", type: "movie", year: "2026" }, category: "movies",
    redditPosts: [fakeRedditPost()], sources: [{ url: "https://a.example/1", outlet: null }],
    discourseHeat: 1740, signals: { comments: 1940 }, via: "tmdb+reddit", overview: "ov",
  }];
  const [t] = await loadTriggers({ discoverImpl, nowMs: NOW });
  assert.equal(t.parentEventSlug, "the-sable-coast-2026");
  assert.equal(t.parentSlug, null);
  assert.equal(t.eventType, "discourse");
  assert.equal(t.status, "CONFIRMED");
  assert.equal(t.category, "movies");
  assert.equal(t.priority, 1740);
  assert.equal(t.subjectKind, "title");
  assert.equal(t.outletCount, 1);
  assert.equal(t.tmdbType, "movie");
  assert.deepEqual(t.work, { title: "The Sable Coast", type: "movie", year: "2026" });
  assert.ok(Array.isArray(t.redditPosts) && t.redditPosts.length === 1);
});

// ── reactionFinder: norm / quoteIsVerbatim / meetsFloor / fallbackQueries ─────────────────────────
console.log("— reactionFinder norm / quoteIsVerbatim —");
await check("norm strips quote-marks/apostrophes, unifies dashes, whitespace, case", () => {
  assert.equal(norm("“The  Sable — Coast’s\tending”"), "the sable - coasts ending");
});
await check("verbatim quote passes the wall", () => assert.equal(quoteIsVerbatim(Q.director, [{ text: SRC_A }]), true));
await check("curly + whitespace variant of a real quote passes", () => {
  const variant = "The people arguing about the final scene are exactly the audience I hoped\nto reach".replace(/o/, "o");
  assert.equal(quoteIsVerbatim(variant, [{ text: SRC_A }]), true);
});
await check("paraphrase FAILS the wall", () => assert.equal(quoteIsVerbatim("I wanted the finale open-ended and I have no regrets", [{ text: SRC_A }]), false));
await check("merged two quotes FAILS", () => assert.equal(quoteIsVerbatim(Q.director + " " + Q.lead, [{ text: SRC_A }]), false));
await check("sub-8-char quote FAILS", () => assert.equal(quoteIsVerbatim("I al", [{ text: SRC_A }]), false));

console.log("— reactionFinder meetsFloor —");
await check("audience-reaction PASSES with 3 anchors, FAILS with 2", () => {
  assert.equal(meetsFloor("audience-reaction", { namedVoices: 0, fanPosts: 3 }).ok, true);
  assert.equal(meetsFloor("audience-reaction", { namedVoices: 1, fanPosts: 1 }).ok, false);
});
await check("the-debate PASSES with 3 anchors (named+fan mix)", () => {
  assert.equal(meetsFloor("the-debate", { namedVoices: 1, fanPosts: 2 }).ok, true);
});
await check("breakout-buzz FAILS under 3 anchors", () => {
  assert.equal(meetsFloor("breakout-buzz", { namedVoices: 1, fanPosts: 1 }).ok, false);
});
await check("creator-answers-critics needs >=1 named creator quote AND minAnchors", () => {
  assert.equal(meetsFloor("creator-answers-critics", { namedVoices: 0, fanPosts: 3 }).ok, false, "no named creator");
  assert.equal(meetsFloor("creator-answers-critics", { namedVoices: 1, fanPosts: 1 }).ok, true, "1 named + 2 anchors");
  assert.equal(meetsFloor("creator-answers-critics", { namedVoices: 1, fanPosts: 0 }).ok, false, "only 1 anchor");
});
await check("fallbackQueries returns per-form plain queries", () => {
  const qs = fallbackQueries(fakeTrigger(), fakeAngle("creator-answers-critics"));
  assert.ok(qs.some((q) => /responds criticism|addresses backlash/.test(q)));
});

// ── config routeForStory ──────────────────────────────────────────────────────────────────────────
console.log("— config routeForStory —");
await check("routeForStory maps categories correctly", () => {
  assert.deepEqual(routeForStory({ category: "awards" }), { category: "awards", subcategory: "winners" });
  assert.deepEqual(routeForStory({ category: "streaming" }), { category: "streaming", subcategory: "where-to-watch" });
  assert.deepEqual(routeForStory({ category: "movies" }), { category: "movies", subcategory: "news" });
  assert.deepEqual(routeForStory({ category: "tv" }), { category: "tv", subcategory: "news" });
  assert.deepEqual(routeForStory({ category: "celebrity" }), { category: "celebrity", subcategory: "news" });
  assert.deepEqual(routeForStory({ category: "music" }), { category: "music", subcategory: "news" });
  assert.deepEqual(routeForStory({ category: "unknown-x" }), { category: "celebrity", subcategory: "news" });
});

// ── store lifecycle (park 3→dead, dedup) ──────────────────────────────────────────────────────────
console.log("— store lifecycle —");
await check("insideKey composes event|form", () => assert.equal(insideKey("ev", "audience-reaction"), "ev|audience-reaction"));
await check("park 3 times → dead (Infinity)", () => {
  const store = loadStore(tmp("inside-store") + "/store.json");
  parkAngle(store, "ev", "the-debate", "under floor");
  parkAngle(store, "ev", "the-debate", "under floor");
  assert.notEqual(parkedTries(store, "ev", "the-debate"), Infinity);
  parkAngle(store, "ev", "the-debate", "under floor");
  assert.equal(parkedTries(store, "ev", "the-debate"), Infinity, "3rd park → dead");
});
await check("record + alreadyPublished dedup; clearParked", () => {
  const store = loadStore(tmp("inside-store2") + "/store.json");
  assert.equal(alreadyPublished(store, "ev", "audience-reaction"), false);
  recordInsidePublished(store, { parentEventSlug: "ev", form: "audience-reaction", slug: "s", title: "t" });
  assert.equal(alreadyPublished(store, "ev", "audience-reaction"), true);
  parkAngle(store, "ev", "breakout-buzz", "under floor");
  clearParked(store, "ev", "breakout-buzz");
  assert.equal(parkedTries(store, "ev", "breakout-buzz"), 0);
});

// ── gate deterministicInside ──────────────────────────────────────────────────────────────────────
console.log("— gate deterministicInside —");
const det = (article, form, fb) => deterministicInside(article, fb, fakeAngle(form));

await check("clean fixture article has NO hard blocks", () => {
  const fb = fakeFactBlock("audience-reaction");
  const r = det(fakeArticle({ form: "audience-reaction", factBlock: fb }), "audience-reaction", fb);
  assert.deepEqual(r.hardBlocks, [], "clean: " + r.hardBlocks.join(" | "));
});
await check("invented speaker in reactionsRender blocked", () => {
  const fb = fakeFactBlock("creator-answers-critics");
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  art.reactionsRender.push({ speaker: "Ghost Nobody", connection: "", platform: "X", date: "", quote: Q.director, tweetId: "" });
  assert.ok(det(art, "creator-answers-critics", fb).hardBlocks.some((b) => /invented-speaker/.test(b)));
});
await check("misattributed named quote blocked", () => {
  const fb = fakeFactBlock("creator-answers-critics");
  const art = fakeArticle({ form: "creator-answers-critics", factBlock: fb });
  art.reactionsRender = [{ speaker: "Priya Anand", connection: "director", platform: "interview", date: "", quote: Q.fanHate, tweetId: "" }];
  assert.ok(det(art, "creator-answers-critics", fb).hardBlocks.some((b) => /misattributed-or-unverbatim/.test(b)));
});
await check("unverbatim prose quote in body blocked", () => {
  const fb = fakeFactBlock("audience-reaction");
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.body += `\n\nAnother viewer declared, "this film changed my entire life forever and always."`;
  assert.ok(det(art, "audience-reaction", fb).hardBlocks.some((b) => /unverbatim-prose-quote/.test(b)));
});
await check("unknown-attribution ('<Name> said') blocked", () => {
  const fb = fakeFactBlock("audience-reaction");
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.body += `\n\nMarcus Webb said the reaction proved his point about the ending.`;
  assert.ok(det(art, "audience-reaction", fb).hardBlocks.some((b) => /unknown-attribution/.test(b)));
});
await check("audience handle in prose blocked", () => {
  const fb = fakeFactBlock("audience-reaction");
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.body += `\n\nAs @sablefan99 put it, the ending was perfect.`;
  assert.ok(det(art, "audience-reaction", fb).hardBlocks.some((b) => /audience-handle-in-prose/.test(b)));
});
await check("divided-claim-without-both-sides blocked", () => {
  const fb = fakeFactBlock("audience-reaction");
  fb.aggregateFans = fb.aggregateFans.filter((r) => r.stance !== "negative");
  fb.stats.hasNegative = false; fb.stats.divided = false;
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.title = "The Sable Coast Fans Are Divided";
  assert.ok(det(art, "audience-reaction", fb).hardBlocks.some((b) => /divided-claim-without-both-sides/.test(b)));
});
await check("quote-ratio > 35% blocked", () => {
  const fb = fakeFactBlock("audience-reaction");
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.body = `Intro. "${Q.fanLove}" "${Q.fanHate}" "${Q.fanSplit}"`;
  assert.ok(det(art, "audience-reaction", fb).hardBlocks.some((b) => /quote-ratio/.test(b)));
});
await check("word floor enforced", () => {
  const fb = fakeFactBlock("audience-reaction");
  const art = fakeArticle({ form: "audience-reaction", factBlock: fb });
  art.body = "Too short.";
  assert.ok(det(art, "audience-reaction", fb).hardBlocks.some((b) => /words \d+ </.test(b)));
});
await check("classifyInsideBlocks splits soft-floor (fixable) from hard", () => {
  const { block, fixable } = classifyInsideBlocks(["soft-floor engagement 4 < 5", "invented-speaker: x"]);
  assert.deepEqual(fixable, ["soft-floor engagement 4 < 5"]);
  assert.deepEqual(block, ["invented-speaker: x"]);
});

// ── assemble contract ─────────────────────────────────────────────────────────────────────────────
console.log("— assemble contract —");
const mkFM = (form, image = fakeImage(), trigger = fakeTrigger()) =>
  buildInsideMarkdown({ article: fakeArticle({ form, trigger }), trigger, angle: fakeAngle(form), factBlock: fakeFactBlock(form), image, dateISO: new Date(NOW).toISOString() }).frontmatter;

await check("formatTag inside, insideForm, unique eventSlug --in-<form>", () => {
  const fm = mkFM("audience-reaction");
  assert.equal(fm.formatTag, "inside");
  assert.equal(fm.insideForm, "audience-reaction");
  assert.equal(fm.eventSlug, "the-sable-coast-2026--in-audience-reaction");
  assert.equal(fm.category, "movies");
  assert.equal(fm.subcategory, "news");
  assert.equal(fm.eventType, "discourse");
});
await check("sibling forms get DISTINCT eventSlugs", () => {
  assert.notEqual(mkFM("audience-reaction").eventSlug, mkFM("the-debate").eventSlug);
});
await check("no undefined/null/empty keys in frontmatter (gray-matter safe)", () => {
  for (const [k, v] of Object.entries(mkFM("audience-reaction"))) assert.ok(v !== undefined && v !== null && v !== "", `key ${k} is empty`);
});
await check("image block ONLY when image given", () => {
  assert.ok(mkFM("audience-reaction", fakeImage()).image, "image present when given");
  assert.equal(mkFM("audience-reaction", null).image, undefined, "no image key when null");
});
await check("reactions default speaker 'A viewer' for fan cards", () => {
  const fm = mkFM("audience-reaction");
  assert.ok(fm.reactions.length > 0);
  assert.ok(fm.reactions.every((r) => r.speaker && r.speaker.length), "no empty speaker");
  assert.ok(fm.reactions.some((r) => r.speaker === "A viewer"), "fan cards → 'A viewer'");
});
await check("fanConsensus present", () => assert.ok(mkFM("audience-reaction").fanConsensus.length > 5));

console.log(`\n=== UNIT: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log("FAILED: " + fails.join(", ")); process.exit(1); }
