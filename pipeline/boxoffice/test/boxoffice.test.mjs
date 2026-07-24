import { fileURLToPath } from "node:url";
// OFFLINE DETERMINISTIC SUITE for the box-office lane (plan §16). ALL impls injected — no network,
// no keys. Run from the site/ dir:  node pipeline/boxoffice/test/boxoffice.test.mjs
// Covers: number-fidelity + no-invention walls, scope guard, platform guard, forms/floors, caps,
// PAUSED kill switch, review-dir routing, cross-run dedup, and the assemble frontmatter shape.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { normMoney, moneyBucket, extractFigures, buildAllowed, numberFidelity, noInvention, platformGuard, platformGuard as platformGuardX, canonicalFigures, canonicalFigures as canonicalFiguresX, numberConsistencyGate } from "../moneyGuard.mjs";
import { scopeOk, FORMS, DATA_DIR } from "../config.bo.mjs";
import { fidelityLocks, review as qaReview, classifyBlocks, findTemplateHeadings, hedgeCuts, dropSpin, speculationCuts, trendCuts, verdictCuts } from "../agents/qa.mjs";
import { castTrustworthy } from "../boxofficeData.mjs";
import { buildBoxOfficeMarkdown, writeBoxOfficeArticle, seoFinish, scaffoldViolations, numbersSection as numbersSectionX } from "../assemble.mjs";
import { boRun } from "../borun.mjs";
import { boKey, alreadyPublished, coveredEventSlugs, parkAngle as parkAngleX, parkedTries as parkedTriesX, parkCooling, filmAttemptBudgetLeft, bumpFilmAttempt } from "../store.mjs";
import { run as gatherRun } from "../agents/gatherer.mjs";
import { run as writerRun } from "../agents/writer.mjs";
import { readChartCache, writeChartCache, parseChartText, chartMetaFromText } from "../dailyChart.mjs";
import { parseRss, BO_SCOPE, JUNK_RE } from "../find/sources.mjs";
import { categorize, cluster } from "../find/events.mjs";
import { scoreEvent } from "../find/score.mjs";
import { readQueue, markConsumed } from "../find/findrun.mjs";
import { PACE, refill, expectedByNow, allowance, debit } from "../pacing.mjs";
import { firstJsonObject as firstJsonObjectX, agentChat as agentChatX } from "../models.mjs";
import { fault as faultX, assertCount as assertCountX, faultReport as faultReportX, resetFaults as resetFaultsX, loadJsonState as loadJsonStateX } from "../health.mjs";
import { loadStore as loadStoreX } from "../store.mjs";
import { KIND_FORM, isPlausibleFilmTitle } from "../find/events.mjs";
import { discoverTrendingTv } from "../discover.mjs";
import { dailyAudit } from "../audit.mjs";
import { isMaterial, updateEventSuffix, recordArticle, currentNumberRaw, priorArticles, linkPriorCoverage, streamingExits, trackKey, isPastOpening, isMaterial as isMaterialX, lastPublishedRawFor as lastPublishedRawForX } from "../tracker.mjs";
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
await ta("NOW-STREAMING with no platform fails the needsPlatform floor", async () => {
  const job = { film: { title: "Wicked" }, angle: { form: "NOW-STREAMING", queries: ["Wicked streaming"] }, trigger: { sources: [] }, boxData: { providers: { stream: [], rent: [], buy: [] } } };
  await gatherRun(job, { findImpl: gFind("Wicked heads to streaming soon."), chatImpl: gData({ openingWeekend: "$45.2 million" }) });
  assert.ok(/subscription-streaming platform|not 'now streaming'/.test(job.gatherFail || ""), job.gatherFail);
});
await ta("NOW-STREAMING with ONLY rent/buy (no subscription) fails — rent/buy is not 'now streaming' (the Michael bug)", async () => {
  const job = { film: { title: "Michael" }, angle: { form: "NOW-STREAMING", queries: ["Michael streaming"] }, trigger: { sources: [] }, boxData: { providers: { stream: [], rent: ["Amazon Video", "Apple TV"], buy: ["Amazon Video"] } } };
  await gatherRun(job, { findImpl: gFind("Michael is available to rent."), chatImpl: gData({ openingWeekend: "$97 million" }) });
  assert.ok(/subscription-streaming platform|not 'now streaming'/.test(job.gatherFail || ""), job.gatherFail);
});
await ta("NOW-STREAMING WITH a flatrate (subscription) platform passes the floor", async () => {
  const job = { film: { title: "Wicked" }, angle: { form: "NOW-STREAMING", queries: ["Wicked streaming"] }, trigger: { sources: [] }, boxData: { providers: { stream: ["Max"], rent: [], buy: [] } } };
  await gatherRun(job, { findImpl: gFind("Wicked is now on Max."), chatImpl: gData({ openingWeekend: "$45.2 million" }) });
  assert.ok(!job.gatherFail, job.gatherFail);
});
t("VERIFICATION hard-blocks a 'now streaming' claim when only rent/buy is confirmed (the live Michael bug)", () => {
  const job = {
    film: { title: "Michael", originalLanguage: "en" },
    angle: { form: "NOW-STREAMING" },
    gathered: { numbers: ["$97 million"], platform: "" },
    boxData: { providers: { stream: [], rent: ["Amazon Video", "Apple TV"], buy: ["Amazon Video"] }, cast: [], moneyStrings: [] },
    article: { title: "Michael Now Streaming", dek: "The biopic is now streaming for fans at home.", body: "Michael is now streaming. It grossed $97 million. The cast is strong. The story is compelling. Fans are thrilled.", faq: [{ q: "a", a: "b" }, { q: "c", a: "d" }] },
  };
  const det = fidelityLocks(job);
  assert.ok(det.hardBlocks.some((b) => /^streaming-claim/.test(b)), "must hard-block the false 'now streaming' claim: " + JSON.stringify(det.hardBlocks));
});
t("VERIFICATION allows a real 'now streaming' when a subscription (flatrate) provider is confirmed", () => {
  const job = {
    film: { title: "Wicked", originalLanguage: "en" },
    angle: { form: "NOW-STREAMING" },
    gathered: { numbers: ["$45.2 million"], platform: "" },
    boxData: { providers: { stream: ["Max"], rent: [], buy: [] }, cast: [], moneyStrings: [] },
    article: { title: "Wicked Now Streaming on Max", dek: "Wicked is now streaming on Max.", body: "Wicked is now streaming on Max. It opened to $45.2 million. The cast is strong. The story is compelling. Fans are thrilled to watch at home.", faq: [{ q: "a", a: "b" }, { q: "c", a: "d" }] },
  };
  const det = fidelityLocks(job);
  assert.ok(!det.hardBlocks.some((b) => /^streaming-claim/.test(b)), "must NOT flag a real subscription-streaming claim: " + JSON.stringify(det.hardBlocks));
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
t("fewer than 2 writer FAQs does NOT hard-block (assemble.ensureFaq backfills ≥2 at publish)", () => {
  const job = baseJob(); job.article.faq = [{ q: "one?", a: "just one" }];
  assert.ok(!fidelityLocks(job).hardBlocks.some((b) => /^seo-faq/.test(b)));
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
t("currentNumberRaw uses LABELED fields only — the numbers grab-bag can NEVER poison the baseline", () => {
  // A roundup carried another film's $427M in gathered.numbers; the baseline must ignore it entirely
  // (the live Obsession poisoning: baseline $427M silently blocked all future coverage).
  assert.equal(currentNumberRaw({ domestic: "$26.4 million", numbers: ["$427 million", "$26.4 million"] }, {}), 26400000);
  // Labeled worldwide is legitimate and wins when consistent with the film's own domestic (within 3×).
  assert.equal(currentNumberRaw({ worldwide: "$68.3 million", domestic: "$26.4 million" }, {}), 68300000);
  // A wrong-entity TMDB worldwide that dwarfs the film's own domestic (>3×) is dropped by the sanity ratio.
  assert.equal(currentNumberRaw({ domestic: "$26.4 million" }, { worldwide: "$427 million" }), 26400000);
  // The daily chart's cume is the trusted anchor when present.
  assert.equal(currentNumberRaw({}, {}, { cume: "$47,591,086" }), 47591086);
  assert.equal(currentNumberRaw({}, {}), null);
});
t("isMaterial: a milestone crossing is material with a milestone tag", () => {
  const tracked = { films: { "1": { tmdbId: 1, title: "Wicked", lastDomesticRaw: 90e6, lastNumberRaw: 90e6, lastMilestone: 75e6, articles: [] } } };
  const mat = isMaterial({ tmdbId: 1, title: "Wicked" }, { cume: "$105 million" }, {}, tracked);
  assert.equal(mat.material, true);
  assert.equal(mat.tag, "100m", mat.reason);
});
t("isMaterial: a same-or-LOWER number is NOT material — never re-report Day-15's numbers (owner's #1)", () => {
  const tracked = { films: { "1": { tmdbId: 1, title: "Wicked", lastDomesticRaw: 108e6, lastNumberRaw: 108e6, lastMilestone: 100e6, articles: [] } } };
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
  const found = await findFilms({ providerStreamImpl: async () => [], queueImpl: () => null, dailyChartImpl: async () => ({ films: [] }), limit: 5, discoverImpl: async () => [], netflixImpl: async () => nf, trackedImpl: { films: {} }, providersImpl: async () => null });
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
  const found = await findFilms({ providerStreamImpl: async () => [], queueImpl: () => null, dailyChartImpl: async () => ({ films: [] }), limit: 3, discoverImpl: async () => films, chatImpl: badJudge, netflixImpl: async () => ({ films: [], tv: [] }), trackedImpl: { films: {} }, providersImpl: async () => null });
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
  assert.ok(d.metaTitle.length >= 45 && d.metaTitle.length <= 55, `metaTitle must land in the owner's 45-55 band, got ${d.metaTitle.length}: "${d.metaTitle}"`);
  assert.ok(!/screen report/i.test(d.metaTitle), "metaTitle must be brand-free");
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
  const tracked = memTracked({ [String(baseJob().film.tmdbId)]: { tmdbId: baseJob().film.tmdbId, title: "Wicked", lastDomesticRaw: 107e6, lastNumberRaw: 107e6, lastMilestone: 100e6, status: "in-theaters", articles: [] } });
  const r = await boRun({ ...s, storeImpl: memStore(), trackedImpl: tracked, dryRun: true, limit: 1 });
  assert.equal(r.published.length, 0, "a non-material update must not publish");
  assert.ok(r.held.some((h) => /not material/.test(h.reason)));
  assert.equal(cap.length, 0);
});
await ta("a MATERIAL BO-UPDATE publishes with a DISTINCT (discriminated) eventSlug", async () => {
  const cap = [];
  const s = { ...stubs(cap), findImpl: async () => updateFound(), dataImpl: noWorldwideData,
    gatherImpl: async (job) => { job.gathered = { ...gathered, cume: "$105 million", numbers: ["$105 million"] }; job.trigger.sources = gathered.sources; return job; } };
  const tracked = memTracked({ [String(baseJob().film.tmdbId)]: { tmdbId: baseJob().film.tmdbId, title: "Wicked", lastDomesticRaw: 90e6, lastNumberRaw: 90e6, lastMilestone: 75e6, status: "in-theaters", articles: [{ slug: "wicked-bo-opening", category: "movies", form: "BO-OPENING" }] } });
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
  const found = await findFilms({ providerStreamImpl: async () => [], queueImpl: () => null, dailyChartImpl: async () => ({ films: [] }), limit: 1, discoverImpl: async () => films, chatImpl: judge, netflixImpl: async () => ({ films: [], tv: [] }), trackedImpl: { films: {} }, providersImpl: async () => null, seen });
  assert.ok(!found.some((e) => e.film.title === "Toy Story 5"), "a covered film must NOT be re-picked");
  assert.ok(found.some((e) => e.film.title === "Fresh Film"), "rotate to a fresh film");
});
await ta("finder rotates to the next UNCOVERED Netflix title (a title staying #1 is not re-posted)", async () => {
  const nf = { week: "2026-06-28", films: [
    { title: "Old Number One", rank: 1, hours: "30 million hours", hoursRaw: 30000000 },
    { title: "New Entry", rank: 2, hours: "12 million hours", hoursRaw: 12000000 }], tv: [] };
  // Streaming slugs are WEEK-KEYED: covered THIS week (w2026-06-28) → skipped this week; the same title in a
  // NEW chart week is a fresh story again (the old week-less slug permanently killed re-coverage).
  const seen = { slugs: new Set(["old-number-one-netflix-top10-w2026-06-28"]), titles: new Set(["old number one"]) };
  const found = await findFilms({ providerStreamImpl: async () => [], queueImpl: () => null, dailyChartImpl: async () => ({ films: [] }), limit: 2, discoverImpl: async () => [], netflixImpl: async () => nf, trackedImpl: { films: {} }, providersImpl: async () => null, seen });
  const nfPick = found.find((e) => e.angle.form === "NETFLIX-TOP10");
  assert.ok(nfPick, "a fresh Netflix pick exists");
  assert.equal(nfPick.film.title, "New Entry", "rotated past the covered #1");
  assert.ok(nfPick.trigger.eventSlug.endsWith("-w2026-06-28"), "streaming eventSlug carries the chart week: " + nfPick.trigger.eventSlug);
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
  const found = await findFilms({ providerStreamImpl: async () => [], queueImpl: () => null, dailyChartImpl: async () => ({ films: [] }), limit: 1, discoverImpl: async () => films, chatImpl: judge, netflixImpl: async () => ({ films: [], tv: [] }), trackedImpl: tracked, providersImpl: async () => null, seen });
  assert.ok(found.some((e) => e.film.title === "Wicked" && e.angle.form === "BO-UPDATE"), "covered film surfaced as a next-day BO-UPDATE: " + JSON.stringify(found.map((e) => e.angle.form)));
});
fs.rmSync(TMP, { recursive: true, force: true });

// ── SINGLE SOURCE OF TRUTH — canonical figures + the pre-publish consistency gate ────────────────
console.log("consistency — canonical figures + cross-surface gate (the Obsession class of failure)");
t("canonicalFigures reconciles ONE set from labeled sources and drops an impossible worldwide", () => {
  const c = canonicalFigures({ gathered: { cume: "$26.4 million", worldwide: "$14 million" }, boxData: {}, film: {} });
  assert.equal(c.domestic.raw, 26400000);
  assert.equal(c.worldwide, null, "a worldwide BELOW domestic is a wrong figure and must be dropped");
  const c2 = canonicalFigures({ gathered: { domestic: "$100 million", international: "$50 million", worldwide: "$300 million" }, boxData: {}, film: {} });
  assert.equal(c2.worldwide, null, "dom+intl ≉ worldwide (>12%) → worldwide dropped");
  const c3 = canonicalFigures({ gathered: {}, boxData: {}, film: { dailyChart: { cume: "$47,591,086", dailyGross: "$4,448,262", dayInRelease: "Day 4" } } });
  assert.equal(c3.domestic.raw, 47591086, "the daily chart is ground truth for the domestic total");
  assert.equal(c3.dayInRelease, "4");
});
t("consistency gate BLOCKS the live Obsession failure — a title/takeaway/FAQ contradicting the canonical figures", () => {
  const canon = canonicalFigures({ gathered: { domestic: "$26.4 million", worldwide: "$68.3 million", theaters: "3,100" }, boxData: { budget: "$750,000" }, film: {} });
  const bad = numberConsistencyGate({
    title: "Obsession Surge Crossing $100M",
    metaTitle: "Obsession Box Office Third Weekend Surpasses $100M",
    dek: "", metaDescription: "",
    body: "This surge pushed its domestic total to $106 million and its worldwide gross to $148 million.",
    keyTakeaways: ["It crossed $106M domestically and $148M worldwide against a $1M budget."],
    faq: [{ q: "How much worldwide?", a: "Its worldwide total stands at $148 million." }],
  }, canon, { recordTexts: [] });
  assert.equal(bad.ok, false);
  assert.ok(bad.violations.some((v) => /title/.test(v)), "the $100M title must violate: " + JSON.stringify(bad.violations));
  assert.ok(bad.violations.some((v) => /domestic/.test(v)), "the $106M-domestic body claim must violate the canonical domestic");
});
t("consistency gate PASSES an article whose every surface draws from the canonical set", () => {
  const canon = canonicalFigures({ gathered: { domestic: "$26.4 million", worldwide: "$68.3 million", theaters: "3,100" }, boxData: { budget: "$750,000" }, film: {} });
  const good = numberConsistencyGate({
    title: "Obsession Box Office: Domestic Total Climbs to $26.4 Million",
    metaTitle: "'Obsession' Hits $26.4M at the Domestic Box Office",
    dek: "The low-budget horror keeps climbing.", metaDescription: "Obsession has grossed $26.4 million domestically and $68.3 million worldwide on a $750,000 budget.",
    body: "Obsession has grossed $26.4 million at the domestic box office across 3,100 theaters. Worldwide, it has taken in $68.3 million. It carries a reported production budget of $750,000.",
    keyTakeaways: ["Obsession has grossed $26.4 million domestically."],
    faq: [{ q: "How much has it made?", a: "It has grossed $26.4 million domestically, with $68.3 million worldwide." }],
  }, canon, { recordTexts: [] });
  assert.equal(good.ok, true, JSON.stringify(good.violations));
});
t("consistency gate allows the film's OWN record figures (verbatim milestones) but nothing else", () => {
  const canon = canonicalFigures({ gathered: { domestic: "$371.9 million", worldwide: "$1.0 billion" }, boxData: { budget: "$250 million" }, film: {} });
  const r = numberConsistencyGate({
    title: "Michael Crosses $1 Billion Worldwide", metaTitle: "'Michael' Hits $1B at the Worldwide Box Office",
    dek: "", metaDescription: "", body: "It passed Oppenheimer's $975.8 million to take the biopic record.",
    keyTakeaways: [], faq: [],
  }, canon, { recordTexts: ["passed Oppenheimer's $975.8 million on June 28"] });
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});
t("buildBoxOfficeMarkdown: a DAILY update gets a deterministic title from the canonical number (no writer spin)", () => {
  const out = buildBoxOfficeMarkdown({
    article: { title: "Moana Sinks With Disastrous $43M Opening as $250M Budget Faces Doom", metaTitle: "", dek: "A big week.", metaDescription: "A big week for the film.",
      body: "Moana is a family adventure film.\n\n## At the Box Office\n\nMoana has grossed $47,591,086 at the domestic box office, 4 days into its theatrical run. The film added $4,448,262 in its most recent day of release.",
      keyTakeaways: ["Moana leads the daily chart."], faq: [{ q: "Who directed Moana?", a: "The live-action film features the voyager Moana on a new adventure across the Pacific." }], tags: [] },
    trigger: { eventSlug: "moana-bo-update", priority: 90, signals: {}, sources: [] },
    angle: { form: "BO-UPDATE" },
    film: { title: "Moana", year: "2026", dailyChart: { cume: "$47,591,086", dailyGross: "$4,448,262", dayInRelease: "Day 4" } },
    gathered: { numbers: ["$47,591,086", "$4,448,262"] }, boxData: {},
    image: { image: "https://x/y.jpg", imageWidth: 1600, imageHeight: 900, credit: "Disney", alt: "Moana" },
    dateISO: new Date("2026-07-16T00:00:00Z").toISOString(),
  });
  assert.ok(/^Moana Box Office Day 4/.test(out.frontmatter.title), "deterministic title, got: " + out.frontmatter.title);
  assert.ok(!/disastrous|sinks/i.test(out.frontmatter.title), "writer spin title must be discarded");
  assert.equal(out.consistency.ok, true, JSON.stringify(out.consistency.violations));
  assert.ok(out.frontmatter.metaTitle.length >= 45 && out.frontmatter.metaTitle.length <= 55, out.frontmatter.metaTitle);
});
t("tidyMeta: strips markdown, ends on a complete sentence (the live '## The Movie:' meta description bug)", () => {
  const out = seoFinish({ metaTitle: "'Wicked' Hits $45M at the Domestic Box Office", metaDescription: "## The Movie: A Musical Journey\n\n**Wicked** is a hit. It has grossed $45.2 million in its opening weekend across the country, thrilling audiences everywhere. Another sentence that will not fit within the one-sixty character budget at all." });
  assert.ok(!/[#*_`]/.test(out.metaDescription), "markdown stripped: " + out.metaDescription);
  assert.ok(/[.!?…]$/.test(out.metaDescription), "ends complete: " + out.metaDescription);
  assert.ok(out.metaDescription.length <= 160, `len ${out.metaDescription.length}`);
});
t("writeBoxOfficeArticle refuses to write a self-contradicting article to disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bo-gate-"));
  const out = writeBoxOfficeArticle({
    article: { title: "Obsession Crosses $100M Domestically This Weekend In Style", metaTitle: "", dek: "", metaDescription: "",
      body: "Obsession pushed its domestic total to $106 million this weekend.", keyTakeaways: [], faq: [{ q: "q1?", a: "Long enough real answer here." }, { q: "q2?", a: "Another long enough answer." }], tags: [] },
    trigger: { eventSlug: "obsession-bo-update", priority: 90, signals: {}, sources: [] },
    angle: { form: "BO-UPDATE" }, film: { title: "Obsession", year: "2026" },
    gathered: { domestic: "$26.4 million", numbers: ["$26.4 million"] }, boxData: {},
    image: { image: "https://x/y.jpg", imageWidth: 1600, imageHeight: 900, credit: "A24", alt: "Obsession" },
    dateISO: new Date().toISOString(), dir,
  });
  assert.equal(out.written, false, "must refuse to write");
  assert.equal(out.consistency.ok, false);
  assert.ok(!fs.existsSync(out.path), "no file on disk");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── P0/P1 UPGRADE — cost levers + quality walls + per-metric tracker (BOX_OFFICE_UPGRADE_PLAN §2/§4) ──
console.log("upgrade — judge-skip, numbers-in-prose, scaffold, verdict walls, per-metric tracker, park expiry");

await ta("chart update SKIPS the LLM judge — deterministic walls only (a throwing judge must not matter)", async () => {
  const job = baseJob();
  job.film.dailyChart = { cume: "$45.2 million", dailyGross: "$2.1 million", theaters: "3,100", dayInRelease: "Day 5" };
  job.gathered.numbers = ["$45.2 million", "$2.1 million", "3,100 theaters"];
  await qaReview(job, { chatImpl: async () => { throw new Error("judge must never be called for a chart update"); } });
  assert.equal(job.qa.judged, false);
  assert.equal(job.qa.pass, true, JSON.stringify(job.qa.hardBlocks) + JSON.stringify(job.qa.cutClaims));
});

await ta("writerChart (cheap model) writes chart updates; features keep the verbose writer", async () => {
  const models = [];
  const fake = async ({ model }) => { models.push(model); return { data: { title: "T", body: "A movie profile paragraph that is long enough to keep for the test purposes here.", keyTakeaways: [], faq: [] }, usage: {} }; };
  const chartJob = { film: { title: "X", dailyChart: { cume: "$10 million" } }, gathered: {}, boxData: {}, angle: { form: "BO-UPDATE" }, brief: { seoKeyword: "x" } };
  await writerRun(chartJob, { chatImpl: fake });
  assert.ok(models[0].includes("deepseek"), "chart update uses the cheap chart writer: " + models[0]);
});

t("numbersSection: the verified figures are APPENDED AT ASSEMBLY — the gross is guaranteed in the prose", () => {
  const out = buildBoxOfficeMarkdown({
    article: { title: "ignored", metaTitle: "", dek: "A movie doing business.", metaDescription: "",
      body: "Xanadu Quest keeps drawing families to theaters on the strength of its cast and its storybook premise.\n\n## What It Is\n\n" + "A fantasy adventure film with a beloved ensemble and a storybook premise that audiences know well from the long-running series of novels it adapts, directed with a light touch and a brisk pace that keeps younger viewers locked in while giving parents plenty to enjoy. ".repeat(2) + "\n\n## The Cast\n\n" + "Star One leads as Hero alongside Star Two as Rival, with a deep supporting bench rounding out the ensemble for the studio, including a scene-stealing turn from a veteran character actor whose casting delighted fans of the original novels when it was announced. ".repeat(2),
      keyTakeaways: [], faq: [{ q: "Who stars?", a: "Star One leads the ensemble as Hero in this adventure." }], tags: [] },
    trigger: { eventSlug: "x-bo-update-d5", priority: 90, signals: {}, sources: [] },
    angle: { form: "BO-UPDATE" },
    film: { title: "Xanadu Quest", year: "2026", dailyChart: { cume: "$45,200,000", dailyGross: "$2,100,000", theaters: "3,100", dayInRelease: "Day 5" } },
    gathered: { numbers: ["$45,200,000", "$2,100,000"] }, boxData: { budget: "$100 million", castRoles: [{ name: "Star One", character: "Hero" }], director: "A Director" },
    image: { image: "https://x/y.jpg", imageWidth: 1600, imageHeight: 900, credit: "Studio", alt: "X" },
    dateISO: new Date("2026-07-17T00:00:00Z").toISOString(),
  });
  assert.ok(/## At the Box Office/.test(out.md), "numbers section present");
  assert.ok(/\$45,200,000/.test(out.md.split("---")[2] || out.md), "the domestic gross is IN the body prose");
  assert.ok(out.frontmatter.keyTakeaways.length >= 3, "system takeaways ≥3: " + JSON.stringify(out.frontmatter.keyTakeaways));
  assert.ok(out.frontmatter.keyTakeaways.some((k) => /\$45,200,000/.test(k)), "headline figure in takeaways");
  assert.equal(out.consistency.ok, true, JSON.stringify(out.consistency.violations));
  assert.deepEqual(out.scaffold, [], JSON.stringify(out.scaffold));
});

t("scaffoldViolations blocks placeholders, empty sections, template labels, flattened markdown, thin bodies", () => {
  const fm = { keyTakeaways: ["a", "b", "c"], faq: [{ q: "q1", a: "a1" }, { q: "q2", a: "a2" }] };
  const pad = "word ".repeat(200);
  assert.ok(scaffoldViolations(`${pad}\n\n[Box office section will be inserted here by the system.]`, fm).some((v) => /placeholder/.test(v)));
  assert.ok(scaffoldViolations(`${pad}\n\n## Closing Line`, fm).some((v) => /empty section/.test(v)));
  assert.ok(scaffoldViolations(`The Movie: A Great Story\n\n${pad}`, fm).some((v) => /template label/.test(v)));
  assert.ok(scaffoldViolations(`${pad} ## The Cast: Stars\n\nmore prose`, fm).some((v) => /mid-paragraph/.test(v)));
  assert.ok(scaffoldViolations("too short", fm).some((v) => /words/.test(v)));
  assert.deepEqual(scaffoldViolations(`${pad}\n\n## A Real Section\n\nWith real content under it.`, fm), []);
});

t("verdictCuts: profit/loss verdicts + unsourced audience verdicts are CUT; attributed reception survives", () => {
  const body = "The film faces a significant theatrical loss. Franchise fatigue has dampened enthusiasm. According to Variety, audiences gave it an A- CinemaScore. It is on track for profitability. A fine cast performance.";
  const cuts = verdictCuts(body);
  assert.ok(cuts.some((c) => /theatrical loss/.test(c)), "loss verdict cut");
  assert.ok(cuts.some((c) => /Franchise fatigue/.test(c)), "audience verdict cut");
  assert.ok(cuts.some((c) => /profitability/.test(c)), "profit verdict cut");
  assert.ok(!cuts.some((c) => /Variety/.test(c)), "attributed reception survives");
});

t("momentum titles: a milestone crossing leads with Crosses; otherwise the day's real added gross", () => {
  const base = {
    article: { title: "spin", metaTitle: "", dek: "", metaDescription: "", body: "word ".repeat(190), keyTakeaways: [], faq: [{ q: "q", a: "a real answer that is long enough" }], tags: [] },
    trigger: { eventSlug: "x", priority: 90, signals: {}, sources: [] }, angle: { form: "BO-UPDATE" },
    gathered: { numbers: ["$102,000,000", "$3,400,000"] }, boxData: {},
    image: { image: "https://x/y.jpg", imageWidth: 1600, imageHeight: 900, credit: "S", alt: "X" }, dateISO: new Date("2026-07-17T00:00:00Z").toISOString(),
  };
  const ms = buildBoxOfficeMarkdown({ ...base, film: { title: "Film A", dailyChart: { cume: "$102,000,000", dailyGross: "$3,400,000", dayInRelease: "Day 9" } }, momentum: { tag: "100m" } });
  assert.ok(/Crosses \$100 Million Domestically/.test(ms.frontmatter.title), ms.frontmatter.title);
  assert.ok((ms.frontmatter.records || []).some((r) => /crossed \$100 Million/.test(r.claim)), "system milestone record");
  const dg = buildBoxOfficeMarkdown({ ...base, film: { title: "Film A", dailyChart: { cume: "$102,000,000", dailyGross: "$3,400,000", dayInRelease: "Day 9" } }, momentum: { tag: "d9" } });
  assert.ok(/Adds \$3\.4 Million/.test(dg.frontmatter.title), dg.frontmatter.title);
  assert.ok(!/million\b/.test(dg.frontmatter.title), "Million capitalized in titles: " + dg.frontmatter.title);
});

t("same-metric rule: a metaTitle headlining worldwide over a domestic H1 is a violation", () => {
  const canon = canonicalFigures({ gathered: { domestic: "$410.6 million", worldwide: "$882 million" }, boxData: {}, film: {} });
  const r = numberConsistencyGate({
    title: "Toy Story 5 Box Office Day 26: Domestic Total Hits $410.6 Million",
    metaTitle: "'Toy Story 5' Crosses $882M at the Worldwide Box Office",
    dek: "", metaDescription: "", body: "Toy Story 5 has grossed $410.6 million at the domestic box office. Worldwide, it has taken in $882 million.", keyTakeaways: [], faq: [],
  }, canon, { recordTexts: [] });
  assert.ok(r.violations.some((v) => /SERP promise/.test(v)), JSON.stringify(r.violations));
});

t("per-metric tracker: a daily DOMESTIC advance is material even when worldwide is static (the lockout fix)", () => {
  const tracked = { films: { "9": { tmdbId: 9, title: "Locked Film", lastDomesticRaw: 410e6, lastWorldwideRaw: 882e6, lastMilestone: 400e6, articles: [], lastArticleAt: "2026-07-16T06:00:00Z" } } };
  const mat = isMaterial({ tmdbId: 9, title: "Locked Film", dailyChart: { cume: "$413.3 million", dayInRelease: "Day 27" } }, { cume: "$413.3 million" }, { worldwide: "$882 million" }, tracked, { now: new Date("2026-07-17T18:00:00Z") });
  assert.equal(mat.material, true, mat.reason);
  assert.equal(mat.tag, "d27", "real chart day in the tag: " + mat.tag);
});
t("per-metric tracker: a WORLDWIDE drift alone is NOT material (the Obsession double-publish killer)", () => {
  const tracked = { films: { "9": { tmdbId: 9, title: "F", lastDomesticRaw: 255.4e6, lastWorldwideRaw: 428e6, lastMilestone: 400e6, articles: [], lastArticleAt: "2026-07-16T06:00:00Z" } } };
  const mat = isMaterial({ tmdbId: 9, title: "F" }, { cume: "$255.4 million" }, { worldwide: "$429 million" }, tracked, { now: new Date("2026-07-17T18:00:00Z") });
  assert.equal(mat.material, false, "domestic static → not material regardless of worldwide drift: " + mat.reason);
});
t("per-metric tracker: ONE update per film per LA day (a second same-day update holds unless a milestone)", () => {
  const tracked = { films: { "9": { tmdbId: 9, title: "F", lastDomesticRaw: 100e6, lastMilestone: 100e6, articles: [], lastArticleAt: "2026-07-17T14:00:00Z" } } };
  const mat = isMaterial({ tmdbId: 9, title: "F" }, { cume: "$103 million" }, {}, tracked, { now: new Date("2026-07-17T20:00:00Z") });
  assert.equal(mat.material, false);
  assert.ok(/already covered today/.test(mat.reason), mat.reason);
});

t("park expiry: a dead park is a 72h cooldown, not a death sentence", () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "bo-park-"));
  const st = { published: [], parked: [], zeroStreak: 0, daySpend: null, file: path.join(dir2, "store.json") };
  const t0 = new Date("2026-07-17T00:00:00Z");
  parkAngleX(st, "ev", "NETFLIX-TOP10", "r1", { now: t0 }); parkAngleX(st, "ev", "NETFLIX-TOP10", "r2", { now: t0 }); parkAngleX(st, "ev", "NETFLIX-TOP10", "r3", { now: t0 });
  assert.equal(parkedTriesX(st, "ev", "NETFLIX-TOP10", { now: new Date("2026-07-18T00:00:00Z") }), Infinity, "dead within 72h");
  assert.equal(parkedTriesX(st, "ev", "NETFLIX-TOP10", { now: new Date("2026-07-20T01:00:00Z") }), 0, "expired after 72h → retryable");
  fs.rmSync(dir2, { recursive: true, force: true });
});

t("chart cache: same LA day hits the cache; a new day misses (extract once per day)", () => {
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), "bo-cache-"));
  const file = path.join(dir3, "chartCache.json");
  const t0 = Date.parse("2026-07-17T18:00:00Z");
  writeChartCache({ films: [{ title: "A", cume: "$1 million", rank: 1 }], date: "2026-07-16" }, { nowMs: t0, file });
  assert.ok(readChartCache({ nowMs: t0 + 3600e3, file }), "same LA day → cache hit");
  assert.equal(readChartCache({ nowMs: t0 + 30 * 3600e3, file }), null, "next LA day → miss");
  fs.rmSync(dir3, { recursive: true, force: true });
});

