// OFFLINE DETERMINISTIC SUITE for the box-office lane (plan §16). ALL impls injected — no network,
// no keys. Run from the site/ dir:  node pipeline/boxoffice/test/boxoffice.test.mjs
// Covers: number-fidelity + no-invention walls, scope guard, platform guard, forms/floors, caps,
// PAUSED kill switch, review-dir routing, cross-run dedup, and the assemble frontmatter shape.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { normMoney, moneyBucket, extractFigures, buildAllowed, numberFidelity, noInvention, platformGuard } from "../moneyGuard.mjs";
import { scopeOk, FORMS, DATA_DIR } from "../config.bo.mjs";
import { fidelityLocks, review as qaReview, classifyBlocks, findTemplateHeadings, hedgeCuts, dropSpin, speculationCuts, trendCuts } from "../agents/qa.mjs";
import { castTrustworthy } from "../boxofficeData.mjs";
import { buildBoxOfficeMarkdown, seoFinish } from "../assemble.mjs";
import { boRun } from "../borun.mjs";
import { boKey, alreadyPublished, coveredEventSlugs } from "../store.mjs";
import { run as gatherRun } from "../agents/gatherer.mjs";
import { isMaterial, updateEventSuffix, recordArticle, currentNumberRaw, priorArticles, linkPriorCoverage, streamingExits, trackKey, isPastOpening } from "../tracker.mjs";
import { parseNetflixTsv, netflixBlock, fmtHours } from "../netflix.mjs";
import { findFilms } from "../agents/finder.mjs";
import { createRequire } from "node:module";
const matter = createRequire(import.meta.url)("gray-matter");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name}\n     ${e.message}`); fail++; } };
const ta = async (name, fn) => { try { await fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name}\n     ${e.message}`); fail++; } };

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────
const filler = (n) => Array.from({ length: n }, (_, i) => `The studio celebrated a strong result and analysts weighed in on what it means for the season number ${i}.`).join(" ");
const goodBody = `Wicked stormed the box office this weekend. The Jon M. Chu musical opened to $45.2 million across 4,337 theaters, a per-theater average that studios love to see. The hold was strong, slipping just 48% in its second frame. ${filler(24)} Against a worldwide total of $1.45 billion and a production budget of $145 million, the picture is a clear win.`;
const goodArticle = {
  title: "Wicked Box Office: Cynthia Erivo Musical Opens to $45.2 Million",
  metaTitle: "Wicked Box Office: $45.2M Opening for Cynthia Erivo Musical",
  dek: "The Jon M. Chu musical posted a strong opening weekend.",
  metaDescription: "Wicked opened to $45.2 million across 4,337 theaters, a strong start against its $145 million budget.",
  body: goodBody,
  keyTakeaways: ["Opened to $45.2 million", "Held with a 48% drop", "Budget was $145 million"],
  faq: [{ q: "How much did Wicked make opening weekend?", a: "Wicked opened to $45.2 million domestically across 4,337 theaters, a strong debut for the Universal musical adaptation this holiday frame." },
        { q: "What was Wicked's budget?", a: "The production budget was $145 million before global marketing costs, a figure the studio expects to recoup given the strong opening and holiday runway ahead." }],
  tags: ["wicked", "box office", "cynthia erivo"],
  imageQuery: "Wicked movie Cynthia Erivo",
  about: [{ name: "Wicked", type: "Movie" }],
};
const gathered = {
  openingWeekend: "$45.2 million", domestic: null, international: null, worldwide: null, cume: null,
  dropPct: "48%", theaters: "4,337", perTheater: null,
  numbers: ["$45.2 million", "48%", "4,337"], records: [], cast: ["Cynthia Erivo", "Ariana Grande"],
  narrative: "A strong hold in its second weekend.", hasSplit: false, outletCount: 2,
  sources: [{ owner: "variety", tier: "major", url: "https://variety.com/x" }],
};
const boxData = { title: "Wicked", year: "2024", worldwide: "$1.45 billion", worldwideRaw: 1450000000, budget: "$145 million", budgetRaw: 145000000, releaseDate: "2024-11-22", providers: { stream: [], rent: [], buy: [] }, whereToWatch: [], cast: ["Cynthia Erivo"], moneyStrings: ["$1.45 billion", "$145 million"] };
const baseJob = () => ({ film: { title: "Wicked", originalLanguage: "en", overview: "A musical.", tmdbId: 1, via: "now_playing" }, trigger: { eventSlug: "wicked-bo-opening", title: "Wicked", category: "movies", subcategory: "box-office", priority: 80, signals: { recency: 5 }, eventType: "boxoffice", sources: gathered.sources }, angle: { form: "BO-OPENING", star: "Cynthia Erivo", queries: ["Wicked box office"], workingTitle: "Wicked box office" }, gathered, boxData, article: JSON.parse(JSON.stringify(goodArticle)) });

// ── 1. money normalization + extraction ──────────────────────────────────────────────────────────
console.log("moneyGuard — normalization + extraction");
t("normMoney handles $/magnitude variants equivalently", () => {
  assert.equal(normMoney("$162M"), 162000000);
  assert.equal(normMoney("$162 million"), 162000000);
  assert.equal(normMoney("$1.45 billion"), 1450000000);
  assert.equal(normMoney("$636.8 million"), 636800000);
  assert.equal(normMoney("$50,000"), 50000);
});
t("normMoney rejects a bare number (no $ / no magnitude)", () => {
  assert.equal(normMoney("4337"), null);
  assert.equal(normMoney("2026"), null);
});
t("moneyBucket collapses rounding-equivalent figures", () => {
  assert.equal(moneyBucket(normMoney("$162M")), moneyBucket(normMoney("$162 million")));
});
t("extractFigures pulls money/pct/theater-count, ignores years & ordinals", () => {
  const figs = extractFigures("It opened to $45.2 million in 4,337 theaters, down 48%, its No. 1 debut in 2024.");
  const kinds = figs.map((f) => f.kind).sort();
  assert.deepEqual(kinds, ["count", "money", "pct"]);
  assert.ok(!figs.some((f) => f.raw.includes("2024")), "year must not be extracted");
});

// ── 2. number-fidelity wall ──────────────────────────────────────────────────────────────────────
console.log("moneyGuard — number-fidelity wall");
t("supported figures pass the wall", () => {
  const allowed = buildAllowed({ numbers: gathered.numbers, moneyStrings: boxData.moneyStrings, pcts: ["48%"], counts: ["4,337"] });
  const r = numberFidelity(goodArticle, allowed);
  assert.equal(r.ok, true, JSON.stringify(r.unsupported));
});
t("an invented figure is flagged + cut", () => {
  const allowed = buildAllowed({ numbers: gathered.numbers, moneyStrings: boxData.moneyStrings, pcts: ["48%"], counts: ["4,337"] });
  const bad = { ...goodArticle, body: goodArticle.body + " It also grossed a staggering $999 million overseas." };
  const r = numberFidelity(bad, allowed);
  assert.equal(r.ok, false);
  assert.ok(r.cutClaims.some((c) => c.includes("$999 million")));
});

