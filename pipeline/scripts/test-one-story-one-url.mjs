// DEV-ONLY unit test (no network, no spend): ONE STORY = ONE URL (owner standing policy 2026-07-19).
//
// The contract under test: when the lane meets a DEVELOPMENT on a story it already published within
// ~7 days, it must UPDATE that article in place — same URL, refreshed facts, dateModified stamped —
// instead of minting a second slug. New URLs are for genuinely new stories only.
//
// Suites: 1 same-story detection · 2 UPDATE-not-CREATE (the headline proof, real filesystem) ·
//         3 identity preservation · 4 false positives from the LIVE corpus · 5 lane safety ·
//         6 fail-safe refusals · 7 the title exception.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { findSameStory, myRecentArticles, myPublishedSlugs } from "../find/sameStory.mjs";
import { mergeUpdate, titleSimilarity, headlineSuperseded } from "../stages/updateArticle.mjs";
const matter = createRequire(import.meta.url)("gray-matter");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ FAIL: " + m); } };

// ── fixture: a throwaway content dir + ledger, so nothing real is ever touched ───────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "one-url-"));
const ART = path.join(TMP, "articles"); fs.mkdirSync(ART);
const LEDGER = path.join(TMP, "published.json");

const PUBLISHED_AT = "2026-07-17T09:00:00.000Z";
const article = (over = {}) => {
  const fm = {
    title: "Ryan Hurst Cast as Kratos in Prime Video's God of War Series",
    slug: "ryan-hurst-cast-as-kratos-in-prime-video-s-god-of-war-series",
    category: "tv", subcategory: "news", author: "editorial-team",
    date: PUBLISHED_AT,
    dek: "The actor will lead the video-game adaptation.",
    metaTitle: "Ryan Hurst Cast as Kratos in Prime Video's God of War",
    metaDescription: "Ryan Hurst has been cast as Kratos in Prime Video's God of War series, the streamer confirmed on Friday afternoon.",
    tags: ["God of War", "Ryan Hurst", "Prime Video"],
    targetKeyword: "God of War",
    about: [{ name: "God of War", type: "TVSeries" }],
    eventSlug: "ryan-hurst-kratos-god-of-war-casting",
    eventType: "casting",
    image: "https://image.tmdb.org/t/p/original/hero.jpg",
    imageWidth: 3840, imageHeight: 2160, imageCredit: "Prime Video",
    imageAlt: "God of War — Ryan Hurst Cast as Kratos",
    ...over,
  };
  const y = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
  return `---\n${y}\n---\n\nRyan Hurst will play Kratos. Production begins in the autumn.\n`;
};
const write = (slug, body) => fs.writeFileSync(path.join(ART, slug + ".md"), body);
const setLedger = (slugs) => fs.writeFileSync(LEDGER, JSON.stringify(slugs.map((s) => ({ slug: s }))));

const KRATOS = "ryan-hurst-cast-as-kratos-in-prime-video-s-god-of-war-series";
write(KRATOS, article());
setLedger([KRATOS]);
const NOW = Date.parse("2026-07-19T16:00:00.000Z");
const mine = () => myRecentArticles(168, { artDir: ART, now: NOW, mine: myPublishedSlugs({ ledger: LEDGER }) });

// The development: same subject, same beat, different headline + different eventSlug.
const development = {
  title: "God of War to Recast Kratos Role Following Ryan Hurst Exit",
  primaryEntity: "God of War", primaryKeyword: "God of War",
  eventType: "casting", eventSlug: "god-of-war-kratos-recast-ryan-hurst",
  entities: ["Ryan Hurst", "Kratos", "Prime Video"],
};

console.log("=== 1. same-story detection — a development is recognised, not treated as new ===");
{
  const m = findSameStory(development, mine());
  ok(!!m, "development matched an already-published article");
  ok(m?.slug === KRATOS, `matched the RIGHT article (${m?.slug?.slice(0, 46)})`);
  ok(/beat=casting/.test(m?.why || ""), `match reasoning recorded: ${m?.why}`);
}