// ── P2 FIND ENGINE — event sources, categorize, cluster, score, queue, finder integration ─────────
console.log("P2 find — sources, events, scoring, queue, finder integration");

t("parseRss extracts items; BO_SCOPE + JUNK filter the beat correctly", () => {
  const xml = `<rss><channel><item><title><![CDATA['Superman' Crosses $500M at the Global Box Office]]></title><link>https://x/1</link><pubDate>Thu, 17 Jul 2026 10:00:00 GMT</pubDate></item><item><title>Movie Review: A Quiet Film</title><link>https://x/2</link><pubDate>Thu, 17 Jul 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items.length, 2);
  assert.ok(BO_SCOPE.test(items[0].title));
  assert.ok(JUNK_RE.test(items[1].title), "review = junk");
});

await ta("categorize batches headlines through ONE cheap call and maps typed kinds", async () => {
  const fake = async ({ user }) => ({ data: { items: user.split("\n").map((_, n) => ({ i: n + 1, relevant: n === 0, filmTitle: n === 0 ? "Superman" : "", kind: n === 0 ? "milestone" : "other" })) }, usage: {} });
  const out = await categorize([{ title: "Superman Crosses $500M", owner: "Variety", tier: 1, pubMs: 1 }, { title: "junky", owner: "X", tier: 3, pubMs: 1 }], { chatImpl: fake });
  assert.equal(out[0].relevant, true); assert.equal(out[0].filmTitle, "Superman"); assert.equal(out[0].kind, "milestone");
  assert.equal(out[1].relevant, false);
});

t("cluster: Penske mastheads count as ONE owner group; a real second outlet corroborates", () => {
  const evs = cluster([
    { relevant: true, filmTitle: "Superman", kind: "milestone", owner: "Variety", tier: 1, url: "https://x/1", title: "t1", pubMs: 5 },
    { relevant: true, filmTitle: "Superman", kind: "milestone", owner: "Deadline", tier: 1, url: "https://x/2", title: "t2", pubMs: 6 },
    { relevant: true, filmTitle: "Superman", kind: "milestone", owner: "TheWrap", tier: 2, url: "https://x/3", title: "t3", pubMs: 7 },
  ]);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].ownerGroups, 2, "PMC(Variety+Deadline)=1 + TheWrap=1");
  assert.equal(evs[0].slug, "superman-ev-milestone");
});

t("scoreEvent: a fresh corroborated OPENING outranks a day-50 chart footnote (the Moana-over-Obsession fix)", () => {
  const nowMs = Date.parse("2026-07-17T12:00:00Z");
  const opening = scoreEvent({ kind: "opening", ownerGroups: 2, newestMs: nowMs - 30 * 60e3, daysInRelease: 2 }, { nowMs });
  const oldChart = scoreEvent({ kind: "chart", ownerGroups: 1, newestMs: nowMs - 10 * 3600e3, daysInRelease: 50 }, { nowMs });
  assert.ok(opening > oldChart + 20, `${opening} vs ${oldChart}`);
});

t("queue: write → fresh read → stale after 45min → markConsumed", () => {
  const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), "bo-q-"));
  const file = path.join(dir4, "queue.json");
  const nowMs = Date.parse("2026-07-17T12:00:00Z");
  fs.writeFileSync(file, JSON.stringify({ builtAt: new Date(nowMs).toISOString(), events: [{ slug: "s1", filmTitle: "X", kind: "opening", priority: 60, sources: [] }] }));
  assert.ok(readQueue({ file, nowMs: nowMs + 10 * 60e3 }), "fresh at +10min");
  assert.equal(readQueue({ file, nowMs: nowMs + 50 * 60e3 }), null, "stale at +50min");
  markConsumed(["s1"], { file, nowMs });
  const q = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(q.events[0].consumedAt, "consumed stamped");
  fs.rmSync(dir4, { recursive: true, force: true });
});

await ta("finder: CHART films lead the pool (reliable supply); an off-chart event still enters; a chart-film event boosts its entry", async () => {
  const queue = { events: [
    { slug: "brand-new-film-ev-opening", filmTitle: "Brand New Film", kind: "opening", form: "BO-OPENING", priority: 60, sources: [{ owner: "Variety", tier: 1, url: "https://x/1", title: "Brand New Film opens huge" }] },
    { slug: "charted-film-ev-milestone", filmTitle: "Charted Film", kind: "milestone", form: "BO-UPDATE", priority: 55, sources: [] },
  ] };
  const chart = { films: [{ title: "Charted Film", cume: "$100 million", dailyGross: "$2 million", rank: 1, dayInRelease: "Day 10" }] };
  const found = await findFilms({ providerStreamImpl: async () => [], limit: 3, discoverImpl: async () => [], netflixImpl: async () => ({ films: [], tv: [] }), trackedImpl: { films: {} }, providersImpl: async () => null, dailyChartImpl: async () => chart, queueImpl: () => queue, dryQueueMark: true });
  // Chart films lead now: they are the dependable, pre-verified, cheapest-to-publish supply. Events
  // used to occupy the whole pool (110 of 308 candidate slots on 07-17 were parked-dead event slugs,
  // and 65 of 166 pools carried ZERO chart films) — that is what starved box-office volume.
  assert.equal(found[0].film.title, "Charted Film", "chart film leads the pool");
  const brandNew = found.find((e) => e.film.title === "Brand New Film");
  assert.ok(brandNew, "off-chart event still enters the pool");
  assert.equal(brandNew.angle.form, "BO-OPENING");
  assert.ok(brandNew.trigger.sources.length, "event sources flow to the gatherer");
  const charted = found.find((e) => e.film.title === "Charted Film");
  assert.ok(charted, "chart entry present");
  assert.ok(charted.trigger.priority >= 85, "chart entry BOOSTED by its event: " + charted.trigger.priority);
  assert.equal(charted.trigger.signals.breakout, 4);
});

t("legacy dead park (no expiresAt) expires 72h after its park time — never dead forever", () => {
  const dir5 = fs.mkdtempSync(path.join(os.tmpdir(), "bo-lp-"));
  const st = { published: [], parked: [{ key: "old|NETFLIX-TOP10", eventSlug: "old", form: "NETFLIX-TOP10", reason: "r", tries: 3, dead: true, at: "2026-07-13T00:00:00Z" }], zeroStreak: 0, daySpend: null, file: path.join(dir5, "store.json") };
  assert.equal(parkedTriesX(st, "old", "NETFLIX-TOP10", { now: new Date("2026-07-17T00:00:00Z") }), 0, "legacy dead park expired");
  fs.rmSync(dir5, { recursive: true, force: true });
});

// ── P3 PACING GOVERNOR — token bucket, behind/ahead, park cooldown ───────────────────────────────
console.log("P3 pacing — refill, expected curve, allowance, cooldown, cheap skip");

t("refill: LA-morning refill rate beats overnight; cap bounds the burst; a stall never windfalls", () => {
  const laMorning = Date.parse("2026-07-14T17:00:00Z"); // Tue 10:00 PT (morning part, 63%)
  const laNight = Date.parse("2026-07-14T10:00:00Z");   // Tue 03:00 PT (overnight, 5%)
  const m = refill({ tokens: 0, lastMs: laMorning - 3600e3 }, laMorning);
  const n = refill({ tokens: 0, lastMs: laNight - 3600e3 }, laNight);
  assert.ok(m.tokens > n.tokens * 5, `morning ${m.tokens} vs night ${n.tokens}`);
  const capped = refill({ tokens: 0, lastMs: laMorning - 40 * 3600e3 }, laMorning);
  assert.ok(capped.tokens <= PACE.cap + 1e-9, "cap respected after a long stall");
});

t("expectedByNow: grows through the LA day; Sun/Mon boosted, Wed/Thu trimmed", () => {
  const tueNoon = Date.parse("2026-07-14T19:00:00Z");  // Tue 12:00 PT
  const tueNight = Date.parse("2026-07-15T04:00:00Z"); // Tue 21:00 PT
  assert.ok(expectedByNow(tueNight) > expectedByNow(tueNoon), "monotonic through the day");
  const monNoon = Date.parse("2026-07-13T19:00:00Z");  // Mon 12:00 PT (×1.3)
  const wedNoon = Date.parse("2026-07-15T19:00:00Z");  // Wed 12:00 PT (×0.8)
  assert.ok(expectedByNow(monNoon) > expectedByNow(wedNoon), "day-of-week modulation");
});

t("allowance: BEHIND pace forces 1 even with an empty bucket; AHEAD with an empty bucket allows 0", () => {
  const noon = Date.parse("2026-07-14T19:00:00Z"); // Tue 12:00 PT — expected ≈ 9-10 by now
  const behind = allowance({ pace: { tokens: 0, lastMs: noon } }, 0, 3, noon);
  assert.equal(behind.behind, true);
  assert.ok(behind.allow >= 1, "always-post-when-behind");
  const ahead = allowance({ pace: { tokens: 0, lastMs: noon } }, 15, 3, noon);
  assert.equal(ahead.behind, false);
  assert.equal(ahead.allow, 0, "ahead + empty bucket = cheap skip");
  assert.equal(debit({ tokens: 2.5, lastMs: noon }, 2).tokens, 0.5);
});

t("parkCooling: a freshly-held entry cools for 2h (the retry-burn fix), then retries", () => {
  const st = { published: [], parked: [{ key: "ev|BO-UPDATE", eventSlug: "ev", form: "BO-UPDATE", reason: "words", tries: 1, at: "2026-07-17T12:00:00Z" }], file: "/tmp/never-saved.json" };
  assert.equal(parkCooling(st, "ev", "BO-UPDATE", { now: new Date("2026-07-17T13:00:00Z") }), true, "cooling at +1h");
  assert.equal(parkCooling(st, "ev", "BO-UPDATE", { now: new Date("2026-07-17T14:30:00Z") }), false, "retryable at +2.5h");
  assert.equal(parkCooling(st, "other", "BO-UPDATE", { now: new Date("2026-07-17T13:00:00Z") }), false, "no park = no cooling");
});

await ta("borun: AHEAD of pace with an empty bucket exits CHEAPLY — no finder, no model call", async () => {
  const dir6 = fs.mkdtempSync(path.join(os.tmpdir(), "bo-pace-"));
  const nowMs = Date.parse("2026-07-14T17:30:00Z"); // Tue 10:30 PT — expected ≈ 8
  const todayIso = new Date(nowMs).toISOString();
  const st = { published: Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, eventSlug: `k${i}`, form: "BO-UPDATE", at: todayIso })), parked: [], zeroStreak: 0, daySpend: null, pace: { tokens: 0, lastMs: nowMs }, file: path.join(dir6, "store.json") };
  const report = await boRun({
    storeImpl: st, trackedImpl: { films: {} }, nowMs,
    findImpl: async () => { throw new Error("finder must NOT run on a cheap pacing skip"); },
    runFindImpl: async () => { throw new Error("findrun must NOT run either"); },
    readQueueImpl: () => ({ events: [] }),
  });
  assert.ok(report.paced, "pacing consulted");
  assert.equal(report.paced.allow, 0);
  assert.equal(report.films, 0, "no discovery ran");
  assert.equal(report.blocked.length, 0, "no error path — a clean cheap skip");
  fs.rmSync(dir6, { recursive: true, force: true });
});

// ── P5 — dedicated event forms, trending TV, cross-namespace dedup, daily self-audit ─────────────
console.log("P5 — event forms, trending TV, dedup, self-audit");

t("dedicated event forms exist, are tracked (materiality applies), and KIND_FORM maps to them", () => {
  for (const f of ["BO-WEEKEND", "BO-MILESTONE", "BO-RECORD"]) {
    assert.ok(FORMS[f], f + " exists");
    assert.equal(FORMS[f].tracked, true, f + " is materiality-tracked");
    assert.equal(FORMS[f].streaming, undefined, f + " is a box-office form");
  }
  assert.equal(KIND_FORM.weekend, "BO-WEEKEND");
  assert.equal(KIND_FORM.milestone, "BO-MILESTONE");
  assert.equal(KIND_FORM.record, "BO-RECORD");
});

await ta("finder cross-namespace dedup: a milestone event on a COVERED film is dropped; an uncovered one flows as BO-MILESTONE", async () => {
  const queue = { events: [
    { slug: "covered-film-ev-milestone", filmTitle: "Covered Film", kind: "milestone", form: "BO-MILESTONE", priority: 60, sources: [] },
    { slug: "fresh-film-ev-milestone", filmTitle: "Fresh Film", kind: "milestone", form: "BO-MILESTONE", priority: 55, sources: [{ owner: "Variety", tier: 1, url: "https://x/1", title: "Fresh Film crosses $200M" }] },
  ] };
  const seen = { slugs: new Set(["covered-film-bo-update-d5"]), titles: new Set(["covered film"]) };
  const found = await findFilms({ providerStreamImpl: async () => [], queueImpl: () => queue, dryQueueMark: true, limit: 3, discoverImpl: async () => [], netflixImpl: async () => ({ films: [], tv: [] }), trendingTvImpl: async () => [], trackedImpl: { films: {} }, providersImpl: async () => null, dailyChartImpl: async () => ({ films: [] }), seen });
  assert.ok(!found.some((e) => e.film.title === "Covered Film"), "covered film's milestone event dropped");
  const fresh = found.find((e) => e.film.title === "Fresh Film");
  assert.ok(fresh, "uncovered milestone flows");
  assert.equal(fresh.angle.form, "BO-MILESTONE");
});

await ta("discoverTrendingTv: English-only, shaped; finder turns picks into TRENDING-TV (Netflix pick wins a title clash)", async () => {
  const fetchFix = async () => ({ ok: true, json: async () => ({ results: [
    { id: 1, name: "Hot Show", original_language: "en", first_air_date: "2026-06-01", popularity: 400, overview: "A hot show." },
    { id: 2, name: "外国剧", original_language: "zh", first_air_date: "2026-06-01", popularity: 900 },
  ] }) });
  const tv = await discoverTrendingTv({ fetchImpl: fetchFix });
  assert.equal(tv.length, 1); assert.equal(tv[0].title, "Hot Show");
  const found = await findFilms({ providerStreamImpl: async () => [], queueImpl: () => null, limit: 3, discoverImpl: async () => [], netflixImpl: async () => ({ films: [], tv: [{ title: "Hot Show", rank: 1, hours: "10 million hours", hoursRaw: 1e7 }] }), trendingTvImpl: async () => tv, trackedImpl: { films: {} }, providersImpl: async () => null, dailyChartImpl: async () => ({ films: [] }), seen: { slugs: new Set(), titles: new Set() } });
  const hotShows = found.filter((e) => e.film.title === "Hot Show");
  assert.equal(hotShows.length, 1, "no double-cover: Netflix pick wins");
  assert.equal(hotShows[0].film.via, "netflix-tv");
  const found2 = await findFilms({ providerStreamImpl: async () => [], queueImpl: () => null, limit: 3, discoverImpl: async () => [], netflixImpl: async () => ({ films: [], tv: [] }), trendingTvImpl: async () => tv, trackedImpl: { films: {} }, providersImpl: async () => null, dailyChartImpl: async () => ({ films: [] }), seen: { slugs: new Set(), titles: new Set() } });
  const solo = found2.find((e) => e.film.title === "Hot Show");
  assert.ok(solo && solo.film.via === "tmdb-tv-trending" && solo.angle.form === "TRENDING-TV", "TMDB pick flows when Netflix lacks it");
});

await ta("gatherStreaming: a non-Netflix trending pick resolves its REAL platform from TMDB providers, floors without one", async () => {
  const job1 = { film: { title: "Hot Show", netflix: null }, trigger: { sources: [] }, angle: { form: "TRENDING-TV" }, boxData: { providers: { stream: ["Disney+"], rent: [], buy: [] } } };
  await gatherRun(job1, { findImpl: async () => ({ blocked: true }), chatImpl: async () => ({ data: {} }) });
  assert.equal(job1.gathered.platform, "Disney+");
  assert.ok(!job1.gatherFail, "platform confirmed → no floor: " + job1.gatherFail);
  const job2 = { film: { title: "Hot Show", netflix: null }, trigger: { sources: [] }, angle: { form: "TRENDING-TV" }, boxData: { providers: { stream: [], rent: [], buy: [] } } };
  await gatherRun(job2, { findImpl: async () => ({ blocked: true }), chatImpl: async () => ({ data: {} }) });
  assert.ok(/no confirmed streaming platform/.test(job2.gatherFail || ""), "no platform → floor");
});

await ta("dailyAudit: samples yesterday's live articles once per day, maps issues to slugs, never re-runs", async () => {
  const dir7 = fs.mkdtempSync(path.join(os.tmpdir(), "bo-audit-"));
  fs.writeFileSync(path.join(dir7, "good-article.md"), "---\ntitle: X\n---\n\nA fine article body with its $10 million figure present.");
  const now = new Date("2026-07-18T16:00:00Z");
  const st = { published: [{ key: "k", eventSlug: "e", form: "BO-UPDATE", slug: "good-article", at: "2026-07-17T18:00:00Z" }], lastAuditDay: null };
  const fake = async () => ({ data: { issues: [{ i: 1, problem: "headline figure missing from body" }] }, usage: {} });
  const a1 = await dailyAudit({ store: st, now, chatImpl: fake, contentDir: dir7 });
  assert.equal(a1.sampled.length, 1);
  assert.equal(a1.issues[0].slug, "good-article");
  const a2 = await dailyAudit({ store: st, now, chatImpl: fake, contentDir: dir7 });
  assert.equal(a2, null, "one audit per day");
  fs.rmSync(dir7, { recursive: true, force: true });
});

// Mirror of assemble's internal label pattern, so the regression test asserts the same contract.
const isLabelLineX = (line) => /^(The (Movie|Series|Film)|Closing (Line|Thoughts?)|What It Is|The Cast|The Appeal|The Numbers|The Run|Lead)\s*(:|$)/.test(String(line).trim().replace(/^[*_]+|[*_]+$/g, "").trim());

// ── REGRESSION: bare label lines (the 2026-07-18 live audit finding) ─────────────────────────────
console.log("regression — bare template label lines (no colon)");

t("scaffoldViolations BLOCKS a bare label line with no colon (the live 'The Movie' / 'What It Is' leak)", () => {
  const fm = { keyTakeaways: ["a", "b", "c"], faq: [{ q: "q", a: "a" }, { q: "q2", a: "a2" }] };
  const filler = "word ".repeat(200);
  // Exactly the shape that shipped live: blank line, bare label, then the real lede.
  const bare = `\nThe Movie\nWoody and the gang are back. ${filler}`;
  assert.ok(scaffoldViolations(bare, fm).some((x) => /bare template label/.test(x)), "bare 'The Movie' must be caught");
  assert.ok(scaffoldViolations(`\nWhat It Is\nA documentary. ${filler}`, fm).some((x) => /bare template label/.test(x)), "bare 'What It Is' must be caught");
  // Colon form still caught (the original behavior must not regress).
  assert.ok(scaffoldViolations(`The Movie: Toy Story 5\n${filler}`, fm).some((x) => /bare template label/.test(x)));
  // A REAL sentence that merely starts with those words is NOT a violation.
  assert.ok(!scaffoldViolations(`The Movie was a monster hit this weekend. ${filler}`, fm).some((x) => /bare template label/.test(x)), "real prose must survive");
  // A markdown HEADING is legitimate structure, never a violation.
  assert.ok(!scaffoldViolations(`## The Numbers\n\nIt grossed a lot. ${filler}`, fm).some((x) => /bare template label/.test(x)), "headings must survive");
});