// ── 3. no-invention wall ─────────────────────────────────────────────────────────────────────────
console.log("moneyGuard — no-invention wall");
t("an invented record claim is flagged when source stated none", () => {
  const bad = { body: "The film set an all-time record for the studio this weekend." };
  const r = noInvention(bad, { hasSplitNumber: false, hasRecord: false });
  assert.equal(r.ok, false);
  assert.ok(r.blocks.some((b) => b.kind === "invented-record"));
});
t("a record claim passes when the source stated a record", () => {
  const ok = { body: "The film set an all-time record for the studio this weekend." };
  assert.equal(noInvention(ok, { hasRecord: true }).ok, true);
});
t("an invented domestic/international split is flagged", () => {
  const bad = { body: "It earned $50 million domestically and $40 million internationally." };
  const r = noInvention(bad, { hasSplitNumber: false });
  assert.ok(r.blocks.some((b) => b.kind === "invented-split"));
});
t("a worldwide TOTAL mentioning 'overseas' is NOT flagged as an invented split", () => {
  const r = noInvention({ body: "Overseas, the film pushed its worldwide total to $1.45 billion, a milestone." }, { hasSplitNumber: false, hasRecord: true });
  assert.ok(!r.blocks.some((b) => b.kind === "invented-split"), JSON.stringify(r.blocks));
});

// ── 4. platform guard ────────────────────────────────────────────────────────────────────────────
console.log("moneyGuard — platform guard (NOW-STREAMING)");
t("a wrong platform is flagged", () => {
  const r = platformGuard({ body: "Wicked is now streaming on Netflix." }, ["Max"]);
  assert.equal(r.ok, false); assert.deepEqual(r.bad, ["netflix"]);
});
t("the confirmed platform passes", () => {
  assert.equal(platformGuard({ body: "Wicked is now streaming on Max." }, ["Max"]).ok, true);
});

// ── 5. scope guard ───────────────────────────────────────────────────────────────────────────────
console.log("config — scope guard (Hollywood / English only)");
t("English-language film is in scope", () => assert.equal(scopeOk({ originalLanguage: "en", title: "Wicked" }), true));
t("non-English film is out of scope", () => assert.equal(scopeOk({ originalLanguage: "hi", title: "Some Film" }), false));
t("Bollywood junk language is out of scope", () => assert.equal(scopeOk({ originalLanguage: "en", title: "Bollywood Blockbuster", overview: "A ₹200 crore hit" }), false));

// ── 6. forms / floors ────────────────────────────────────────────────────────────────────────────
console.log("config — forms + floors");
t("the step-1 forms exist with routing", () => {
  for (const k of ["BO-OPENING", "BO-UPDATE", "NOW-STREAMING"]) assert.ok(FORMS[k], `${k} missing`);
  assert.equal(FORMS["BO-OPENING"].category, "movies");
  assert.equal(FORMS["BO-OPENING"].subcategory, "box-office");
  assert.equal(FORMS["NOW-STREAMING"].category, "streaming");
});

// ── 6b. gatherer form floors (fail-closed) ─────────────────────────────────────────────────────────
console.log("gatherer — form floors (fail-closed)");
const gFind = (text) => async () => ({ sources: [{ url: "https://variety.com/x", owner: "variety", tier: "major", text }] });
const gData = (over = {}) => async () => ({ data: { openingWeekend: null, domestic: null, international: null, worldwide: null, cume: null, dropPct: null, theaters: null, perTheater: null, otherNumbers: [], records: [], cast: [], narrative: "n", hasDomesticInternationalSplit: false, ...over }, usage: { prompt_tokens: 10, completion_tokens: 10 } });
await ta("BO-UPDATE with no reported number fails the needsNewNumber floor", async () => {
  const job = { film: { title: "Wicked" }, angle: { form: "BO-UPDATE", queries: ["Wicked box office"] }, trigger: { sources: [] }, boxData: {} };
  await gatherRun(job, { findImpl: gFind("Wicked had a good weekend, analysts said."), chatImpl: gData() });
  assert.ok(/under floor: no new box-office number/.test(job.gatherFail || ""), job.gatherFail);
});
await ta("NOW-STREAMING with no TMDB-confirmed platform fails the needsPlatform floor", async () => {
  const job = { film: { title: "Wicked" }, angle: { form: "NOW-STREAMING", queries: ["Wicked streaming"] }, trigger: { sources: [] }, boxData: { providers: { stream: [], rent: [], buy: [] } } };
  await gatherRun(job, { findImpl: gFind("Wicked heads to streaming soon."), chatImpl: gData({ openingWeekend: "$45.2 million" }) });
  assert.ok(/no TMDB-confirmed streaming platform/.test(job.gatherFail || ""), job.gatherFail);
});
await ta("NOW-STREAMING WITH a confirmed platform passes the floor", async () => {
  const job = { film: { title: "Wicked" }, angle: { form: "NOW-STREAMING", queries: ["Wicked streaming"] }, trigger: { sources: [] }, boxData: { providers: { stream: ["Max"], rent: [], buy: [] } } };
  await gatherRun(job, { findImpl: gFind("Wicked is now on Max."), chatImpl: gData({ openingWeekend: "$45.2 million" }) });
  assert.ok(!job.gatherFail, job.gatherFail);
});

// ── 7. QA fidelity locks (deterministic) ─────────────────────────────────────────────────────────
console.log("qa — deterministic fidelity locks");
t("a clean job produces zero hard blocks + zero cuts", () => {
  const det = fidelityLocks(baseJob());
  assert.deepEqual(det.hardBlocks, []);
  assert.deepEqual(det.cutClaims, []);
});
t("a non-English film hard-blocks on scope", () => {
  const job = baseJob(); job.film.originalLanguage = "ko";
  assert.ok(fidelityLocks(job).hardBlocks.some((b) => /^scope/.test(b)));
});
t("an unsupported figure becomes a cut claim", () => {
  const job = baseJob(); job.article.body += " Overseas it added $777 million more.";
  const det = fidelityLocks(job);
  assert.ok(det.cutClaims.some((c) => c.includes("$777 million")));
});
t("an unsupported figure in the dek is stripped (repaired), never a dead-hold cutClaim", () => {
  const job = baseJob();
  job.article.dek = "It somehow grossed $888 million on opening day.";
  const det = fidelityLocks(job);
  assert.ok(!det.cutClaims.some((c) => c.includes("$888 million")), "dek figure must not become an unclearable cutClaim");
  assert.ok(!(job.article.dek || "").includes("$888 million"), "unsupported dek figure must be stripped from the dek");
});
t("a short article hard-blocks on the word floor", () => {
  const job = baseJob(); job.article.body = "Wicked opened to $45.2 million.";
  assert.ok(fidelityLocks(job).hardBlocks.some((b) => /^words /.test(b)));
});
t("fewer than 2 FAQs hard-blocks", () => {
  const job = baseJob(); job.article.faq = [{ q: "one?", a: "just one" }];
  assert.ok(fidelityLocks(job).hardBlocks.some((b) => /^seo-faq/.test(b)));
});
t("a generic meta heading is detected", () => {
  assert.equal(findTemplateHeadings("## Why is this happening now?").length, 1);
  assert.equal(findTemplateHeadings("## Wicked's second-weekend hold").length, 0);
});
t(">4 unsupported figures = draft-level failure (not salvageable by cutting)", () => {
  const job = baseJob();
  job.article.body += " Extra $11 million. Extra $22 million. Extra $33 million. Extra $44 million. Extra $55 million.";
  assert.ok(fidelityLocks(job).hardBlocks.some((b) => /draft-level failure/.test(b)));
});
t("classifyBlocks splits fixable soft floors from hard stops", () => {
  const { block, fixable } = classifyBlocks(["scope: bad", "soft-floor engagement 4 < 5", "seo-faq: too few"]);
  assert.deepEqual(block, ["scope: bad"]);
  assert.equal(fixable.length, 2);
});