console.log("=== 2. UPDATE, NOT CREATE — the headline proof, against a real filesystem ===");
{
  const before = fs.readdirSync(ART);
  const m = findSameStory(development, mine());
  const out = {
    slug: "god-of-war-to-recast-kratos-role-following-ryan-hurst-exit",  // what a NEW publish would mint
    body: "Prime Video will recast Kratos after Ryan Hurst's exit. The role is being re-opened.",
    frontmatter: {
      title: "God of War to Recast Kratos Role Following Ryan Hurst Exit",
      slug: "god-of-war-to-recast-kratos-role-following-ryan-hurst-exit",
      category: "movies", subcategory: "features", author: "editorial-team",
      date: "2026-07-19T16:00:00.000Z",
      dek: "The streamer is re-opening the lead role.",
      metaTitle: "God of War Recasts Kratos After Ryan Hurst Exit",
      metaDescription: "Prime Video is recasting Kratos following Ryan Hurst's exit from the God of War series, with the search now under way.",
      tags: ["God of War", "Kratos"], targetKeyword: "God of War",
      about: [{ name: "God of War", type: "TVSeries" }],
      eventSlug: "god-of-war-kratos-recast-ryan-hurst", eventType: "casting",
      image: "https://example.com/DIFFERENT.jpg", imageWidth: 1600, imageHeight: 900, imageCredit: "Other",
    },
  };
  const upd = mergeUpdate({ file: path.join(ART, m.file), out, nowISO: "2026-07-19T16:00:00.000Z" });
  ok(!!upd, "mergeUpdate produced a merged article");
  // simulate exactly what run.mjs does at the write site
  fs.writeFileSync(path.join(ART, upd.slug + ".md"), upd.md);
  const after = fs.readdirSync(ART);
  ok(after.length === before.length, `NO new file created (${before.length} → ${after.length})`);
  ok(!after.includes(out.slug + ".md"), "the would-be NEW slug was never written");
  ok(upd.slug === KRATOS, "the update wrote back to the ORIGINAL slug");
  const txt = fs.readFileSync(path.join(ART, KRATOS + ".md"), "utf8");
  ok(/re-?open|recast/i.test(txt), "the new development is present in the updated body");
  ok(!/Production begins in the autumn/.test(txt), "the superseded body was replaced");
}

console.log("=== 3. identity preserved — the URL and its accrued trust survive ===");
{
  // Parse the written file the way the SITE will (gray-matter), not with a regex — YAML folds long
  // strings across lines, and an earlier version of this test failed on its own reader, not the code.
  const d = matter(fs.readFileSync(path.join(ART, KRATOS + ".md"), "utf8")).data;
  ok(d.slug === KRATOS, "slug frozen");
  ok(new Date(d.date).toISOString() === PUBLISHED_AT, `original publish date frozen (${new Date(d.date).toISOString()})`);
  ok(d.category === "tv", "category frozen — /tv/<slug>/ URL unchanged (the new article said 'movies')");
  ok(d.subcategory === "news", "subcategory frozen");
  ok(/image\.tmdb\.org/.test(d.image || ""), "original hero image kept (no re-sourcing cost, no art churn)");
  ok(d.imageCredit === "Prime Video", "image credit kept in step with the image");
  ok(new Date(d.dateModified).toISOString() === "2026-07-19T16:00:00.000Z", "dateModified stamped");
  ok(d.updateCount === 1, "updateCount incremented");
  ok(/re-opening the lead role/.test(d.dek || ""), "dek refreshed to the new development");
  ok(/recasting Kratos/.test(d.metaDescription || ""), "metaDescription refreshed");
  ok(d.eventSlug === "god-of-war-kratos-recast-ryan-hurst", "eventSlug advanced to the latest development");
}