await ta("assembled article never ships a bare label line above the lede", async () => {
  const dir8 = fs.mkdtempSync(path.join(os.tmpdir(), "bo-label-"));
  const body = `\nThe Movie\nWoody, Buzz and the gang return for a new adventure that lands with real force. ${"word ".repeat(200)}`;
  const job = {
    film: { title: "Toy Story 5", tmdbId: 1, dailyChart: { cume: "$413,321,921", dailyGross: "$2,715,354", theaters: "3,575", dayInRelease: "Day 27" } },
    angle: { form: "BO-UPDATE" },
    trigger: { eventSlug: "toy-story-5-bo-update-d27", sources: [] },
    gathered: { numbers: [], records: [], cast: [], narrative: "", sources: [], outletCount: 3, cume: "$413,321,921" },
    boxData: {},
    article: { title: "Toy Story 5 Box Office Day 27", dek: "A dek about the run.", body, keyTakeaways: ["a", "b", "c"], faq: [{ q: "How much?", a: "A lot of money indeed, quite a lot." }, { q: "Where?", a: "In theaters everywhere right now." }], about: [], tags: ["Toy Story 5"] },
    qa: { score: 80 },
    image: { url: "https://x/i.jpg", alt: "Toy Story 5", credit: "TMDB", width: 100, height: 100 },
  };
  const out = await writeBoxOfficeArticle(job, { dir: dir8 });
  // The assembled markdown is out.md (frontmatter + body); take the body after the closing '---'.
  const mdLines = String(out.md || "").split("\n");
  const fmEnd = mdLines.findIndex((l, i) => i > 0 && l.trim() === "---");
  const bodyLines = mdLines.slice(fmEnd + 1);
  const firstProse = bodyLines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))[0] || "";
  assert.ok(!isLabelLineX(firstProse), `body must not open with a bare label, got: "${firstProse}"`);
  assert.ok(/Woody/.test(firstProse), "the real lede must lead: " + firstProse);
  assert.ok(!bodyLines.some((l) => isLabelLineX(l)), "no bare label anywhere in the body");
  fs.rmSync(dir8, { recursive: true, force: true });
});

