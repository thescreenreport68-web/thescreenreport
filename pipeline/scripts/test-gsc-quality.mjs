// DEV-ONLY unit test (no network, no spend): the 2026-07-24 recovery-mode build.
//   Suite 1 — QUALITY FLOOR: thin / single-source-short stories are SKIPPED, never degraded.
//   Suite 2 — the backwards branch is gone (a weak story no longer earns a lower bar).
//   Suite 3 — DEMAND matching precision, built from the REAL false positives found on the live queue.
//   Suite 4 — demand points are bounded + fail-open.
//   Suite 5 — STRIKING DISTANCE is advisory and cannot fold unrelated stories into one ranking page.
import { assessGrounding, structuralFloors, CFG } from "../lib/qualityFloor.mjs";
import { demandForTopic, demandPoints, strikingMatch, DEMAND_CAP } from "../find/gscDemand.mjs";
import { learnPoints, evergreenOpportunities, LEARN_CAP } from "../find/learn.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ FAIL: " + m); } };
const bundle = (texts, quotes = []) => ({ sources: texts.map((t, i) => ({ text: "x".repeat(t), quotes: quotes[i] || [] })) });

console.log("=== 1. QUALITY FLOOR — calibrated on LIVE tick #524, which skipped 4 of 4 ===");
{
  // 🔴 THE DECISIVE RULE: did we get the outlet's real article, or only its RSS blurb?
  // Live #524 skipped both of these identically; only the first deserved it.
  const blurb = assessGrounding({ ...bundle([300]), extractedCount: 0, inlineCount: 1 });
  ok(blurb.skip && /full-text/.test(blurb.reason), `300-char feed summary → SKIP (${blurb.reason.slice(0, 58)})`);
  const realArticle = { ...bundle([2130]), extractedCount: 1, inlineCount: 0 };
  ok(!assessGrounding(realArticle).skip, "2130-char EXTRACTED article → allowed (was wrongly cut for 70 chars)");
  // a blurb stays skipped no matter how long it is — kind of material first, size second
  ok(assessGrounding({ ...bundle([9000]), extractedCount: 0, inlineCount: 3 }).skip, "even a LONG summary-only bundle is skipped (no real reporting behind it)");

  // size still matters once we have real text
  const thin = assessGrounding({ ...bundle([600]), extractedCount: 1 });
  ok(thin.skip, "single-source 600 chars of real text → still SKIP (too little to write 250 honest words)");
  ok(!assessGrounding({ ...bundle([4000]), extractedCount: 1 }).skip, "single-source 4000 chars → allowed");
  ok(assessGrounding({ ...bundle([700, 500]), extractedCount: 2 }).skip, "two outlets, 1200 chars → SKIP (still too thin)");
  ok(!assessGrounding({ ...bundle([1200, 900]), extractedCount: 2 }).skip, "two outlets, 2100 chars → allowed");
  ok(thin.chars === 600 && thin.sources === 1, "assessment reports the real numbers (skips stay explainable + tunable)");
  // unknown bundle shape must not be guessed into the bin
  ok(!assessGrounding(bundle([3000])).skip, "bundle with no extraction counts → judged on size alone, never guessed");
}

console.log("=== 2. NO BUNDLE ⇒ we do not guess a story into the bin (fail-safe direction) ===");
{
  ok(!assessGrounding(null).skip, "missing bundle → NOT skipped here (structured grounding may carry it; gate is the backstop)");
  ok(!assessGrounding({ sources: [] }).skip, "empty sources → NOT skipped here either");
}

console.log("=== 3. THE BACKWARDS BRANCH IS GONE — a weak story never earns a lower bar ===");
{
  const base = { words: 400, faq: 3, h2: 2, kt: 3, ext: 2, sources: true };
  const lean = structuralFloors(base, assessGrounding(bundle([2000, 200])));
  ok(lean.words >= CFG.MIN_WORDS, `lean story word floor ${lean.words} >= ${CFG.MIN_WORDS} (was 220 — the bug)`);
  const rich = structuralFloors(base, assessGrounding(bundle([5000, 4000])));
  ok(rich.words === 400, "well-sourced story keeps its full 400-word format floor");
  ok(structuralFloors({ ...base, words: 220 }, assessGrounding(bundle([5000]))).words === CFG.MIN_WORDS,
    `a format asking for 220 is RAISED to ${CFG.MIN_WORDS} — nothing publishes under the floor, ever`);
  // structural allowances are still permitted for a genuinely leaner (but sufficiently sourced) piece
  ok(lean.h2 <= base.h2 && lean.faq <= base.faq, "structural allowances survive for a leaner piece (that was never the problem)");
}