// ── 8. QA review with injected judge ─────────────────────────────────────────────────────────────
console.log("qa — review() with injected judge");
const judge = (score, subs) => async () => ({ data: { score, subscores: subs, strengths: [], weaknesses: [] }, usage: { prompt_tokens: 10, completion_tokens: 10 } });
const highSubs = { readability: 8, engagement: 8, humanVoice: 8, curiosity: 8, structure: 8, infoGain: 8, seo: 8, faqQuality: 8, completeness: 8, accuracy: 9 };
await ta("a clean high-scoring article passes", async () => {
  const job = baseJob();
  await qaReview(job, { chatImpl: judge(86, highSubs) });
  assert.equal(job.qa.pass, true, JSON.stringify(job.qa.hardBlocks));
  assert.equal(job.qa.score, 86);
});
await ta("a low engagement subscore adds a soft-floor block (held)", async () => {
  const job = baseJob();
  await qaReview(job, { chatImpl: judge(75, { ...highSubs, engagement: 3 }) });
  assert.equal(job.qa.pass, false);
  assert.ok(job.qa.hardBlocks.some((b) => /soft-floor engagement/.test(b)));
});
await ta("an unsupported figure holds even with a high score (cutClaims non-empty)", async () => {
  const job = baseJob(); job.article.body += " It grossed $888 million on Tuesday alone.";
  await qaReview(job, { chatImpl: judge(90, highSubs) });
  assert.equal(job.qa.pass, false);
  assert.ok(job.qa.cutClaims.length > 0);
});

// ── 8a. netflix — Top 10 TSV parse (first-hand hours) ──────────────────────────────────────────────
console.log("netflix — Top 10 TSV parse");
const NF_TSV = [
  "week\tcategory\tweekly_rank\tshow_title\tseason_title\tweekly_hours_viewed\truntime\tweekly_views\tcumulative_weeks_in_top_10",
  "2026-06-21\tFilms (English)\t1\tOld Film\tN/A\t9000000\t1:40\t5400000\t2",
  "2026-06-28\tFilms (English)\t1\tThe Big One\tN/A\t21500000\t2:05\t10300000\t1",
  "2026-06-28\tFilms (English)\t2\tSecond Film\tN/A\t8000000\t1:50\t4300000\t3",
  "2026-06-28\tTV (English)\t1\tHit Series\tHit Series: Season 2\t45000000\t6:30\t7000000\t4",
  "2026-06-28\tFilms (Non-English)\t1\tOtro Film\tN/A\t30000000\t2:00\t15000000\t1",
].join("\n");
t("parseNetflixTsv returns the LATEST week's English Films + TV with real hours", () => {
  const r = parseNetflixTsv(NF_TSV);
  assert.equal(r.week, "2026-06-28");
  assert.equal(r.films[0].title, "The Big One");
  assert.equal(r.films[0].hoursRaw, 21500000);
  assert.equal(r.films[0].hours, "22 million hours");
  assert.equal(r.films.length, 2, "only latest-week English films");
  assert.equal(r.tv[0].title, "Hit Series");
  assert.equal(r.tv[0].hoursRaw, 45000000);
  assert.ok(!r.films.some((f) => f.title === "Old Film"), "prior week excluded");
});
t("netflixBlock renders only the real figures", () => {
  const b = netflixBlock({ title: "The Big One", rank: 1, hours: "22 million hours", views: 10300000, weeksInTop10: 1 }, { week: "2026-06-28" });
  assert.ok(b.includes("22 million hours"));
  assert.ok(b.includes("#1"));
});
t("fmtHours formats millions + raw", () => {
  assert.equal(fmtHours(45000000), "45 million hours");
  assert.equal(fmtHours(2500000), "2.5 million hours");
  assert.equal(fmtHours(null), null);
});

// ── 8b. tracker — serialization engine ───────────────────────────────────────────────────────────
console.log("tracker — serialization (ledger + materiality + link-chain + exits)");
const TT = fs.mkdtempSync(path.join(os.tmpdir(), "bo-tracker-"));
t("currentNumberRaw picks the biggest real dollar figure", () => {
  assert.equal(currentNumberRaw({ worldwide: "$1.45 billion", openingWeekend: "$45.2 million", numbers: ["$45.2 million"] }, { worldwide: "$1.45 billion" }), 1450000000);
  assert.equal(currentNumberRaw({}, {}), null);
});
t("isMaterial: a milestone crossing is material with a milestone tag", () => {
  const tracked = { films: { "1": { tmdbId: 1, title: "Wicked", lastNumberRaw: 90e6, lastMilestone: 75e6, articles: [] } } };
  const mat = isMaterial({ tmdbId: 1, title: "Wicked" }, { cume: "$105 million" }, {}, tracked);
  assert.equal(mat.material, true);
  assert.equal(mat.tag, "100m", mat.reason);
});
t("isMaterial: a same-or-LOWER number is NOT material — never re-report Day-15's numbers (owner's #1)", () => {
  const tracked = { films: { "1": { tmdbId: 1, title: "Wicked", lastNumberRaw: 108e6, lastMilestone: 100e6, articles: [] } } };
  assert.equal(isMaterial({ tmdbId: 1, title: "Wicked" }, { cume: "$108 million", dropPct: "40%" }, {}, tracked).material, false, "same number re-pulled = not a new story");
  assert.equal(isMaterial({ tmdbId: 1, title: "Wicked" }, { cume: "$104 million" }, {}, tracked).material, false, "a lower number = stale");
  assert.equal(isMaterial({ tmdbId: 1, title: "Wicked" }, { cume: "$130 million" }, {}, tracked).material, true, "a genuinely higher number IS the next day's story");
});
t("isMaterial: the first tracked number is material", () => {
  const mat = isMaterial({ tmdbId: 9, title: "New", releaseDate: "2026-07-01" }, { openingWeekend: "$20 million" }, {}, { films: {} }, { now: new Date("2026-07-11") });
  assert.equal(mat.material, true);
  assert.ok(mat.tag);
});
t("updateEventSuffix appends the material tag (keeps distinct updates distinct)", () => {
  assert.equal(updateEventSuffix({ tag: "100m" }), "-100m");
  assert.equal(updateEventSuffix({ tag: null }), "");
});
t("isPastOpening: a weekend drop or a running total above the opening means it is NOT a debut", () => {
  assert.equal(isPastOpening({ openingWeekend: "$160 million", dropPct: "56%" }), true);
  assert.equal(isPastOpening({ openingWeekend: "$45 million", cume: "$130 million" }), true);
  assert.equal(isPastOpening({ openingWeekend: "$54 million", domestic: "$84.5 million" }), true); // running total in the domestic field
  assert.equal(isPastOpening({ openingWeekend: "$45 million", domestic: "$45 million" }), false); // domestic == opening ⇒ still the debut
  assert.equal(isPastOpening({ openingWeekend: "$45 million" }), false);
  assert.equal(isPastOpening({}), false);
});
t("recordArticle creates then updates the film ledger", () => {
  const tracked = { films: {}, file: path.join(TT, "t.json") };
  recordArticle(tracked, { film: { tmdbId: 1, title: "Wicked", releaseDate: "2026-07-01" }, form: "BO-OPENING", slug: "wicked-opening", category: "movies", gathered: { openingWeekend: "$60 million" }, now: new Date("2026-07-05") });
  const rec = tracked.films[trackKey({ tmdbId: 1 })];
  assert.equal(rec.lastNumberRaw, 60000000);
  assert.equal(rec.articles.length, 1);
  recordArticle(tracked, { film: { tmdbId: 1, title: "Wicked", releaseDate: "2026-07-01" }, form: "BO-UPDATE", slug: "wicked-100m", category: "movies", gathered: { cume: "$105 million" }, now: new Date("2026-07-12") });
  const rec2 = tracked.films[trackKey({ tmdbId: 1 })];
  assert.equal(rec2.articles.length, 2);
  assert.equal(rec2.lastNumberRaw, 105000000);
  assert.equal(rec2.lastMilestone, 100000000);
});
t("linkPriorCoverage links our prior coverage of the same film", () => {
  const tracked = { films: { [trackKey({ tmdbId: 1 })]: { tmdbId: 1, title: "Wicked", articles: [{ slug: "wicked-opening", category: "movies", form: "BO-OPENING" }] } } };
  assert.equal(priorArticles(tracked, { tmdbId: 1, title: "Wicked" }).length, 1);
  const { body, linkedPrior } = linkPriorCoverage("This weekend, Wicked extended its strong run.", tracked, { tmdbId: 1, title: "Wicked" });
  assert.ok(body.includes("](/movies/wicked-opening/)"), body);
  assert.equal(linkedPrior, "wicked-opening");
});
await ta("streamingExits surfaces only a left-theaters film with a confirmed platform", async () => {
  const tracked = { films: {
    [trackKey({ tmdbId: 1 })]: { tmdbId: 1, title: "Gone", releaseDate: "2026-01-01", status: "in-theaters", articles: [] },
    [trackKey({ tmdbId: 2 })]: { tmdbId: 2, title: "StillIn", releaseDate: "2026-06-01", status: "in-theaters", articles: [] },
    [trackKey({ tmdbId: 3 })]: { tmdbId: 3, title: "NoPlatform", releaseDate: "2026-01-01", status: "in-theaters", articles: [] },
  } };
  const providersFor = async (rec) => (rec.tmdbId === 1 ? { stream: ["Max"], rent: [], buy: [] } : { stream: [], rent: [], buy: [] });
  const exits = await streamingExits(tracked, [2], { providersFor, max: 5 });
  const titles = exits.map((e) => e.title);
  assert.ok(titles.includes("Gone"), "left-theaters w/ platform surfaced");
  assert.ok(!titles.includes("StillIn"), "still in now_playing must not surface");
  assert.ok(!titles.includes("NoPlatform"), "no confirmed platform must not surface");
});
fs.rmSync(TT, { recursive: true, force: true });