await ta("cost pre-gate: an already-covered chart film is skipped BEFORE any paid call (no gatherer, no data)", async () => {
  const dir9 = fs.mkdtempSync(path.join(os.tmpdir(), "bo-pre-"));
  const nowMs = Date.parse("2026-07-17T20:00:00Z");
  const st = { published: [], parked: [], zeroStreak: 0, daySpend: null, pace: { tokens: 4, lastMs: nowMs }, lastAuditDay: null, file: path.join(dir9, "store.json") };
  // Tracked: Moana covered earlier TODAY at $59.2M; the chart still shows the same cume.
  const tracked = { films: { moana: { title: "Moana", lastDomesticRaw: 59_200_000, lastArticleAt: "2026-07-17T14:00:00Z", articles: [] } } };
  let paidCalls = 0;
  const found = [{
    film: { title: "Moana", tmdbId: null, via: "daily-chart", dailyChart: { cume: "$59,200,000", dailyGross: "$1,000,000", dayInRelease: "Day 6" } },
    trigger: { eventSlug: "moana-bo-update", priority: 90, sources: [], signals: {} },
    angle: { form: "BO-UPDATE" },
  }];
  const report = await boRun({
    storeImpl: st, trackedImpl: tracked, nowMs, limit: 1,
    findImpl: async () => found,
    readQueueImpl: () => ({ events: [] }), runFindImpl: async () => ({ events: [] }),
    dataImpl: async () => { paidCalls++; }, gatherImpl: async () => { paidCalls++; },
    synthImpl: async () => { paidCalls++; }, writeArticleImpl: async () => { paidCalls++; },
    qaReviewImpl: async () => { paidCalls++; }, imageImpl: async () => { paidCalls++; },
  });
  assert.equal(paidCalls, 0, "NO paid stage may run for an already-covered chart film");
  assert.ok(report.skipped.some((s) => /pre-gate \(free\).*already covered today/.test(s.reason)), "skipped by the free pre-gate: " + JSON.stringify(report.skipped));
  fs.rmSync(dir9, { recursive: true, force: true });
});