console.log("=== 4. DEMAND MATCHING — the REAL false positives from the live queue ===");
{
  const demand = { ok: true, queries: [
    { q: "the odyssey", impressions: 35, clicks: 1, position: 1 },
    { q: "universal trojan horse odyssey premiere", impressions: 3, clicks: 0, position: 5.8 },
    { q: "2025 academy award winners", impressions: 3, clicks: 0, position: 59 },
    { q: "christopher nolan movies ranked by tomatometer", impressions: 3, clicks: 0, position: 8.7 },
  ], strikingPages: [], pages: [] };

  // ❌ was matching on the single generic 8-letter token "premiere"
  const boyle = demandForTopic({ primaryEntity: "Ink (film)", primaryKeyword: "Danny Boyle Ink", title: "Danny Boyle's Ink Sells to Netflix Ahead of Venice Premiere" }, demand);
  ok(boyle.impressions === 0, "Danny Boyle/Ink no longer matches an Odyssey query via the word 'premiere'");

  // ❌ was matching "award"+"winners" — generic industry words
  const bafta = demandForTopic({ primaryEntity: "BAFTA Student Awards", primaryKeyword: "BAFTA Student Awards", title: "BAFTA Student Award Winners Announced in Los Angeles" }, demand);
  ok(bafta.impressions === 0, "BAFTA Student Awards no longer matches '2025 academy award winners'");

  // ✅ genuine subject match must still work
  const odyssey = demandForTopic({ primaryEntity: "The Odyssey", primaryKeyword: "the odyssey premiere", title: "Zendaya Dons Angel Wings at 'The Odyssey' Premiere" }, demand);
  ok(odyssey.impressions > 0 && odyssey.bestQuery === "the odyssey", `a real Odyssey story still matches (${odyssey.impressions} impr via "${odyssey.bestQuery}")`);

  // title-only overlap is not enough — the SUBJECT must coincide
  const titleOnly = demandForTopic({ primaryEntity: "Some Other Film", primaryKeyword: "some other film", title: "A story that merely mentions the odyssey in passing" }, demand);
  ok(titleOnly.impressions === 0, "incidental title mention does NOT create demand (subject overlap required)");
  ok(demandForTopic({ primaryEntity: "", primaryKeyword: "" }, demand).impressions === 0, "no subject → no demand");
}

console.log("=== 5. DEMAND POINTS — bounded, log-scaled, fail-open ===");
{
  ok(demandPoints({ impressions: 0 }) === 0, "zero impressions → zero points (never negative, never a gate)");
  ok(demandPoints({ impressions: 100000 }) <= DEMAND_CAP, `huge demand still capped at ${DEMAND_CAP} (tie-breaker, not a takeover)`);
  ok(demandPoints({ impressions: 200 }) > demandPoints({ impressions: 5 }), "more demand → more points (monotonic)");
  const off = { ok: false, queries: [] };
  ok(demandForTopic({ primaryEntity: "X", primaryKeyword: "x" }, off).impressions === 0, "GSC unavailable → 0, lane ranks exactly as before (FAIL OPEN)");
  ok(demandForTopic({ primaryEntity: "X" }, null).impressions === 0, "null demand object is safe");
}

console.log("=== 6. STRIKING DISTANCE — advisory, and cannot swallow unrelated stories ===");
{
  // THE LIVE INCIDENT: 5 unrelated topics all pointed at one ranking page via the lone token "odyssey".
  const demand = { ok: true, queries: [], pages: [], strikingPages: [
    { slug: "christopher-nolan-addresses-the-odyssey-backlash", impressions: 3, position: 26.3 },
  ] };
  const mine = new Set(["christopher-nolan-addresses-the-odyssey-backlash"]);
  const unrelated = [
    { primaryEntity: "Teyana Taylor", primaryKeyword: "teyana taylor world cup" },
    { primaryEntity: "Samantha Morton", primaryKeyword: "samantha morton circe" },
    { primaryEntity: "Tom Holland", primaryKeyword: "tom holland pattinson" },
  ];
  ok(unrelated.every((t) => !strikingMatch(t, demand, mine)),
    "3 unrelated stories no longer all point at the same ranking page (1 shared word is not enough)");
  const real = strikingMatch({ primaryEntity: "Christopher Nolan", primaryKeyword: "christopher nolan odyssey" }, demand, mine);
  ok(!!real && real.advisory === true, "a genuine 2-token subject match IS returned, flagged advisory (never an authority to rewrite)");
  ok(!strikingMatch({ primaryEntity: "Christopher Nolan", primaryKeyword: "christopher nolan odyssey" }, demand, new Set(["someone-elses-page"])),
    "a page this lane does not own is invisible to striking distance");
}