console.log("=== 4. FALSE POSITIVES — the pairs that fooled the 3-stem dup rule must NOT update ===");
{
  // Real production pairs. Each shares CONTEXT (same film/person) but is a different story; updating
  // any of them would have destroyed a live article.
  const corpus = [
    ["christopher-nolan-s-the-odyssey-earns-top-reviews", {
      title: "Christopher Nolan's 'The Odyssey' Earns Top Reviews", category: "movies",
      about: [{ name: "The Odyssey", type: "Movie" }], targetKeyword: "The Odyssey",
      eventSlug: "the-odyssey-reviews-imax", eventType: "review", tags: ["The Odyssey", "Christopher Nolan"],
    }],
    ["france-knights-george-lucas-jodie-foster", {
      title: "France Knights George Lucas, Jodie Foster, and Sigourney Weaver", category: "celebrity",
      about: [{ name: "George Lucas", type: "Person" }], targetKeyword: "George Lucas",
      eventSlug: "france-knights-george-lucas", eventType: "award", tags: ["George Lucas"],
    }],
  ];
  const dir = path.join(TMP, "fp"); fs.mkdirSync(dir);
  const led = path.join(TMP, "fp.json");
  for (const [slug, fm] of corpus) {
    const y = Object.entries({ ...fm, slug, date: "2026-07-18T09:00:00.000Z", author: "editorial-team" })
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
    fs.writeFileSync(path.join(dir, slug + ".md"), `---\n${y}\n---\n\nBody.\n`);
  }
  fs.writeFileSync(led, JSON.stringify(corpus.map(([s]) => ({ slug: s }))));
  const fpMine = myRecentArticles(168, { artDir: dir, now: NOW, mine: myPublishedSlugs({ ledger: led }) });

  // Travis Scott scored The Odyssey → shares {christopher, nolan, odyssey} with Nolan's review story.
  ok(!findSameStory({
    title: "Travis Scott Teams With James Blake & Ludwig Goransson for New Song", primaryEntity: "Travis Scott",
    eventType: "review", eventSlug: "travis-scott-new-song-goransson", entities: ["Christopher Nolan", "The Odyssey"],
  }, fpMine), "Travis Scott song ≠ Nolan's Odyssey reviews (different subject)");

  // Same person, genuinely different story.
  ok(!findSameStory({
    title: "George Lucas Created 'Star Wars' After Hollywood Rejected His Apocalypse Now",
    primaryEntity: "George Lucas", eventType: "award", eventSlug: "george-lucas-star-wars-origin-apocalypse-now",
    entities: ["George Lucas", "Star Wars"],
  }, fpMine), "Lucas origin story ≠ Lucas knighthood (different event)");

  // Same subject, DIFFERENT beat — a review must never overwrite a casting story.
  ok(!findSameStory({
    title: "The Odyssey Adds Two Cast Members", primaryEntity: "The Odyssey",
    eventType: "casting", eventSlug: "the-odyssey-reviews-imax", entities: ["The Odyssey"],
  }, fpMine), "different eventType never updates (casting ≠ review)");
}

console.log("=== 5. lane safety — another lane's article can never be rewritten ===");
{
  setLedger([]);                                   // our ledger no longer claims the file
  ok(findSameStory(development, mine()) === null, "unledgered (other-lane) article is invisible to the updater");
  const missing = myRecentArticles(168, { artDir: ART, now: NOW, mine: myPublishedSlugs({ ledger: path.join(TMP, "nope.json") }) });
  ok(missing.length === 0, "unreadable ledger ⇒ zero update candidates (fail-safe: publish new, never guess)");
  setLedger([KRATOS]);                             // restore
}

console.log("=== 6. fail-safe refusals ===");
{
  ok(findSameStory({ ...development, eventType: "" }, mine()) === null, "no eventType on the topic → no update");
  ok(findSameStory({ ...development, primaryEntity: "", primaryKeyword: "" }, mine()) === null, "no subject → no update");
  const stale = myRecentArticles(24, { artDir: ART, now: Date.parse("2026-07-30T00:00:00Z"), mine: myPublishedSlugs({ ledger: LEDGER }) });
  ok(findSameStory(development, stale) === null, "outside the 7-day window → new URL, not an update");
  ok(mergeUpdate({ file: path.join(ART, "does-not-exist.md"), out: { body: "x", frontmatter: {} } }) === null,
    "unreadable target returns null so the caller publishes normally instead of losing the story");
}