await ta("cost pre-gate does NOT block a genuinely material chart update (the number advanced)", async () => {
  const dir10 = fs.mkdtempSync(path.join(os.tmpdir(), "bo-pre2-"));
  const nowMs = Date.parse("2026-07-17T20:00:00Z");
  const st = { published: [], parked: [], zeroStreak: 0, daySpend: null, pace: { tokens: 4, lastMs: nowMs }, lastAuditDay: null, file: path.join(dir10, "store.json") };
  const tracked = { films: { moana: { title: "Moana", lastDomesticRaw: 54_900_000, lastArticleAt: "2026-07-16T14:00:00Z", articles: [] } } };
  let reachedData = false;
  const found = [{
    film: { title: "Moana", tmdbId: null, via: "daily-chart", dailyChart: { cume: "$59,200,000", dailyGross: "$4,300,000", dayInRelease: "Day 6" } },
    trigger: { eventSlug: "moana-bo-update", priority: 90, sources: [], signals: {} },
    angle: { form: "BO-UPDATE" },
  }];
  await boRun({
    storeImpl: st, trackedImpl: tracked, nowMs, limit: 1,
    findImpl: async () => found,
    readQueueImpl: () => ({ events: [] }), runFindImpl: async () => ({ events: [] }),
    dataImpl: async (job) => { reachedData = true; job.boxData = {}; },
    gatherImpl: async (job) => { job.gatherFail = "under floor: stop here for the test"; },
  });
  assert.ok(reachedData, "a material advance ($54.9M → $59.2M, new day) must proceed past the pre-gate");
  fs.rmSync(dir10, { recursive: true, force: true });
});

