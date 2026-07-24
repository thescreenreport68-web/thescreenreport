// ONE STORY = ONE URL (owner directive, 2026-07-20).
// A development on a story we already covered must REFRESH that article's existing URL, never mint a
// second slug. Hermetic — writes only to a temp dir, never to content/articles.
//   node pipeline/gossip/test/one-story-one-url-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { updateArticleInPlace, readParent, isOwnArticle, withinWindow, stampBody, UPDATE_WINDOW_DAYS } from "../updateInPlace.mjs";
import { gossipRun } from "../gossiprun.mjs";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");
let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
process.env.GOSSIP_STATS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-stats-"));

console.log("\n=== ONE STORY = ONE URL ===\n");

const NOW = Date.parse("2026-07-20T12:00:00Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const mkDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "arts-"));

function writeParent(dir, over = {}) {
  const slug = over.slug || "star-a-and-star-b-are-engaged";
  const fm = {
    title: "Star A and Star B Are Engaged After Two Years Together",
    slug, category: "celebrity", subcategory: "news", author: "alicia-bernard",
    date: iso(2 * 864e5),                       // published 2 days ago
    dateModified: iso(2 * 864e5),
    dek: "The couple confirmed the news with a joint post on Sunday evening.",
    formatTag: "gossip", tags: ["Star A", "celebrity"],
    image: "https://img.example.com/a.jpg", imageAlt: "Star A", imageCredit: "Photo via People",
    imageWidth: 1200, imageHeight: 675,
    ...over,
  };
  const fp = path.join(dir, `${slug}.md`);
  fs.writeFileSync(fp, matter.stringify("\nStar A and Star B are engaged, People reports. " + "Original body detail here. ".repeat(20) + "\n", fm));
  return { slug, fp, fm };
}

// the freshly-written follow-up piece (the writer leads with the new development)
const FOLLOWUP = {
  title: "Star A and Star B Set a December Wedding Date",
  dek: "The pair have chosen a winter ceremony, two sources tell the outlet.",
  metaTitle: "Star A and Star B set a December wedding date",
  metaDescription: "Star A and Star B have set a December wedding date, two sources tell People, four months after the couple announced their engagement.",
  body: "Star A and Star B have set a December wedding date, People reports. " + "Fresh verified detail sentence here. ".repeat(20),
  keyTakeaways: ["Star A and Star B set a December wedding date"],
  faq: [{ q: "When is the wedding?", a: "The couple have set a December date." }],
  whatWeKnow: ["Star A and Star B set a December wedding date"], whatWeDont: [], claims: [],
};
const FRAME = { tier: "REPORTED_BY_MAJOR", severity: "NORMAL", uiLabel: "Reported", monitor: false };
const PROV = { sensitivity: "normal", attribution: "People", monitor: false, sources: [], corroborationCount: 2, publishedAt: iso(0) };
const ROUTE = { category: "celebrity", subcategory: "news" };
const TOPIC = { primaryEntity: "Star A", id: "t-upd", title: "wedding date set", claim: "set a December wedding date" };

// ── 1) same story inside the window ⇒ refreshed IN PLACE, URL unchanged ──
{
  const dir = mkDir(); const p = writeParent(dir);
  const before = fs.readdirSync(dir).length;
  const r = updateArticleInPlace({
    parentSlug: p.slug, article: { ...FOLLOWUP }, frame: FRAME, provenance: PROV, route: ROUTE,
    topic: TOPIC, dateISO: iso(0), newFact: "the couple set a December date", dir, now: NOW,
  });
  check("status UPDATED", r.status === "UPDATED", JSON.stringify(r).slice(0, 120));
  check("NO new file created (still one article)", fs.readdirSync(dir).length === before, String(fs.readdirSync(dir).length));
  const after = matter(fs.readFileSync(p.fp, "utf8"));
  check("slug unchanged ⇒ URL is stable", after.data.slug === p.slug, after.data.slug);
  check("original publish date preserved", after.data.date === p.fm.date, String(after.data.date));
  check("category preserved (URL path stable)", after.data.category === "celebrity");
  check("dateModified bumped to now", after.data.dateModified === iso(0), String(after.data.dateModified));
  check("updated field set (site reads updated ?? dateModified)", after.data.updated === iso(0));
  check("updatedCount incremented", after.data.updatedCount === 1, String(after.data.updatedCount));
  check("body refreshed with the new development", /December wedding date/.test(after.content) && !/Original body detail/.test(after.content));
  check("visible freshness line present", /^_Updated 2026-07-20: the couple set a December date\._/m.test(after.content.trim()), after.content.trim().slice(0, 80));
  check("title reflects the current state of the story", /December Wedding Date/.test(after.data.title), String(after.data.title));
  check("tags merged, not lost", (after.data.tags || []).includes("Star A"));
}
// ── 2) a SECOND update replaces the stamp instead of stacking it ──
{
  const dir = mkDir(); const p = writeParent(dir, { dateModified: iso(30 * 36e5) }); // last touched 30h ago
  updateArticleInPlace({ parentSlug: p.slug, article: { ...FOLLOWUP }, frame: FRAME, provenance: PROV, route: ROUTE, topic: TOPIC, dateISO: iso(24 * 36e5), newFact: "first development", dir, now: NOW - 24 * 36e5 });
  const r2 = updateArticleInPlace({ parentSlug: p.slug, article: { ...FOLLOWUP }, frame: FRAME, provenance: PROV, route: ROUTE, topic: TOPIC, dateISO: iso(0), newFact: "second development", dir, now: NOW });
  check("second update also lands in place", r2.status === "UPDATED");
  const after = matter(fs.readFileSync(p.fp, "utf8"));
  check("updatedCount reached 2", after.data.updatedCount === 2, String(after.data.updatedCount));
  check("only ONE update line (stamps never accumulate)", (after.content.match(/_Updated /g) || []).length === 1, String((after.content.match(/_Updated /g) || []).length));
  check("newest note wins", /second development/.test(after.content) && !/first development/.test(after.content));
}
// ── 3) anti-churn: same URL refreshed moments ago ⇒ SKIP, do not touch the file ──
{
  const dir = mkDir(); const p = writeParent(dir, { dateModified: iso(2 * 36e5) }); // touched 2h ago
  const snapshot = fs.readFileSync(p.fp, "utf8");
  const r = updateArticleInPlace({ parentSlug: p.slug, article: { ...FOLLOWUP }, frame: FRAME, provenance: PROV, route: ROUTE, topic: TOPIC, dateISO: iso(0), newFact: "x", dir, now: NOW });
  check("status SKIP inside the churn gap", r.status === "SKIP", JSON.stringify(r).slice(0, 100));
  check("file left byte-identical", fs.readFileSync(p.fp, "utf8") === snapshot);
}
// ── 4) outside the ~7d window ⇒ genuinely new coverage, publish a new slug ──
{
  const dir = mkDir(); const p = writeParent(dir, { date: iso(20 * 864e5), dateModified: iso(20 * 864e5) });
  const r = updateArticleInPlace({ parentSlug: p.slug, article: { ...FOLLOWUP }, frame: FRAME, provenance: PROV, route: ROUTE, topic: TOPIC, dateISO: iso(0), newFact: "x", dir, now: NOW });
  check("status PUBLISH_NEW when the parent is stale", r.status === "PUBLISH_NEW" && /older than/.test(r.reason), JSON.stringify(r));
  check("window boundary honoured", UPDATE_WINDOW_DAYS === 7 && withinWindow({ date: iso(6 * 864e5) }, NOW) && !withinWindow({ date: iso(8 * 864e5) }, NOW));
}
// ── 5) NEVER touch another lane's article ──
{
  const dir = mkDir(); const p = writeParent(dir, { formatTag: "news", slug: "news-lane-story" });
  const snapshot = fs.readFileSync(p.fp, "utf8");
  const r = updateArticleInPlace({ parentSlug: p.slug, article: { ...FOLLOWUP }, frame: FRAME, provenance: PROV, route: ROUTE, topic: TOPIC, dateISO: iso(0), newFact: "x", dir, now: NOW });
  check("another lane's article is never rewritten", r.status === "PUBLISH_NEW" && /another lane/.test(r.reason), JSON.stringify(r));
  check("that file is byte-identical", fs.readFileSync(p.fp, "utf8") === snapshot);
  check("isOwnArticle only accepts formatTag gossip", isOwnArticle({ formatTag: "gossip" }) && !isOwnArticle({ formatTag: "news" }) && !isOwnArticle({}));
}
// ── 6) a de-indexed parent stays de-indexed ──
{
  const dir = mkDir(); const p = writeParent(dir, { robots: "noindex" });
  const r = updateArticleInPlace({ parentSlug: p.slug, article: { ...FOLLOWUP }, frame: FRAME, provenance: PROV, route: ROUTE, topic: TOPIC, dateISO: iso(0), newFact: "x", dir, now: NOW });
  check("refresh does not resurrect a de-indexed page", r.status === "UPDATED" && r.frontmatter.robots === "noindex", String(r.frontmatter?.robots));
}
// ── 7) missing parent ⇒ publish new (never crash) ──
{
  const r = updateArticleInPlace({ parentSlug: "does-not-exist", article: { ...FOLLOWUP }, frame: FRAME, provenance: PROV, route: ROUTE, topic: TOPIC, dateISO: iso(0), dir: mkDir(), now: NOW });
  check("missing parent ⇒ PUBLISH_NEW", r.status === "PUBLISH_NEW");
  check("readParent returns null for a missing slug", readParent("nope", mkDir()) === null);
}
// ── 8) END-TO-END through gossipRun: an UPDATE topic refreshes, a DISTINCT topic mints a new slug ──
{
  const dir = mkDir(); const p = writeParent(dir);
  const filesBefore = fs.readdirSync(dir).length;
  let wroteNew = 0;
  const base = {
    contentDir: dir, fromFind: true, limit: 1, dedup: false, hero: false, links: false,
    writeImpl: () => { wroteNew++; return { slug: "brand-new-slug", path: "/x", frontmatter: {}, md: "", written: true, seoIssues: [] }; },
    runImpl: async () => ({
      status: "PUBLISH", article: { ...FOLLOWUP, relatedLinks: [] }, frame: FRAME,
      provenance: PROV, route: ROUTE, bundle: { sources: [] },
    }),
    updateInPlaceImpl: (args) => updateArticleInPlace({ ...args, dir, now: NOW }),
  };
  const r = await gossipRun({
    ...base,
    dequeueImpl: (() => { let done = false; return () => (done ? [] : (done = true, [{ ...TOPIC, isUpdate: true, parentSlug: p.slug, updateFact: "a December date is set", subjectType: "actor" }])); })(),
  });
  check("E2E: the tick reports a publish", (r.published || []).length === 1, JSON.stringify(r.published || []).slice(0, 90));
  check("E2E: flagged as updatedInPlace", r.published?.[0]?.updatedInPlace === true, JSON.stringify(r.published?.[0] || {}).slice(0, 120));
  check("E2E: writeImpl NEVER called ⇒ no new slug minted", wroteNew === 0, `writeImpl ran ${wroteNew}x`);
  check("E2E: still exactly one article file", fs.readdirSync(dir).length === filesBefore, String(fs.readdirSync(dir).length));
  const after = matter(fs.readFileSync(p.fp, "utf8"));
  check("E2E: the live file really was refreshed", after.data.updatedCount === 1 && /December wedding date/.test(after.content));
  check("E2E: no self-link in relatedLinks", !(after.data.relatedLinks || []).some((l) => l.slug === p.slug), JSON.stringify(after.data.relatedLinks || []));

  // a DISTINCT story must still mint a new slug — the normal path is untouched
  wroteNew = 0;
  const r2 = await gossipRun({
    ...base,
    dequeueImpl: (() => { let done = false; return () => (done ? [] : (done = true, [{ primaryEntity: "Star Z", id: "t-new", title: "t", claim: "c", subjectType: "actor" }])); })(),
  });
  check("E2E: a DISTINCT story still gets its own new slug", wroteNew === 1 && (r2.published || []).length === 1, `writeImpl ran ${wroteNew}x`);
  check("E2E: distinct story is not flagged as an update", r2.published?.[0]?.updatedInPlace === false);
}
// ── 9) stampBody unit behaviour ──
{
  check("stamp added when a note exists", /^_Updated 2026-07-20: hello\._/.test(stampBody("Body text here.", "hello", "2026-07-20T00:00:00Z")));
  check("no stamp when there is no note", !/_Updated/.test(stampBody("Body text here.", "", "2026-07-20T00:00:00Z")));
  check("existing stamp replaced, body kept", (() => { const once = stampBody("Body.", "one", "2026-07-20T00:00:00Z"); const twice = stampBody(once, "two", "2026-07-21T00:00:00Z"); return (twice.match(/_Updated /g) || []).length === 1 && /Body\./.test(twice) && /two/.test(twice); })());
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("One story = one URL. ✅\n");