// ── 8c. streaming — Netflix picks + streaming gather ───────────────────────────────────────────────
console.log("streaming — finder picks + gatherer branch");
await ta("finder builds NETFLIX-TOP10 + TRENDING-TV picks from Netflix data", async () => {
  const nf = { week: "2026-06-28", films: [{ title: "The Big One", rank: 1, hours: "22 million hours", hoursRaw: 22000000 }], tv: [{ title: "Hit Series", rank: 1, hours: "45 million hours", hoursRaw: 45000000 }] };
  const found = await findFilms({ limit: 5, discoverImpl: async () => [], netflixImpl: async () => nf, trackedImpl: { films: {} }, providersImpl: async () => null });
  const forms = found.map((e) => e.angle.form);
  assert.ok(forms.includes("NETFLIX-TOP10"), JSON.stringify(forms));
  assert.ok(forms.includes("TRENDING-TV"));
  const nfPick = found.find((e) => e.angle.form === "NETFLIX-TOP10");
  assert.equal(nfPick.film.netflix.hoursRaw, 22000000);
  assert.equal(nfPick.trigger.category, "streaming");
});
await ta("finder never assigns a streaming form to a theatrical film (LLM clamp)", async () => {
  const films = [{ id: 1, title: "Theatrical", year: "2026", releaseDate: "2026-07-01", popularity: 80, via: "now_playing", overview: "", originalLanguage: "en" }];
  const badJudge = async () => ({ data: { picks: [{ i: 0, form: "NETFLIX-TOP10", workingTitle: "x", queries: ["x"] }] } });
  const found = await findFilms({ limit: 3, discoverImpl: async () => films, chatImpl: badJudge, netflixImpl: async () => ({ films: [], tv: [] }), trackedImpl: { films: {} }, providersImpl: async () => null });
  assert.ok(!found.some((e) => e.film.tmdbId === 1 && e.angle.form === "NETFLIX-TOP10"), "a streaming form must not attach to a theatrical film");
});
await ta("gatherer streaming branch builds Netflix-grounded gathered + meets the hours floor", async () => {
  const job = { film: { title: "The Big One", netflix: { title: "The Big One", rank: 1, hours: "22 million hours", hoursRaw: 22000000, weeksInTop10: 1, week: "2026-06-28" } }, angle: { form: "NETFLIX-TOP10", queries: ["The Big One netflix"] }, trigger: { sources: [] } };
  await gatherRun(job, { findImpl: async () => ({ blocked: true }), chatImpl: async () => ({ data: {} }) });
  assert.ok(!job.gatherFail, job.gatherFail);
  assert.equal(job.gathered.hoursViewed, "22 million hours");
  assert.equal(job.gathered.netflixRank, 1);
  assert.equal(job.gathered.platform, "Netflix");
  assert.ok(job.gathered.numbers.includes("22 million hours"));
  assert.ok((job.gathered.records[0] || "").includes("Netflix"));
});
await ta("gatherer streaming: NETFLIX-TOP10 with no hours fails the floor", async () => {
  const job = { film: { title: "X", netflix: { title: "X", rank: 2 } }, angle: { form: "NETFLIX-TOP10", queries: ["x"] }, trigger: { sources: [] } };
  await gatherRun(job, { findImpl: async () => ({ blocked: true }), chatImpl: async () => ({ data: {} }) });
  assert.ok(/under floor: no Netflix hours/.test(job.gatherFail || ""), job.gatherFail);
});