// ── BULLETPROOFING — escalating cooldown, film attempt budget, hardened verdict wall ─────────────
console.log("bulletproofing — escalating cooldown, film budget, verdict wall");

t("parkCooling ESCALATES: 2h after try 1, 4h after try 2", () => {
  const mk = (tries) => ({ published: [], parked: [{ key: "e|BO-UPDATE", eventSlug: "e", form: "BO-UPDATE", tries, at: "2026-07-18T12:00:00Z" }], file: "/tmp/x.json" });
  assert.equal(parkCooling(mk(1), "e", "BO-UPDATE", { now: new Date("2026-07-18T14:30:00Z") }), false, "try1 free after 2.5h");
  assert.equal(parkCooling(mk(2), "e", "BO-UPDATE", { now: new Date("2026-07-18T14:30:00Z") }), true, "try2 still cooling at 2.5h");
  assert.equal(parkCooling(mk(2), "e", "BO-UPDATE", { now: new Date("2026-07-18T16:30:00Z") }), false, "try2 free after 4.5h");
});

t("film attempt budget: 3 paid tries per film per LA day across ALL slugs/forms, resets on day roll", () => {
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "bo-budget-"));
  const st = { published: [], parked: [], attempts: null, file: path.join(dirB, "store.json") };
  const now = new Date("2026-07-18T18:00:00Z");
  assert.equal(filmAttemptBudgetLeft(st, "The Odyssey", { now }), 3);
  bumpFilmAttempt(st, "The Odyssey", { now });           // ev-opening
  bumpFilmAttempt(st, "the odyssey", { now });           // ev-weekend (case-insensitive same film)
  bumpFilmAttempt(st, "The Odyssey", { now });           // ev-record
  assert.equal(filmAttemptBudgetLeft(st, "The Odyssey", { now }), 0, "4th attempt refused");
  assert.equal(filmAttemptBudgetLeft(st, "Moana", { now }), 3, "other films unaffected");
  const nextDay = new Date("2026-07-19T18:00:00Z");
  assert.equal(filmAttemptBudgetLeft(st, "The Odyssey", { now: nextDay }), 3, "resets at LA day roll");
  fs.rmSync(dirB, { recursive: true, force: true });
});

t("hardened verdict wall: the legacy-sweep phrasings are now cut (attribution still rescues)", () => {
  const cuts = verdictCuts("The film faces an uphill battle to achieve lasting success. Its struggle to differentiate itself has impacted its reception. Many viewers see it as a near-duplicate of the original.");
  assert.ok(cuts.length >= 2, "unattributed sweep phrasings cut: " + cuts.length);
  const rescued = verdictCuts("According to Variety, the film faces an uphill battle this weekend.");
  assert.equal(rescued.length, 0, "attributed verdict stays — that is journalism");
});

// ── 18h-AUDIT FIXES — chart updates exempt from budget, listicle titles rejected ──────────────────
console.log("18h-audit fixes — budget exemption, listicle title guard");

await ta("CHART UPDATE with a material number is NEVER blocked by an exhausted event budget", async () => {
  const dirC = fs.mkdtempSync(path.join(os.tmpdir(), "bo-exempt-"));
  const nowMs = Date.parse("2026-07-18T20:00:00Z");
  // film already burned its 3 EVENT attempts today
  const st = { published: [], parked: [], zeroStreak: 0, daySpend: null, pace: { tokens: 4, lastMs: nowMs },
    attempts: { laDay: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(nowMs)), byFilm: { obsession: 3 } },
    file: path.join(dirC, "store.json") };
  const chartFilm = { title: "Obsession", dailyChart: { cume: "$256,781,260", dailyGross: "$790,000", dayInRelease: "62", theaters: "1,524" } };
  const found = [{ film: chartFilm, trigger: { eventSlug: "obsession-bo-update", title: "Obsession", priority: 90, signals: {}, sources: [] }, angle: { form: "BO-UPDATE", queries: [] } }];
  let gathererReached = false;
  const report = await boRun({
    storeImpl: st, nowMs, limit: 1,
    trackedImpl: { films: { obsession: { title: "Obsession", lastDomesticRaw: 255400000, lastArticleAt: "2026-07-16T12:00:00Z" } } },
    findImpl: async () => found,
    readQueueImpl: () => ({ events: [] }), runFindImpl: async () => ({ events: [] }),
    dataImpl: async (job) => { job.boxData = null; return job; },
    gatherImpl: async (job) => { gathererReached = true; job.gatherFail = "under floor: stop here for the test"; return job; },
  });
  assert.ok(gathererReached, "chart update must REACH paid work despite the exhausted event budget");
  const budgetSkip = (report.skipped || []).find((s) => /attempt budget/.test(s.reason || ""));
  assert.ok(!budgetSkip, "no budget skip for a chart update: " + JSON.stringify(report.skipped));
  fs.rmSync(dirC, { recursive: true, force: true });
});

t("listicle/descriptive phrases are rejected as film titles (they burned 4 paid attempts live)", () => {
  for (const bad of [
    "The Best 4-Part Sci-Fi Book Adaptation of the Last 15 Years",
    "the best sci-fi book adaptation of the last 15 years",
    "A Perfect Zombie Movie",
    "The Greatest Horror Movies of All Time",
    "Movies Like Interstellar You Should Watch Right Now",
  ]) assert.equal(isPlausibleFilmTitle(bad), false, "should reject: " + bad);
  for (const good of ["The Odyssey", "Moana", "Toy Story 5", "Jackass: Best and Last", "Spider-Man: Brand New Day", "Scary Movie"])
    assert.equal(isPlausibleFilmTitle(good), true, "should accept: " + good);
});

t("categorize marks a listicle-phrase item irrelevant so it never reaches a paid stage", async () => {
  // (sync wrapper around the async assertion via the shared helper is unnecessary — validated in ta below)
  assert.equal(isPlausibleFilmTitle(""), false);
  assert.equal(isPlausibleFilmTitle("A".repeat(80)), false, "absurdly long title rejected");
});

// ── VOLUME ENGINE — chart parser, pool sizing, multi-platform streaming ──────────────────────────
console.log("volume engine — parser, pool, streaming supply");

t("parseChartText: reads a real chart table row-for-row, including '-' ranks and blank columns", () => {
  const text = [
    "Daily Domestic Box Office Friday, July 17, 2026", "Reporting movies: 3",
    "Rank","Prev","Title","Gross","Daily","Change","Theaters","Total Gross","Days in Release",
    "1","(new)","The Odyssey","$51,280,000","","","3,919","$13,085","$51,280,000","1",
    "2","(1)","Moana","$5,500,000","+43%","-70%","4,200","$1,310","$68,581,410","8",
    "-","(17)","Star Wars: The Mandalorian and Grogu","$41,000","+120%","-9%","90","$456","$177,455,904","57",
  ].join("\n");
  const rows = parseChartText(text);
  assert.equal(rows.length, 3, "all three rows incl. the '-' rank");
  assert.equal(rows[0].title, "The Odyssey");
  assert.equal(rows[0].dailyGross, "$51,280,000");      // the #1 opening the LLM extractor silently dropped
  assert.equal(rows[0].cume, "$51,280,000");
  assert.equal(rows[0].theaters, "3,919");
  assert.equal(rows[0].daysInRelease, 1);
  assert.equal(rows[1].dailyChangePct, "+43%");          // blank columns never shift a field
  assert.equal(rows[1].cume, "$68,581,410");
  assert.equal(rows[2].rank, null);
  assert.equal(rows[2].daysInRelease, 57);
  const meta = chartMetaFromText(text);
  assert.equal(meta.reportedRows, 3);
  assert.equal(meta.date, "2026-07-17", "the page's OWN date, not a computed one");
});

t("platformGuard: a CHARACTER named Max no longer reads as HBO Max; a real service claim still blocks", () => {
  const cast = { body: "Julian Feder as Max leads the ensemble, with Chi McBride as Max Williams." };
  assert.equal(platformGuardX(cast, ["netflix"]).ok, true, "character name is not a platform claim");
  const claim = { body: "The film is now streaming on Max for subscribers." };
  assert.equal(platformGuardX(claim, ["netflix"]).ok, false, "an actual streaming claim still blocks");
  const hbo = { body: "It arrives on HBO Max next week." };
  assert.equal(platformGuardX(hbo, ["netflix"]).ok, false, "HBO Max still blocks");
});

t("qa word floor counts the canonical numbers block the reader actually receives", () => {
  const canon = canonicalFiguresX({ gathered: { cume: "$100,000,000", numbers: ["$100,000,000"] },
    boxData: { worldwide: "$200 million", budget: "$50 million" },
    film: { title: "Test Film", dailyChart: { cume: "$100,000,000", dailyGross: "$1,000,000", theaters: "3,000", dayInRelease: "Day 10" } } });
  const words = numbersSectionX(canon, "Test Film").split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 35, `the appended block is substantial (${words} words) — QA measured ~${words} words short before`);
});