console.log("=== 7. LEARNING LOOP — bounded, sample-gated, and it cannot run away ===");
{
  const perf = {
    ok: true, baseline: 0.2, sample: 274, buckets: {
      "category:music": { n: 34, earners: 10, hitRate: 0.29, lift: 1.45, enough: true },
      "category:tv": { n: 68, earners: 11, hitRate: 0.16, lift: 0.8, enough: true },
      "category:dead": { n: 40, earners: 1, hitRate: 0.025, lift: 0.12, enough: true },
      "category:tiny": { n: 3, earners: 3, hitRate: 1, lift: 5, enough: false },   // great rate, no sample
    },
  };
  ok(learnPoints({ category: "music" }, perf) > 0, "a category that genuinely over-performs gets a small boost");
  ok(learnPoints({ category: "dead" }, perf) < 0, "a category that reliably earns nothing gets a small penalty");
  ok(learnPoints({ category: "tiny" }, perf) === 0, "a 3-article bucket biases NOTHING (sample gate) — no learning from noise");
  ok(Math.abs(learnPoints({ category: "dead", formatTag: "dead" }, perf)) <= LEARN_CAP, `bias stays within ±${LEARN_CAP} even when every signal agrees`);
  ok(learnPoints({ category: "music" }, { ok: false }) === 0, "no performance data → no bias (fail-open)");
  ok(learnPoints({ category: "never-published" }, perf) === 0, "an unseen category is neutral, not punished");
}

console.log("=== 8. EVERGREEN OPPORTUNITIES — found from our OWN search data ===");
{
  const demand = { ok: true, pages: [{ slug: "best-a24-movies-ranked", impressions: 136, position: 34.4 }], queries: [
    { q: "best a24 films", impressions: 5, clicks: 1, position: 40 },
    { q: "best a24 movies", impressions: 8, clicks: 0, position: 25 },
    { q: "best movie trilogy", impressions: 4, clicks: 0, position: 16 },
    { q: "best trilogy movies", impressions: 3, clicks: 0, position: 18 },
    { q: "2025 oscar winners", impressions: 11, clicks: 0, position: 55 },
    { q: "zendaya cast in the odyssey", impressions: 40, clicks: 2, position: 1 },  // NEWS, not evergreen
  ] };
  // A stand-in article corpus — matching runs against slug + title + metaTitle, exactly as in production.
  const index = [
    { slug: "best-a24-movies-ranked", title: "The Best A24 Movies, Ranked", metaTitle: "" },
    { slug: "best-movie-trilogies", title: "The Greatest Movie Trilogies Ever Made", metaTitle: "" },
    // 🔴 the killer case: the slug shares ZERO words with "2025 oscar winners" — only the metaTitle matches
    { slug: "every-winner-at-the-97th-academy-awards", title: "Sean Baker's Anora Dominates the 2025 Oscars Winners List", metaTitle: "2025 Oscars Winners: Full List of Academy Award Winners" },
  ];
  const ops = evergreenOpportunities(demand, { index });
  ok(ops.length > 0, `found ${ops.length} evergreen cluster(s) from real query shapes`);
  ok(!ops.some((o) => /zendaya/i.test(o.queries.join(" "))), "a pure NEWS query is not mistaken for evergreen demand");
  const a24 = ops.find((o) => o.queries.some((q) => /a24/.test(q)));
  ok(a24 && a24.variants >= 2, `"films" and "movies" are one intent → ONE cluster, not two thin pages (${a24?.variants} variants)`);
  ok(a24 && a24.existingPage === "best-a24-movies-ranked", "reports the page we ALREADY have → improve it, never a second URL");

  // 🔴 REGRESSION — the two near-duplicates the first version reported as "NO PAGE YET".
  // Publishing either would have duplicated a page that already ranks.
  const trilogy = ops.find((o) => o.queries.some((q) => /trilog/.test(q)));
  ok(trilogy && trilogy.existingPage === "best-movie-trilogies",
    "singular 'trilogy' now matches our plural 'trilogies' page (stemming) — no duplicate");
  const oscars = ops.find((o) => o.queries.some((q) => /oscar/.test(q)));
  ok(oscars && oscars.existingPage === "every-winner-at-the-97th-academy-awards",
    "'2025 oscar winners' matches via metaTitle even though the SLUG shares no words — no duplicate");
}

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