// ── 9. assemble frontmatter shape ────────────────────────────────────────────────────────────────
console.log("assemble — frontmatter contract");
t("buildBoxOfficeMarkdown emits a contract-valid frontmatter", () => {
  const out = buildBoxOfficeMarkdown({ article: goodArticle, trigger: baseJob().trigger, angle: { form: "BO-OPENING" }, film: { title: "Wicked" }, gathered, boxData, image: { image: "https://x/y.jpg", imageWidth: 1600, imageHeight: 900, credit: "Variety", alt: "Wicked" }, dateISO: new Date().toISOString() });
  const fmParsed = matter(out.md);
  const d = fmParsed.data;
  assert.equal(d.category, "movies");
  assert.equal(d.subcategory, "box-office");
  assert.equal(d.author, "editorial-team");
  assert.equal(d.formatTag, "box-office");
  assert.equal(d.eventType, "boxoffice");
  assert.equal(d.storyStatus, "CONFIRMED");
  assert.ok(d.eventSlug, "eventSlug required");
  assert.ok(d.boxOffice && d.boxOffice.openingWeekend === "$45.2 million");
  assert.equal(d.boxOffice.worldwide, "$1.45 billion");
  assert.equal(d.boxOffice.budget, "$145 million");
  assert.ok(d.metaTitle.length <= 60, `metaTitle ${d.metaTitle.length}`);
  assert.ok(d.metaDescription.length <= 155, `metaDescription ${d.metaDescription.length}`);
  assert.ok(Array.isArray(d.faq) && d.faq.length >= 2);
  assert.equal(d.image, "https://x/y.jpg");
  assert.equal(d.imageWidth, 1600);
  // NEVER an undefined/null key (gray-matter would throw; also assert no null leaked)
  for (const [k, v] of Object.entries(d)) assert.ok(v !== undefined && v !== null, `key ${k} is null/undefined`);
});
t("seoFinish drops a dangling mid-clause tail from the metaDescription", () => {
  const long = "The Invite grossed $379k on seven screens for a $54k per-screen average, the highest of the weekend and one of the best of the year, as it";
  const out = seoFinish({ metaTitle: "The Invite Posts a Record Per-Screen Average This Weekend Big", metaDescription: long });
  assert.ok(!/\bas it$/i.test(out.metaDescription), `dangling tail: "${out.metaDescription}"`);
  assert.ok(out.metaDescription.length <= 155);
});
t("records[] built from gathered records only", () => {
  const out = buildBoxOfficeMarkdown({ article: goodArticle, trigger: baseJob().trigger, angle: { form: "BO-OPENING" }, film: { title: "Wicked" }, gathered: { ...gathered, records: ["Biggest musical opening ever"] }, boxData, image: null, dateISO: new Date().toISOString() });
  assert.ok(matter(out.md).data.records.some((r) => r.claim === "Biggest musical opening ever"));
});
t("assemble: a streaming form emits streaming frontmatter (no boxOffice, Netflix whereToWatch)", () => {
  const out = buildBoxOfficeMarkdown({
    article: { ...goodArticle, title: "The Big One Tops Netflix This Week", body: "This week, The Big One drew 22 million hours on Netflix. " + filler(20) },
    trigger: { eventSlug: "the-big-one-netflix-top10", priority: 92, signals: { recency: 5 }, category: "streaming", subcategory: "best-of-streaming", sources: [] },
    angle: { form: "NETFLIX-TOP10" }, film: { title: "The Big One" },
    gathered: { records: ["#1 on Netflix's Top 10 this week"], hoursViewed: "22 million hours", netflixRank: 1, platform: "Netflix", outletCount: 0 },
    boxData: {}, image: { image: "https://x/y.jpg", imageWidth: 1600, imageHeight: 900, credit: "Netflix", alt: "The Big One" }, dateISO: new Date().toISOString(),
  });
  const d = matter(out.md).data;
  assert.equal(d.category, "streaming");
  assert.equal(d.formatTag, "streaming");
  assert.ok(!d.boxOffice, "a streaming piece must carry no boxOffice{}");
  assert.ok(d.whereToWatch && d.whereToWatch[0].platform === "Netflix", JSON.stringify(d.whereToWatch));
  for (const [k, v] of Object.entries(d)) assert.ok(v !== undefined && v !== null, `key ${k} is null/undefined`);
});
t("assemble normalizes redundant provider tiers (Netflix, Netflix Standard → Netflix)", () => {
  const out = buildBoxOfficeMarkdown({
    article: { ...goodArticle, title: "X Tops Netflix", body: "This week, X drew hours. " + filler(20) },
    trigger: { eventSlug: "x-netflix-top10", priority: 90, signals: { recency: 5 }, category: "streaming", subcategory: "best-of-streaming", sources: [] },
    angle: { form: "NETFLIX-TOP10" }, film: { title: "X" },
    gathered: { records: [], hoursViewed: "10 million hours", platform: "Netflix", outletCount: 0 },
    boxData: { whereToWatch: [{ title: "X", platform: "Netflix, Netflix Standard with Ads", type: "Stream" }] },
    image: { image: "https://x/y.jpg", imageWidth: 1600, imageHeight: 900, credit: "Netflix", alt: "X" }, dateISO: new Date().toISOString(),
  });
  assert.equal(matter(out.md).data.whereToWatch[0].platform, "Netflix", JSON.stringify(matter(out.md).data.whereToWatch));
});

// ── 10. orchestrator — caps, kill switch, dedup, review routing, full flow ─────────────────────────
console.log("borun — orchestration guards + flow");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bo-test-"));
const memStore = (over = {}) => ({ published: [], parked: [], file: path.join(TMP, "store.json"), ...over });
const oneFound = () => ([{ film: baseJob().film, trigger: baseJob().trigger, angle: baseJob().angle }]);
const stubs = (captured) => ({
  findImpl: async () => oneFound(),
  dataImpl: async (job) => { job.boxData = boxData; return job; },
  gatherImpl: async (job) => { job.gathered = gathered; job.trigger.sources = gathered.sources; job.bundle = { sources: gathered.sources }; return job; },
  synthImpl: async (job) => { job.brief = { hook: "h", whyStory: "w", mustInclude: [], seoKeyword: "wicked box office", suggestedTitle: "Wicked" }; return job; },
  writeArticleImpl: async (job) => { job.article = JSON.parse(JSON.stringify(goodArticle)); return job; },
  qaReviewImpl: async (job) => { job.qa = { score: 88, pass: true, hardBlocks: [], cutClaims: [], subscores: highSubs, weaknesses: [] }; return job; },
  imageImpl: async (job) => { job.image = { image: "https://x/y.jpg", imageWidth: 1600, imageHeight: 900, credit: "Variety", alt: "Wicked" }; return job; },
  addLinksImpl: (a) => ({ body: a.body, linked: [] }),
  publishImpl: (args) => { captured.push(args); return { slug: "wicked-box-office", path: (args.dir || "CONTENT") + "/wicked-box-office.md", written: false }; },
});