console.log("=== 7. the title exception — churn-safe by default, accurate when the story moves ===");
{
  const NO_CD = { cooldownH: 0 };   // cooldown is exercised separately in suite 8
  // Own pristine fixture: suite 2 legitimately refreshed KRATOS's headline, so reusing that file here
  // would test a mutated premise. Each suite writes what it asserts against.
  const T7 = "t7-" + KRATOS;
  write(T7, article({ slug: T7 }));
  ok(titleSimilarity("Ryan Hurst Cast as Kratos in God of War", "Ryan Hurst Cast as Kratos in God of War Series") >= 0.6,
    "a reworded headline stays similar → title preserved");
  const u = mergeUpdate({
    file: path.join(ART, T7 + ".md"), ...NO_CD, nowISO: "2026-07-19T17:00:00.000Z",
    out: { slug: "x", body: "b", frontmatter: { title: "Ryan Hurst Cast as Kratos in Prime Video's God of War Series Adaptation", dek: "d" } },
  });
  ok(u && !u.titleChanged && u.frontmatter.title.startsWith("Ryan Hurst Cast as Kratos"),
    "minor rewording does NOT churn the published headline");

  // THE REGRESSION THAT SIMILARITY ALONE MISSED: every proper noun is shared (sim 0.71) yet the old
  // headline "Ryan Hurst CAST as Kratos" is now FALSE. Word distance said "unchanged"; meaning did not.
  const OLD = "Ryan Hurst Cast as Kratos in Prime Video's God of War Series";
  const NEW = "God of War to Recast Kratos Role Following Ryan Hurst Exit";
  ok(titleSimilarity(OLD, NEW) >= 0.6, `similarity alone reads them as the same headline (${titleSimilarity(OLD, NEW).toFixed(2)})`);
  ok(headlineSuperseded(OLD, NEW), "reversal marker detects the meaning flip that similarity missed");
  const u2 = mergeUpdate({
    file: path.join(ART, T7 + ".md"), ...NO_CD, nowISO: "2026-07-19T17:00:00.000Z",
    out: { slug: "y", body: "b", frontmatter: { title: NEW } },
  });
  ok(u2 && u2.titleChanged && u2.superseded, "a MATERIAL development refreshes the headline (a stale one would be false)");
  ok(!headlineSuperseded("Kratos Role Recast After Exit", "Kratos Recast Confirmed by Prime Video"),
    "a marker already present in the OLD headline is not a fresh reversal");
}

console.log("=== 8. anti-churn cooldown + self-link ===");
{
  const T8 = "t8-" + KRATOS;                        // own fixture — order-independent
  write(T8, article({ slug: T8, dateModified: "2026-07-19T16:00:00.000Z" }));
  const out = { slug: "z", body: "b", frontmatter: { title: "God of War Casting Update" } };
  const soon = mergeUpdate({ file: path.join(ART, T8 + ".md"), out, nowISO: "2026-07-19T18:00:00.000Z" });
  ok(soon?.skipped === true, `refreshed ${soon?.ageH?.toFixed(1)}h ago (< ${soon?.cooldownH}h) → SKIPPED, not rewritten`);
  const later = mergeUpdate({ file: path.join(ART, T8 + ".md"), out, nowISO: "2026-07-20T06:00:00.000Z" });
  ok(!later?.skipped && later?.md, "once the cooldown clears the update proceeds");

  // assemble() links against the slug it WOULD have minted; written to the original slug that becomes a self-link.
  const selfy = mergeUpdate({
    file: path.join(ART, T8 + ".md"), cooldownH: 0, nowISO: "2026-07-20T06:00:00.000Z",
    out: { slug: "z", frontmatter: { title: "God of War Casting Update" },
      body: `See [our earlier report](/tv/${T8}/) and [another story](/movies/other-piece/).` },
  });
  ok(!new RegExp(`\\]\\(/tv/${T8}/\\)`).test(selfy.md), "self-link unwrapped (a page must not link to itself)");
  ok(/our earlier report/.test(selfy.md), "the anchor words survive as plain text");
  ok(/\[another story\]\(\/movies\/other-piece\/\)/.test(selfy.md), "genuine internal links untouched");
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