t("a section EMPTIED by the walls is dropped, not held — the heading goes, the article lives", () => {
  const para = "A full opening paragraph carrying real substance about the film, its cast, its premise and how it "
    + "performed in theaters over the past week, written at enough length to clear the floor comfortably for any "
    + "reader who wants to understand what actually happened here and why the studio behind it cares so much about "
    + "the result it posted. It continues with further detail about the run, the theater count, the trajectory of "
    + "the release and the way the audience turned up across the opening days of the engagement in question. ";
  const body = para + para
    + "\n\n## A Daunting Financial Voyage\n\n## The Real Section\n\nThis section still carries prose and must survive.";
  const out = buildBoxOfficeMarkdown({
    article: { title: "Test Film Box Office Day 5", metaTitle: "T", dek: "d", metaDescription: "m", body,
      keyTakeaways: ["a", "b", "c"], faq: [{ q: "x", a: "y" }, { q: "z", a: "w" }], about: [], tags: ["t"] },
    trigger: { eventSlug: "t-bo-update", title: "Test Film" }, angle: { form: "BO-UPDATE" },
    film: { title: "Test Film", dailyChart: { cume: "$100,000,000", dailyGross: "$1,000,000", theaters: "3,000", dayInRelease: "Day 5" } },
    gathered: { cume: "$100,000,000", numbers: ["$100,000,000"], sources: [] },
    boxData: { worldwide: "$200 million", budget: "$50 million" },
    image: null, dateISO: new Date().toISOString(),
  });
  assert.ok(!/A Daunting Financial Voyage/.test(out.md), "bare heading left by the cutters is removed");
  assert.ok(/## The Real Section/.test(out.md), "a section WITH prose is untouched");
  assert.ok(/## At the Box Office/.test(out.md), "the canonical numbers block still lands");
  assert.equal(out.scaffold.length, 0, "no scaffold violation => this publishes instead of holding: " + JSON.stringify(out.scaffold));
});

t("materiality FAILS CLOSED when tracked state is lost — the live-duplicate root cause", () => {
  // 3 duplicate pairs reached the live site this way: a rebase conflict discarded tracked.json, the film
  // looked brand-new, and the SAME day republished with a byte-identical total.
  const ledger = [{ film: "Young Washington", slug: "young-washington-box-office-day-13-domestic-total-climbs-to-36-5-million" }];
  const mk = (cume, day) => ({ title: "Young Washington", dailyChart: { cume, dayInRelease: day } });
  const same = isMaterialX(mk("$36,541,620", "Day 13"), { cume: "$36,541,620" }, {}, { films: {} }, { publishedLedger: ledger });
  assert.equal(same.material, false, "the already-published figure must NOT republish: " + same.reason);
  // the slug only encodes 0.1M precision, so the comparison must happen at THAT precision
  const higher = isMaterialX(mk("$38,505,648", "Day 15"), { cume: "$38,505,648" }, {}, { films: {} }, { publishedLedger: ledger });
  assert.equal(higher.material, true, "a genuinely higher figure still publishes");
  const fresh = isMaterialX({ title: "Brand New Movie", dailyChart: { cume: "$10,000,000", dayInRelease: "Day 1" } },
    { cume: "$10,000,000" }, {}, { films: {} }, { publishedLedger: ledger });
  assert.equal(fresh.material, true, "a film with no ledger row is still a first sighting");
});

// ── STRUCTURAL HARDENING — the lane must be able to tell when it is broken ───────────────────────
console.log("structural — fault recording, count assertions, state-loss breaker");

t("assertCount records a shortfall instead of accepting it silently (the 6-of-17 chart bug)", () => {
  resetFaultsX();
  assert.equal(assertCountX("chart", 17, 17), true, "a full parse is silent");
  assert.equal(faultReportX().count, 0);
  assert.equal(assertCountX("chart", 6, 17, { label: "chart rows" }), false, "a shortfall is caught");
  const r = faultReportX();
  assert.equal(r.count, 1);
  assert.match(r.faults[0].message, /expected 17 chart rows, got 6/);
});

t("loadJsonState distinguishes FIRST RUN from LOST MEMORY", () => {
  resetFaultsX();
  const dirH = fs.mkdtempSync(path.join(os.tmpdir(), "bo-health-"));
  const absent = loadJsonStateX(path.join(dirH, "nope.json"), { films: {} }, { stage: "tracked" });
  assert.equal(absent.lost, false, "an absent file is a first run, not a fault");
  assert.equal(faultReportX().count, 0, "and it stays silent");
  const bad = path.join(dirH, "corrupt.json");
  fs.writeFileSync(bad, "{ not json at all");
  const lost = loadJsonStateX(bad, { films: {} }, { stage: "tracked" });
  assert.equal(lost.lost, true, "an unreadable EXISTING file is amnesia");
  assert.equal(faultReportX().bySeverity.critical, 1, "and it is CRITICAL");
  fs.rmSync(dirH, { recursive: true, force: true });
});

await ta("borun REFUSES TO PUBLISH on lost state — the duplicate-article circuit breaker", async () => {
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "bo-breaker-"));
  fs.writeFileSync(path.join(dirB, "store.json"), "{ corrupted by a rebase conflict");
  const store = loadStoreX(path.join(dirB, "store.json"));
  assert.equal(store.lost, true, "precondition: the store reports amnesia");
  const report = await boRun({
    storeImpl: store,
    trackedImpl: { films: {}, lost: false },
    findImpl: async () => { throw new Error("finder must NOT run behind the breaker"); },
    runFindImpl: async () => { throw new Error("findrun must NOT run behind the breaker"); },
    readQueueImpl: () => ({ events: [] }),
    nowMs: Date.parse("2026-07-19T18:00:00Z"),
  });
  assert.ok(report.stateLost, "the tick records WHY it stopped");
  assert.equal(report.published.length, 0, "an amnesiac tick publishes NOTHING");
  assert.equal(report.films, 0, "and never even reaches discovery");
  assert.equal(report.degraded, true, "the run report is marked degraded");
  fs.rmSync(dirB, { recursive: true, force: true });
});

t("every run report carries a fault summary, so a degraded tick cannot look clean", () => {
  resetFaultsX();
  faultX("test-stage", "something degraded", { severity: "warn" });
  const r = faultReportX();
  assert.equal(r.count, 1);
  assert.equal(r.bySeverity.warn, 1);
  assert.equal(r.faults[0].stage, "test-stage");
});

await ta("WIRING: a real publish writes a FIGURE + film key to the ledger (the test that was missing)", async () => {
  // My earlier duplicate test fed a HAND-WRITTEN 74-char slug and passed — against data the real ledger
  // could never produce, because recordPublished wrote no figure at all and slugify truncates at 80
  // chars. This drives the ACTUAL publish path and asserts what the ledger really contains.
  const dirW = fs.mkdtempSync(path.join(os.tmpdir(), "bo-wiring-"));
  const store = { published: [], parked: [], zeroStreak: 0, daySpend: null, pace: null, lastAuditDay: null, attempts: null, lost: false, file: path.join(dirW, "store.json") };
  const tracked = { films: {}, file: path.join(dirW, "tracked.json"), lost: false };
  const film = { title: "Wiring Test Film", tmdbId: 999001, dailyChart: { cume: "$50,000,000", dailyGross: "$1,000,000", theaters: "3,000", dayInRelease: "Day 9", date: "2026-07-19" } };
  const para = "A complete paragraph of real prose about this film and how it performed in theaters over the past week, long enough to clear the floor for any reader. ";
  await boRun({
    storeImpl: store, trackedImpl: tracked, nowMs: Date.parse("2026-07-19T18:00:00Z"), hero: false,
    readQueueImpl: () => ({ events: [] }), runFindImpl: async () => ({ events: [] }),
    findImpl: async () => [{
      film, trigger: { eventSlug: "wiring-test-film-bo-update", title: film.title, primaryEntity: film.title, category: "movies", subcategory: "box-office", priority: 90, signals: {}, eventType: "boxoffice", sources: [] },
      angle: { form: "BO-UPDATE", workingTitle: "wiring", star: "", queries: [] },
    }],
    dataImpl: async (j) => { j.boxData = { worldwide: "$90 million", budget: "$40 million" }; return j; },
    gatherImpl: async (j) => { j.gathered = { cume: "$50,000,000", numbers: ["$50,000,000"], records: [], cast: [], narrative: "", sources: [], outletCount: 1 }; return j; },
    synthImpl: async (j) => { j.brief = { hook: "h", beats: ["b"] }; return j; },
    writeArticleImpl: async (j) => {
      j.article = { title: "Wiring Test Film Box Office Day 9", metaTitle: "Wiring Test Film Hits $50M", dek: "d",
        metaDescription: "Wiring Test Film has grossed fifty million dollars domestically through day nine of its theatrical run.",
        body: para + para + para, keyTakeaways: ["a", "b", "c"], faq: [{ q: "q1", a: "a1" }, { q: "q2", a: "a2" }], about: [], tags: ["t"] };
      return j;
    },
    qaReviewImpl: async (j) => { j.qa = { score: 85, pass: true, judged: false, subscores: {}, deterministic: {}, hardBlocks: [], cutClaims: [], strengths: [], weaknesses: [] }; return j; },
    imageImpl: async (j) => { j.image = null; return j; },
    addLinksImpl: (b) => b,
    publishImpl: () => ({ slug: "wiring-test-film-box-office-day-9", ok: true, frontmatter: {}, consistency: { ok: true }, scaffold: [] }),
    dailyAuditImpl: async () => null,
  });
  // NB: borun appends the materiality tag to the eventSlug (…-bo-update-d9), so match on the FILM.
  const row = (store.published || []).find((r) => r.film === "Wiring Test Film");
  assert.ok(row, "the publish was recorded at all: " + JSON.stringify(store.published));
  assert.ok(Number.isFinite(row.headlineNumberRaw), "ledger row carries a REAL FIGURE, not a slug to re-parse: " + JSON.stringify(row));
  assert.equal(row.headlineNumberRaw, 50000000);
  assert.equal(row.filmKey, "999001", "keyed identically to trackKey(film) so a tmdbId film actually matches");
  const seen = lastPublishedRawForX(film, store.published);
  assert.ok(seen && seen.raw === 50000000, "lastPublishedRawFor resolves the row it just wrote: " + JSON.stringify(seen));
  fs.rmSync(dirW, { recursive: true, force: true });
});