await ta("PAUSED kill switch short-circuits the run", async () => {
  const P = path.join(DATA_DIR, "PAUSED");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(P, "");
  try {
    const cap = [];
    const r = await boRun({ ...stubs(cap), storeImpl: memStore(), dryRun: true });
    assert.equal(r.paused, true);
    assert.equal(cap.length, 0);
  } finally { fs.rmSync(P, { force: true }); }
});
await ta("daily cap short-circuits the run", async () => {
  const today = new Date().toISOString();
  const published = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, at: today, review: false }));
  const cap = [];
  const r = await boRun({ ...stubs(cap), storeImpl: memStore({ published }), dryRun: true });
  assert.equal(r.dailyCapHit, 20);
});
await ta("cross-run dedup skips an already-published event×form", async () => {
  const published = [{ key: boKey("wicked-bo-opening", "BO-OPENING"), at: new Date().toISOString(), review: false }];
  const cap = [];
  const r = await boRun({ ...stubs(cap), storeImpl: memStore({ published }), dryRun: true });
  assert.ok(r.skipped.some((s) => /already published/.test(s.reason)));
  assert.equal(cap.length, 0);
});
await ta("gatherer under-floor rejects (not published)", async () => {
  const cap = [];
  const s = stubs(cap);
  s.gatherImpl = async (job) => { job.gatherFail = "under floor: no opening/weekend/gross figure in the report"; return job; };
  const r = await boRun({ ...s, storeImpl: memStore(), dryRun: true });
  assert.equal(cap.length, 0);
  assert.ok(r.rejected.some((x) => /under floor/.test(x.reason)));
});
await ta("review mode routes the article to the review dir (never content/articles)", async () => {
  const reviewDir = path.join(TMP, "review");
  process.env.BOXOFFICE_REVIEW_DIR = reviewDir;
  const cap = [];
  const r = await boRun({ ...stubs(cap), storeImpl: memStore(), review: true, dryRun: false, limit: 1 });
  delete process.env.BOXOFFICE_REVIEW_DIR;
  // cleanup the run report finish() wrote under data/boxoffice/runs
  try { fs.rmSync(path.join(DATA_DIR, "runs", `${r.runId}.json`), { force: true }); } catch {}
  assert.equal(cap.length, 1, "one article assembled");
  assert.equal(cap[0].dir, reviewDir, "publish dir must be the review dir");
  assert.equal(r.published.length, 1);
});
await ta("full happy-path flow publishes exactly one (dry-run, no fs writes)", async () => {
  const cap = [];
  const r = await boRun({ ...stubs(cap), storeImpl: memStore(), dryRun: true, limit: 1 });
  assert.equal(r.published.length, 1);
  assert.equal(r.films, 1);
  assert.equal(cap.length, 1);
});
await ta("a low-engagement draft is HELD on terminal-accept, never published (engagement is KPI #1)", async () => {
  const cap = [];
  const s = stubs(cap);
  s.qaReviewImpl = async (job) => { job.qa = { score: 69, pass: false, hardBlocks: ["soft-floor engagement 3 < 5"], cutClaims: [], subscores: { ...highSubs, engagement: 3 }, weaknesses: [] }; return job; };
  const r = await boRun({ ...s, storeImpl: memStore(), dryRun: true, limit: 1 });
  assert.equal(r.published.length, 0, "a boring-but-accurate draft must NOT publish");
  assert.equal(r.held.length, 1);
  assert.equal(cap.length, 0);
});
t("alreadyPublished ignores review-flagged records (a review proof must not block the live run)", () => {
  const store = { published: [{ key: boKey("wicked-bo-opening", "BO-OPENING"), review: true, at: "2026-07-11" }] };
  assert.equal(alreadyPublished(store, "wicked-bo-opening", "BO-OPENING"), false);
  store.published.push({ key: boKey("wicked-bo-opening", "BO-OPENING"), review: false, at: "2026-07-11" });
  assert.equal(alreadyPublished(store, "wicked-bo-opening", "BO-OPENING"), true);
});
const memTracked = (films = {}) => ({ films, file: path.join(TMP, "tracked.json") });
const updateFound = () => ([{ film: baseJob().film, trigger: { ...baseJob().trigger, eventSlug: "wicked-bo-update" }, angle: { ...baseJob().angle, form: "BO-UPDATE" } }]);
const noWorldwideData = async (job) => { job.boxData = { providers: { stream: [], rent: [], buy: [] }, moneyStrings: [] }; return job; };
await ta("a NON-material BO-UPDATE is HELD (anti-duplicate law), never published", async () => {
  const cap = [];
  const s = { ...stubs(cap), findImpl: async () => updateFound(), dataImpl: noWorldwideData,
    gatherImpl: async (job) => { job.gathered = { ...gathered, cume: "$107 million", numbers: ["$107 million"], dropPct: "40%" }; job.trigger.sources = gathered.sources; return job; } };
  const tracked = memTracked({ [String(baseJob().film.tmdbId)]: { tmdbId: baseJob().film.tmdbId, title: "Wicked", lastNumberRaw: 107e6, lastMilestone: 100e6, status: "in-theaters", articles: [] } });
  const r = await boRun({ ...s, storeImpl: memStore(), trackedImpl: tracked, dryRun: true, limit: 1 });
  assert.equal(r.published.length, 0, "a non-material update must not publish");
  assert.ok(r.held.some((h) => /not material/.test(h.reason)));
  assert.equal(cap.length, 0);
});
await ta("a MATERIAL BO-UPDATE publishes with a DISTINCT (discriminated) eventSlug", async () => {
  const cap = [];
  const s = { ...stubs(cap), findImpl: async () => updateFound(), dataImpl: noWorldwideData,
    gatherImpl: async (job) => { job.gathered = { ...gathered, cume: "$105 million", numbers: ["$105 million"] }; job.trigger.sources = gathered.sources; return job; } };
  const tracked = memTracked({ [String(baseJob().film.tmdbId)]: { tmdbId: baseJob().film.tmdbId, title: "Wicked", lastNumberRaw: 90e6, lastMilestone: 75e6, status: "in-theaters", articles: [{ slug: "wicked-bo-opening", category: "movies", form: "BO-OPENING" }] } });
  const r = await boRun({ ...s, storeImpl: memStore(), trackedImpl: tracked, dryRun: true, limit: 1 });
  assert.equal(r.published.length, 1, "a material update must publish");
  assert.equal(cap.length, 1);
  assert.ok(/-100m$/.test(cap[0].trigger.eventSlug), `discriminated slug: ${cap[0].trigger.eventSlug}`);
});
await ta("orchestrator publishes a NETFLIX-TOP10 streaming article end-to-end (dry-run)", async () => {
  const cap = [];
  const nfFilm = { tmdbId: null, title: "The Big One", via: "netflix-top10", originalLanguage: "en", overview: "", netflix: { title: "The Big One", rank: 1, hours: "22 million hours", hoursRaw: 22000000, week: "2026-06-28" } };
  const s = { ...stubs(cap), dataImpl: noWorldwideData,
    findImpl: async () => ([{ film: nfFilm, trigger: { eventSlug: "the-big-one-netflix-top10", title: "The Big One", category: "streaming", subcategory: "best-of-streaming", priority: 92, signals: { recency: 5 }, eventType: "boxoffice", sources: [] }, angle: { form: "NETFLIX-TOP10", star: "", queries: ["The Big One netflix"], workingTitle: "The Big One tops Netflix" } }]),
    gatherImpl: async (job) => { job.gathered = { numbers: ["22 million hours"], records: ["#1 on Netflix's Top 10 this week"], cast: [], narrative: "big", hoursViewed: "22 million hours", hoursRaw: 22000000, netflixRank: 1, platform: "Netflix", outletCount: 0, sources: [] }; return job; },
  };
  const r = await boRun({ ...s, storeImpl: memStore(), trackedImpl: memTracked(), dryRun: true, limit: 1 });
  assert.equal(r.published.length, 1, JSON.stringify(r.held) + JSON.stringify(r.rejected));
  assert.equal(cap[0].angle.form, "NETFLIX-TOP10");
});
await ta("a BO-OPENING whose data shows a weekend drop is reclassified to BO-UPDATE", async () => {
  const cap = [];
  const s = { ...stubs(cap), dataImpl: noWorldwideData,
    findImpl: async () => ([{ film: baseJob().film, trigger: { ...baseJob().trigger, eventSlug: "wicked-bo-opening" }, angle: { ...baseJob().angle, form: "BO-OPENING" } }]),
    gatherImpl: async (job) => { job.gathered = { ...gathered, openingWeekend: "$45.2 million", cume: "$130 million", dropPct: "48%", numbers: ["$45.2 million", "$130 million", "48%"] }; job.trigger.sources = gathered.sources; return job; } };
  const r = await boRun({ ...s, storeImpl: memStore(), trackedImpl: memTracked(), dryRun: true, limit: 1 });
  assert.equal(r.published.length, 1, JSON.stringify(r.held));
  assert.equal(cap[0].angle.form, "BO-UPDATE", "a week-2 report must be reclassified away from OPENING");
  assert.ok(/bo-update/.test(cap[0].trigger.eventSlug), cap[0].trigger.eventSlug);
});

