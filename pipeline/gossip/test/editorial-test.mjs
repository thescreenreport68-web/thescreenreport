// EDITORIAL GATE test — the content-grounded "read the story and decide" step. Mocks the LLM (reviewImpl) so it
// runs offline. Proves: reject a non-story, the thin-text backstop, story-based category/attribution/confirmed, and
// the run.mjs integration (REJECTED_THIN + the editorial verdict driving frame/route). Run: node .../editorial-test.mjs
import { editorialReview } from "../editorialGate.mjs";
import { runGossip } from "../run.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
const LONG = "According to Page Six, the couple were photographed leaving a Los Angeles restaurant together on Saturday evening, marking their first public appearance since the engagement was announced last month. ".repeat(3);

console.log("\n=== EDITORIAL GATE TEST ===\n");

// 1) NON-STORY → reject (a bare social photo post)
{
  const bundle = { sources: [{ outlet: "Pop Crave", url: "https://bsky.app/x", text: "Normani stuns by a waterfall.", corroborating: false }], corroboratingOutlets: [] };
  const review = async () => ({ isStory: false, substanceScore: 1, rejectReason: "bare photo caption, no news", category: "music", attribution: "Pop Crave", confirmed: false, eventSummary: "Normani posted a photo" });
  const v = await editorialReview({ topic: { primaryEntity: "Normani", title: "Normani stuns by a waterfall", subjectType: "musician" }, bundle, reviewImpl: review });
  check("a bare social photo post is REJECTED (isStory=false)", v && v.isStory === false, JSON.stringify(v));
  check("reject reason is captured", v && /photo|news/i.test(v.rejectReason));
}

// 2) THIN-TEXT BACKSTOP — model says story but almost no text was collected → still rejected
{
  const bundle = { sources: [{ outlet: "Pop Crave", url: "x", text: "Rihanna wore a slip dress.", corroborating: false }], corroboratingOutlets: [] };
  const review = async () => ({ isStory: true, substanceScore: 8, category: "celebrity", attribution: "Just Jared", confirmed: true, eventSummary: "Rihanna wore a dress" });
  const v = await editorialReview({ topic: { primaryEntity: "Rihanna", title: "Rihanna wears slip dress", subjectType: "musician" }, bundle, reviewImpl: review });
  check("thin collected text (<220 chars) is rejected even if model says story", v && v.isStory === false, `len-based backstop; got isStory=${v?.isStory}`);
}

// 3) REAL STORY → category by story, attribution + confirmed from content
{
  const bundle = { sources: [{ outlet: "Just Jared", url: "x", text: LONG, corroborating: false }], corroboratingOutlets: [] };
  const review = async () => ({ isStory: true, substanceScore: 8, category: "celebrity", secondaryCategory: "music", attribution: "Just Jared", confirmed: false, official: false, denied: false, eventSummary: "Taylor Swift net worth revealed ahead of wedding" });
  const v = await editorialReview({ topic: { primaryEntity: "Taylor Swift", title: "Net worth revealed", subjectType: "musician" }, bundle, reviewImpl: review });
  check("a substantive story passes (isStory=true)", v && v.isStory === true);
  check("category is by STORY not subject (musician's personal story → celebrity)", v.category === "celebrity", v.category);
  check("secondaryCategory = music (dual-list)", v.secondaryCategory === "music");
  check("attribution is the real reporting outlet", v.attribution === "Just Jared");
}

// 4) fail-open: reviewImpl throws → null (caller falls back to metadata path, never loses a story)
{
  const bundle = { sources: [{ outlet: "Page Six", url: "x", text: LONG }], corroboratingOutlets: [] };
  const v = await editorialReview({ topic: { primaryEntity: "X", title: "y" }, bundle, reviewImpl: async () => { throw new Error("llm down"); } });
  check("editorial gate error → null (fail-open)", v === null);
}

// ── run.mjs integration ──
const bundleGood = { ok: true, sources: [{ outlet: "Just Jared", url: "x", text: LONG, tier: 5, quotes: [] }], corroboratingOutlets: [], quotes: [], corroborationCount: 1 };
const gatherStub = () => bundleGood; // not used directly; we inject via editorialImpl + writeImpl offline

// 5) REJECTED_THIN bubbles up from runGossip
{
  // Source clears the content-finder length floor (so we REACH the editorial gate), but it's still a non-story —
  // a photo-caption post padded with page chrome. The editorial gate is what must reject it.
  const thinButLong = "Pop Crave posted: Normani stuns by a waterfall. Trending now. See more celebrity photos and follow for updates on your favorite stars and their latest looks and posts across social media today.";
  const r = await runGossip(
    { primaryEntity: "Normani", title: "Normani stuns by a waterfall", subjectType: "musician", sources: [{ outlet: "Pop Crave", url: "https://bsky.app/x", text: thinButLong }] },
    { editorialImpl: async () => ({ isStory: false, rejectReason: "bare photo post" }), corroborate: false, verify: false, judge: false, fetchImpl: async () => ({ ok: false }) }
  );
  check("runGossip returns REJECTED_THIN for a non-story", r.status === "REJECTED_THIN", r.status + " / " + (r.reason || ""));
}

// 6) editorial verdict drives route.category + attribution in a PUBLISH
{
  const article = { title: "Taylor Swift and Travis Kelce's Net Worth Revealed", body: LONG + "\n\n" + LONG, dek: "A look at the numbers.", whatWeKnow: ["a"], whatWeDont: ["b"], keyTakeaways: ["x", "y"] };
  const r = await runGossip(
    { primaryEntity: "Taylor Swift", title: "Net worth revealed ahead of wedding", subjectType: "musician", slug: "ts-net-worth", sources: [{ outlet: "Just Jared", url: "https://justjared.com/x", text: LONG }] },
    {
      editorialImpl: async () => ({ isStory: true, substanceScore: 8, category: "celebrity", secondaryCategory: "music", attribution: "Just Jared", confirmed: false, official: false, denied: false, eventSummary: "TS net worth" }),
      writeImpl: async () => article, corroborate: false, verify: false, judge: false, fetchImpl: async () => ({ ok: false }),
    }
  );
  check("a musician's personal story routes to CELEBRITY (not music)", r.status === "PUBLISH" && r.route?.category === "celebrity", `${r.status} route=${r.route?.category}`);
  check("secondaryCategory carried = music", r.route?.secondaryCategory === "music", String(r.route?.secondaryCategory));
  check("attribution = the real outlet (Just Jared), not an aggregator/top-tier echo", r.provenance?.attribution === "Just Jared", String(r.provenance?.attribution));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Editorial gate green. ✅\n");