t("NO NEW SILENT CATCHES on supply/accuracy paths — the guard that keeps this class dead", () => {
  // 62 of 64 catch sites in this lane once swallowed their error silently, and that single property
  // produced the chart bug (6 of 17 rows for days), the duplicate articles (an unreadable ledger reading
  // as "no films ever covered") and the retries=0 outage (18 calls, 18 errors, $0, indistinguishable
  // from a quiet news day). This fails the build if a NEW one appears on a supply/accuracy path.
  // RULE: a catch body must REPORT (fault/console/annotation) or RETHROW. Nothing else counts.
  // NB: an earlier version of this test only matched empty bodies and missed `catch { return []; }` —
  // it passed its own negative control. Brace-matching the real body is what makes it honest.
  // fileURLToPath, NOT .pathname: this project's directory contains a space, so .pathname hands back a
  // PERCENT-ENCODED path ("/Users/.../Movie%20News%20site/..."). The first version of this guard used
  // .pathname, every readFileSync threw, the catch skipped every file, and the guard passed while
  // checking NOTHING — the precise failure mode it exists to prevent, inside itself.
  const laneDir = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  const WATCHED = ["agents/finder.mjs", "netflix.mjs", "discover.mjs", "tmdbStreaming.mjs",
    "dailyChart.mjs", "find/sources.mjs", "find/events.mjs", "find/findrun.mjs", "tracker.mjs", "store.mjs"];
  const bodyOfCatch = (src, at) => {              // at = index of the "{" opening the catch body
    let depth = 0;
    for (let i = at; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(at + 1, i); }
    }
    return "";
  };
  const offenders = [];
  let scanned = 0;
  for (const rel of WATCHED) {
    // FAIL CLOSED: an unreadable watched file means the guard is blind, which must never look like a pass.
    let src;
    try { src = fs.readFileSync(path.join(laneDir, rel), "utf8"); }
    catch (e) { assert.fail(`guard could not read ${rel} (${e?.message || e}) — it would be silently checking nothing`); }
    scanned++;
    for (const m of src.matchAll(/catch\s*(?:\([^)]*\))?\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      const body = bodyOfCatch(src, open);
      // A catch may be silent ONLY if it says why, inline, with `silent-ok: <reason>`. That turns every
      // remaining silent catch from an accident into a decision someone wrote down and can be argued with.
      if (/\bfault\(|console\.|::warning|::error|\bthrow\b|silent-ok:/.test(body)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      const ctx = src.slice(Math.max(0, m.index - 220), m.index);
      // genuinely benign: local retry loops and cache/existence probes that have an outer reporter
      if (/await sleep\(|setTimeout\(|readChartCache|writeChartCache|existsSync/.test(ctx + body)) continue;
      offenders.push(`${rel}:${line}`);
    }
  }
  assert.equal(scanned, WATCHED.length, `guard scanned ${scanned} of ${WATCHED.length} watched files`);
  assert.equal(offenders.length, 0,
    "silent catch(es) on a supply/accuracy path — route through health.fault(): " + offenders.join(", "));
});

t("firstJsonObject salvages the EXACT shapes that broke every finder call in production", () => {
  // Live symptom, every tick for days: model:finder all models failed —
  //   "Unexpected non-whitespace character after JSON at position 244"
  // Cause: pipeline/lib/openrouter.mjs parseJson() falls back to indexOf("{")..lastIndexOf("}"), so a
  // response holding TWO objects (or one object then prose containing a brace) becomes valid JSON PLUS
  // trailing content. Reproduced character-for-character before writing this.
  assert.deepEqual(firstJsonObjectX('{"picks":[{"i":0}]}\n{"picks":[{"i":1}]}'), { picks: [{ i: 0 }] });
  assert.deepEqual(firstJsonObjectX('{"picks":[{"i":0}]}\nNote: chose films {see chart}.'), { picks: [{ i: 0 }] });
  assert.deepEqual(firstJsonObjectX('```json\n{"picks":[{"i":2}]}\n```\nWant more?'), { picks: [{ i: 2 }] });
  // a brace INSIDE a quoted string must not end the object early
  assert.deepEqual(firstJsonObjectX('{"t":"Weird } Title","i":3}\njunk'), { t: "Weird } Title", i: 3 });
  // escaped quote must not flip string state
  assert.deepEqual(firstJsonObjectX('{"t":"a \\" b"}\njunk'), { t: 'a " b' });
  assert.equal(firstJsonObjectX("no json here"), null);
  assert.equal(firstJsonObjectX('{"unterminated": '), null);

  // THE ACTUAL LIVE FAILURE (confirmed by running the real finder): finder maxTokens was 900, sized for
  // a 6-8 film pool, while the volume work grew the pool to ~43 films (~60 tokens per pick). The JSON
  // array was TRUNCATED mid-element on BOTH models every single tick:
  //   "Expected ',' or ']' after array element in JSON at position 2459 / 3041"
  // maxTokens is now 4000 (the real fix); this salvages a truncated reply rather than losing it all.
  const truncated = '{"picks":[{"i":0,"workingTitle":"A","queries":["a","b"]},'
    + '{"i":1,"workingTitle":"B","queries":["c","d"]},{"i":2,"form":"BO-UPD';
  const salv = firstJsonObjectX(truncated);
  assert.equal(salv.picks.length, 2, "keeps the picks that arrived complete");
  assert.deepEqual(salv.picks.map((p) => p.workingTitle), ["A", "B"]);
  assert.ok(!salv.picks.some((p) => p.i === 2), "drops the half-written element — never invents one");
  // nothing complete yet => nothing to salvage (must NOT fabricate an empty success)
  assert.equal(firstJsonObjectX('{"picks":[{"i":0'), null);
});

await ta("agentChat SALVAGES a malformed-JSON response instead of failing the whole call", async () => {
  // The first chat() call throws exactly as the shared parseJson does; the salvage re-asks the SAME
  // model with json:false and extracts the first balanced object. Before this, one unparseable response
  // burned the primary AND the fallback and returned nothing.
  let calls = 0;
  const chatImpl = async ({ json }) => {
    calls++;
    if (json) throw new Error("Unexpected non-whitespace character after JSON at position 244");
    return { text: '{"picks":[{"i":0,"form":"BO-UPDATE"}]}\nTrailing commentary {oops}.', usage: {} };
  };
  const res = await agentChatX("finder", { system: "s", user: "u" }, { chatImpl });
  assert.deepEqual(res.data, { picks: [{ i: 0, form: "BO-UPDATE" }] });
  assert.equal(calls, 2, "one failed JSON attempt then one raw-text salvage on the SAME model");
});

await ta("ONE STORY = ONE URL: a chart film gets ONE stable tracker slug that updates in place, date preserved, history grown", async () => {
  // Owner directive 2026-07-24: one canonical <film>-box-office-tracker per film; day-N URLs never minted
  // again; the tracker refreshes in place daily (original date kept, `updated` bumped, a Daily Tracking
  // table that accumulates). This replaces the flood of 64 near-duplicate day-N URLs.
  const dirW = fs.mkdtempSync(path.join(os.tmpdir(), "bo-tracker-"));
  const para = "A full opening paragraph carrying real substance about the film, its cast, its premise and how "
    + "it performed in theaters over the past week, written at enough length to clear the floor comfortably "
    + "for any reader who wants to understand what happened and why the studio behind it cares. ";
  const mk = (day, cume, daily, dom, dateISO) => ({
    article: { title: `Test Film Box Office Day ${day}`, metaTitle: "T", dek: "d", metaDescription: "m",
      body: para + para + para, keyTakeaways: ["a", "b", "c"], faq: [{ q: "x", a: "y" }, { q: "z", a: "w" }], about: [], tags: ["t"] },
    trigger: { eventSlug: `test-film-bo-update-d${day}`, title: "Test Film" }, angle: { form: "BO-UPDATE" },
    film: { title: "Test Film", dailyChart: { cume, dailyGross: daily, theaters: "3,000", dayInRelease: `Day ${day}` } },
    gathered: { cume, numbers: [cume], sources: [] }, boxData: { worldwide: "$200 million", budget: "$50 million" },
    image: null, dateISO, dir: dirW,
  });

  const d1 = writeBoxOfficeArticle(mk(5, "$54,900,000", "$1,000,000", "$54.9 million", "2026-07-16T09:00:00.000Z"));
  assert.equal(d1.written, true, "tracker created: " + JSON.stringify(d1.scaffold || d1.consistency));
  assert.ok(d1.slug.endsWith("-box-office-tracker"), "stable tracker slug, no day/number: " + d1.slug);
  const after1 = matter.read(d1.path);
  assert.equal(after1.data.boxOfficeTracker, true);

  const d2 = writeBoxOfficeArticle(mk(8, "$68,600,000", "$5,500,000", "$68.6 million", "2026-07-19T09:00:00.000Z"));
  assert.equal(d2.written, true, "day 8 UPDATES IN PLACE, not refused");
  assert.equal(d2.slug, d1.slug, "same URL — no new file");
  assert.equal(fs.readdirSync(dirW).length, 1, "still exactly ONE file for the film");
  const after2 = matter.read(d2.path);
  assert.equal(after2.data.date, after1.data.date, "original publish date PRESERVED across the update");
  assert.notEqual(after2.data.updated, after1.data.updated, "`updated` bumped to the new date");
  assert.ok(/## Daily Tracking/.test(after2.content), "Daily Tracking table present");
  assert.ok(/\|\s*5\s*\|/.test(after2.content) && /\|\s*8\s*\|/.test(after2.content), "BOTH day 5 and day 8 rows accumulated");
  fs.rmSync(dirW, { recursive: true, force: true });
});

await ta("NO-REWRITE still holds for NON-tracker articles (a feature must not silently overwrite a live file)", async () => {
  const dirW = fs.mkdtempSync(path.join(os.tmpdir(), "bo-norewrite-"));
  const para = "A full opening paragraph carrying real substance about the film, its cast, its premise and how "
    + "it performed in theaters over the past week, written at enough length to clear the floor comfortably "
    + "for any reader who wants to understand what happened and why the studio behind it cares. ";
  const args = {
    article: { title: "Test Feature About A Film", metaTitle: "T", dek: "d", metaDescription: "m",
      body: para + para + para + para, keyTakeaways: ["a", "b", "c"], faq: [{ q: "x", a: "y" }, { q: "z", a: "w" }], about: [], tags: ["t"] },
    trigger: { eventSlug: "t-feature", title: "Test Feature" }, angle: { form: "BO-OPENING" },
    film: { title: "Test Feature About A Film" }, // NO dailyChart => not a tracker
    gathered: { openingWeekend: "$45 million", numbers: ["$45 million"], sources: [] },
    boxData: { worldwide: "$200 million", budget: "$50 million" },
    image: null, dateISO: new Date().toISOString(), dir: dirW,
  };
  const first = writeBoxOfficeArticle(args);
  assert.equal(first.written, true, "a NEW feature writes normally: " + JSON.stringify(first.scaffold || first.consistency));
  const before = fs.readFileSync(first.path, "utf8");
  const second = writeBoxOfficeArticle({ ...args, article: { ...args.article, body: para + para + para + para + "CHANGED." } });
  assert.equal(second.written, false, "the second write is REFUSED (non-tracker)");
  assert.equal(second.refusedRewrite, true);
  assert.equal(fs.readFileSync(first.path, "utf8"), before, "the published feature is byte-identical — untouched");
  fs.rmSync(dirW, { recursive: true, force: true });
});

await ta("a role WITH a fallback degrades (warn); a role WITHOUT one is critical — the false-alarm fix", async () => {
  // The owner's "not posting" emails came from boxoffice-drip.yml failing the job on report.degraded,
  // which was set by ANY role exhausting its models. finder has a deterministic fallback and chart
  // candidates never touch it, so its failure is a quality degrade, not a dead tick. Measured before the
  // fix: 34 of 44 ticks "degraded" on a day the lane published its entire available supply.
  const boom = async () => { throw new Error("empty completion"); };
  resetFaultsX();
  await agentChatX("finder", { system: "s", user: "u" }, { chatImpl: boom }).catch(() => {});
  const finderFaults = faultReportX().faults.filter((f) => f.stage === "model:finder");
  assert.equal(finderFaults.length, 1);
  assert.notEqual(finderFaults[0].severity, "critical", "finder has a fallback => must NOT fail the job");

  resetFaultsX();
  await agentChatX("writer", { system: "s", user: "u" }, { chatImpl: boom }).catch(() => {});
  const writerFaults = faultReportX().faults.filter((f) => f.stage === "model:writer");
  assert.equal(writerFaults[0].severity, "critical", "no writer => no article => genuinely critical");

  // and the message must name BOTH models' errors, not just the fallback's
  assert.ok(/amazon\/nova-micro-v1/.test(finderFaults[0].message) && /gemini/.test(finderFaults[0].message),
    "both models reported: " + finderFaults[0].message);
});

// ── summary ──────────────────────────────────────────────────────────────────────────────────────
console.log(`\n━━ boxoffice suite: ${pass}/${pass + fail} passed ━━`);
if (fail) process.exit(1);