// ── 11. SELF-HEALING detectors — professional voice, no fabrication, honest drops ─────────────────
console.log("self-healing — hedge + drop-spin + fabrication + no-repeat");
t("hedgeCuts flags a self-hedge / AI-tell sentence, leaves clean prose + legit attribution alone", () => {
  const cuts = hedgeCuts("The film opened to $50 million. Honestly, the details aren't always pinpoint accurate. It topped the chart.");
  assert.equal(cuts.length, 1, JSON.stringify(cuts));
  assert.ok(/pinpoint accurate/.test(cuts[0]));
  assert.equal(hedgeCuts("The film opened to $50 million. Deadline reports it led the weekend.").length, 0, "attribution is not a hedge");
});
t("dropSpin flags a >45% drop called a strong hold; ok at/under 45% or when honest", () => {
  assert.ok(dropSpin("The sequel showed strong staying power, dipping 56%.", "56%"));
  assert.equal(dropSpin("It posted a strong hold, down just 40%.", "40%"), null, "40% IS a legit strong hold");
  assert.equal(dropSpin("The film fell a steep 56% in weekend two.", "56%"), null, "56% called a steep fall is fine");
});
t("fidelityLocks CUTS a hedge sentence and FLAGS drop-spin as a fixable correction", () => {
  const job = baseJob();
  job.gathered = { ...gathered, dropPct: "56%", numbers: ["$45.2 million", "56%", "4,337"] };
  job.article = { ...JSON.parse(JSON.stringify(goodArticle)),
    body: `Wicked opened to $45.2 million across 4,337 theaters. ${filler(24)} In weekend two it showed strong staying power, down 56%. Honestly, the details aren't always pinpoint accurate.` };
  const det = fidelityLocks(job);
  assert.ok(det.cutClaims.some((c) => /pinpoint accurate/.test(c)), "hedge cut: " + JSON.stringify(det.cutClaims));
  assert.ok(det.hardBlocks.some((b) => /^drop-spin/.test(b)), "drop-spin flagged: " + JSON.stringify(det.hardBlocks));
  assert.ok(classifyBlocks(det.hardBlocks).fixable.some((b) => /drop-spin/.test(b)), "drop-spin must be FIXABLE (self-heals, never a dead hold)");
});
await ta("QA judge flags ungrounded prose → cut (thin-source fabrication self-heals)", async () => {
  const job = baseJob();
  job.gathered = { ...gathered, cast: ["Cynthia Erivo"], narrative: "A strong debut weekend." };
  job.boxData = { ...boxData, cast: ["Cynthia Erivo"] };
  job.article = { ...JSON.parse(JSON.stringify(goodArticle)), body: goodBody + " Set in Austin, the film features Nick Offerman and left viewers in tears." };
  const judge = async () => ({ data: { score: 85, subscores: highSubs, strengths: [], weaknesses: [], ungrounded: ["Set in Austin", "features Nick Offerman", "left viewers in tears"] } });
  await qaReview(job, { chatImpl: judge });
  assert.ok(job.qa.cutClaims.some((c) => /Austin/.test(c)), "ungrounded → cut: " + JSON.stringify(job.qa.cutClaims));
  assert.equal(job.qa.pass, false, "ungrounded claims block the pass until they are cut");
});
t("coveredEventSlugs returns covered slugs + titles (incl review previews by default)", () => {
  const store = { published: [
    { key: "a", eventSlug: "toy-story-5-bo-update-160m", film: "Toy Story 5", title: "T", review: true },
    { key: "b", eventSlug: "wicked-bo-opening", film: "Wicked", review: false },
  ] };
  const all = coveredEventSlugs(store);
  assert.ok(all.slugs.has("toy-story-5-bo-update-160m") && all.slugs.has("wicked-bo-opening"));
  assert.ok(all.titles.has("toy story 5") && all.titles.has("wicked"));
  const live = coveredEventSlugs(store, { includeReview: false });
  assert.ok(!live.slugs.has("toy-story-5-bo-update-160m"), "review excluded when includeReview=false");
  assert.ok(live.slugs.has("wicked-bo-opening"));
});
await ta("finder rotates PAST a covered film (by title) to a fresh one — never repeats a story", async () => {
  const films = [
    { id: 1, title: "Toy Story 5", year: "2026", releaseDate: "2026-06-20", popularity: 99, via: "now_playing", overview: "", originalLanguage: "en" },
    { id: 2, title: "Fresh Film", year: "2026", releaseDate: "2026-07-10", popularity: 80, via: "now_playing", overview: "", originalLanguage: "en" },
  ];
  const judge = async () => ({ data: { picks: [
    { i: 0, form: "BO-OPENING", workingTitle: "Toy Story 5", star: "", queries: ["x"] },
    { i: 1, form: "BO-OPENING", workingTitle: "Fresh Film", star: "", queries: ["y"] }] } });
  const seen = { slugs: new Set(["toy-story-5-bo-opening"]), titles: new Set(["toy story 5"]) };
  const found = await findFilms({ limit: 1, discoverImpl: async () => films, chatImpl: judge, netflixImpl: async () => ({ films: [], tv: [] }), trackedImpl: { films: {} }, providersImpl: async () => null, seen });
  assert.ok(!found.some((e) => e.film.title === "Toy Story 5"), "a covered film must NOT be re-picked");
  assert.ok(found.some((e) => e.film.title === "Fresh Film"), "rotate to a fresh film");
});
await ta("finder rotates to the next UNCOVERED Netflix title (a title staying #1 is not re-posted)", async () => {
  const nf = { week: "2026-06-28", films: [
    { title: "Old Number One", rank: 1, hours: "30 million hours", hoursRaw: 30000000 },
    { title: "New Entry", rank: 2, hours: "12 million hours", hoursRaw: 12000000 }], tv: [] };
  const seen = { slugs: new Set(["old-number-one-netflix-top10"]), titles: new Set(["old number one"]) };
  const found = await findFilms({ limit: 2, discoverImpl: async () => [], netflixImpl: async () => nf, trackedImpl: { films: {} }, providersImpl: async () => null, seen });
  const nfPick = found.find((e) => e.angle.form === "NETFLIX-TOP10");
  assert.ok(nfPick, "a fresh Netflix pick exists");
  assert.equal(nfPick.film.title, "New Entry", "rotated past the covered #1");
});

// ── 12. ROOT-CAUSE HARDENING — wrong cast, speculation, FAQ/heading completeness, theatrical gate ──
console.log("hardening — cast trust + speculation + FAQ/heading + theatrical");
t("castTrustworthy: trusts a matching recent title, rejects an old same-name film + a title mismatch", () => {
  assert.equal(castTrustworthy({ title: "I Will Find You", year: "2026", cast: [] }, "I Will Find You", { nowYear: 2026 }), true);
  assert.equal(castTrustworthy({ title: "I Will Find You", year: "1993", cast: [] }, "I Will Find You", { nowYear: 2026 }), false, "2026 chart title resolving to a 1993 film = wrong entity");
  assert.equal(castTrustworthy({ title: "Some Other Movie", year: "2026" }, "I Will Find You", { nowYear: 2026 }), false, "title mismatch");
  assert.equal(castTrustworthy(null, "X", {}), false);
});
t("speculationCuts flags unattributed analysis; trendCuts flags an unsupported (unattributed) streaming drop", () => {
  assert.equal(speculationCuts("The film opened big. Industry analysis suggests it will hold. Questions are being raised about its legs.").length, 2);
  assert.equal(speculationCuts("The film opened to $50 million, according to Deadline.").length, 0);
  assert.ok(trendCuts("The show hit #1. But the viewership drop from its debut raises alarm.").length >= 1);
  assert.equal(trendCuts("Per Nielsen, viewership fell 20% from last week.").length, 0, "attributed trend is kept");
});
t("fidelityLocks CUTS speculation + a streaming viewership-trend claim", () => {
  const job = { film: { title: "Show", originalLanguage: "en", overview: "" }, angle: { form: "NETFLIX-TOP10" },
    gathered: { numbers: ["22 million hours"], platform: "Netflix", hoursViewed: "22 million hours" }, boxData: {},
    article: { ...JSON.parse(JSON.stringify(goodArticle)), body: `Show hit #1 on Netflix with 22 million hours. ${filler(20)} Industry analysis suggests trouble ahead. The viewership drop from its premiere is concerning.`, faq: goodArticle.faq } };
  const det = fidelityLocks(job);
  assert.ok(det.cutClaims.some((c) => /Industry analysis/i.test(c)), "speculation cut: " + JSON.stringify(det.cutClaims));
  assert.ok(det.cutClaims.some((c) => /viewership drop/i.test(c)), "trend cut: " + JSON.stringify(det.cutClaims));
});
t("assemble GUARANTEES >=2 real FAQs even when the writer returns none (empty-FAQ bug fixed at root)", () => {
  const out = buildBoxOfficeMarkdown({
    article: { ...goodArticle, faq: [], body: "Show drew 22 million hours on Netflix this week. " + filler(20) },
    trigger: { eventSlug: "show-netflix-top10", priority: 90, signals: { recency: 5 }, category: "streaming", subcategory: "best-of-streaming", sources: [] },
    angle: { form: "NETFLIX-TOP10" }, film: { title: "Show" },
    gathered: { records: [], hoursViewed: "22 million hours", netflixRank: 1, netflixWeek: "2026-06-28", weeksInTop10: 2, platform: "Netflix", outletCount: 0 },
    boxData: {}, image: null, dateISO: new Date().toISOString(),
  });
  const d = matter(out.md).data;
  assert.ok(Array.isArray(d.faq) && d.faq.length >= 2, `faq must be backfilled: ${JSON.stringify(d.faq)}`);
  assert.ok(d.faq.every((f) => f.q && f.a && f.a.length > 15), "each backfilled FAQ has a real answer");
});
t("assemble STRIPS generic template headings (## and **bold?**), keeps story-specific ones", () => {
  const out = buildBoxOfficeMarkdown({
    article: { ...goodArticle, body: "## What's Next for the Film?\nIt will expand next week.\n\n**Why Is It Trending?**\nBig stars drew crowds.\n\n## Wicked Shatters the November Record\nDetails here. " + filler(10) },
    trigger: baseJob().trigger, angle: { form: "BO-OPENING" }, film: { title: "Wicked" }, gathered, boxData, image: null, dateISO: new Date().toISOString(),
  });
  assert.ok(!/What's Next for the Film/i.test(out.md), "generic ## heading stripped");
  assert.ok(!/Why Is It Trending/i.test(out.md), "generic **bold** heading stripped");
  assert.ok(/Wicked Shatters the November Record/.test(out.md), "story-specific heading kept");
});
await ta("gatherer REJECTS a streaming-original from a box-office form (theatrical gate — Enola Holmes bug)", async () => {
  const job = { film: { title: "Enola Holmes 3", originalLanguage: "en" }, angle: { form: "BO-OPENING", queries: ["Enola Holmes box office"] },
    trigger: { sources: [] }, boxData: { isOTT: true, providers: { stream: ["Netflix"], rent: [], buy: [] }, worldwide: null } };
  await gatherRun(job, { findImpl: async () => ({ sources: [{ owner: "variety", url: "x", text: "Enola Holmes 3 is now streaming. It reportedly cost $50 million." }] }), chatImpl: async () => ({ data: { otherNumbers: ["$50 million"], cast: [] } }) });
  assert.ok(/streaming original/i.test(job.gatherFail || ""), "a Netflix film must not pass a box-office floor: " + job.gatherFail);
});
t("fidelityLocks flags numbers that don't reconcile (domestic+intl must ≈ worldwide)", () => {
  const job = baseJob();
  job.gathered = { ...gathered, domestic: "$100 million", international: "$50 million", worldwide: "$300 million", numbers: ["$100 million", "$50 million", "$300 million"] };
  const det = fidelityLocks(job);
  assert.ok(det.hardBlocks.some((b) => /^reconcile/.test(b)), "mismatch flagged: " + JSON.stringify(det.hardBlocks));
  assert.ok(classifyBlocks(det.hardBlocks).fixable.some((b) => /reconcile/.test(b)), "reconcile is fixable (never dead-holds)");
  // a reconciling set does NOT flag
  const ok = baseJob(); ok.gathered = { ...gathered, domestic: "$100 million", international: "$50 million", worldwide: "$150 million", numbers: ["$100 million", "$50 million", "$150 million"] };
  assert.ok(!fidelityLocks(ok).hardBlocks.some((b) => /^reconcile/.test(b)), "100+50=150 reconciles");
});
await ta("finder ADVANCES a covered in-theater film as a BO-UPDATE when the fresh pool is empty (owner's fallback)", async () => {
  const seen = { slugs: new Set(["wicked-bo-opening"]), titles: new Set(["wicked"]) };
  const tracked = { films: { "1": { tmdbId: 1, title: "Wicked", releaseDate: "2026-06-01", status: "in-theaters", articles: [{ slug: "wicked-bo-opening" }] } } };
  const films = [{ id: 1, title: "Wicked", year: "2026", releaseDate: "2026-06-01", popularity: 90, via: "now_playing", overview: "", originalLanguage: "en" }];
  const judge = async () => ({ data: { picks: [{ i: 0, form: "BO-OPENING", workingTitle: "Wicked", star: "", queries: ["x"] }] } });
  const found = await findFilms({ limit: 1, discoverImpl: async () => films, chatImpl: judge, netflixImpl: async () => ({ films: [], tv: [] }), trackedImpl: tracked, providersImpl: async () => null, seen });
  assert.ok(found.some((e) => e.film.title === "Wicked" && e.angle.form === "BO-UPDATE"), "covered film surfaced as a next-day BO-UPDATE: " + JSON.stringify(found.map((e) => e.angle.form)));
});
fs.rmSync(TMP, { recursive: true, force: true });

// ── summary ──────────────────────────────────────────────────────────────────────────────────────
console.log(`\n━━ boxoffice suite: ${pass}/${pass + fail} passed ━━`);
if (fail) process.exit(1);
