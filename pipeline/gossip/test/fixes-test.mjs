// FIXES from the owner's live-article review: sentence-dedup (the doubled no-comment), SEO backfill
// (keyTakeaways/faq/tags), the confidence badge (mixed/developing ≠ CONFIRMED), and the category guard
// (a non-musician mislabeled "musician" → Celebrity, not Music). All deterministic/offline.
// Run: node pipeline/gossip/test/fixes-test.mjs
import { dedupeSentences, ensureTakeaways, ensureFaq, deriveTags } from "../polish.mjs";
import { musicianVerified, correctSubjectType } from "../categoryGuard.mjs";
import { buildGossipMarkdown } from "../assemble.mjs";
import { frameTopic } from "../frame.mjs";

let pass = 0, fail = 0;
const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== OWNER-REVIEW FIXES ===\n");

// ── sentence dedup — the ACTUAL doubled no-comment from the live Taylor Frankie Paul article ──
{
  const body = `Reps for Taylor, Tate, and Mortensen did not immediately respond to requests for comment from Page Six.\n\nA rep for Taylor did not immediately respond to Page Six's request for comment on Tuesday evening.`;
  const out = dedupeSentences(body);
  const count = (out.match(/request/gi) || []).length;
  check("the doubled no-comment line is collapsed to ONE", count === 1, out);
  const uniq = "According to People, the pair were spotted at dinner.\n\nA source said they looked cozy.";
  check("unique sentences are preserved", dedupeSentences(uniq).split(/\n{2,}/).length === 2);
  const exactDup = "She sparked engagement rumors this weekend. She sparked engagement rumors this weekend.";
  check("an exact repeated sentence is collapsed", (dedupeSentences(exactDup).match(/sparked/gi) || []).length === 1);
}

// ── SEO backfill ──
{
  check("keyTakeaways empty → backfilled from whatWeKnow", JSON.stringify(ensureTakeaways({ keyTakeaways: [], whatWeKnow: ["A filed for X", "B entered a facility", "police forwarded the case"] })) === JSON.stringify(["A filed for X", "B entered a facility", "police forwarded the case"]));
  check("keyTakeaways present → kept", ensureTakeaways({ keyTakeaways: ["one", "two"], whatWeKnow: ["x"] }).length === 2);
  const faq = ensureFaq({ faq: [], whatWeDont: ["The specific allegations in the sealed documents", "Whether the DA will find a violation"] });
  check("faq empty → backfilled from whatWeDont as Q/A", faq.length === 2 && /\?$/.test(faq[0].q) && !!faq[0].a);
  check("faq present → kept", ensureFaq({ faq: [{ q: "Q?", a: "A." }], whatWeDont: ["x"] }).length === 1);
  const tags = deriveTags({ primaryEntity: "Taylor Frankie Paul" }, {}, "celebrity", "breakup");
  check("tags derived from entity + category + type", tags.includes("Taylor Frankie Paul") && tags.includes("celebrity") && tags.length <= 6);
}

// ── confidence badge: a DEVELOPING (monitored) official-record story is NOT blanket CONFIRMED ──
{
  const article = { title: "X news", dek: "d", body: "b", keyTakeaways: [], faq: [], whatWeKnow: [], whatWeDont: [] };
  const route = { category: "celebrity", subcategory: "news" };
  // EXTREME + established outlet → OFFICIAL_RECORD tier, and these are monitored/developing
  const devFrame = { tier: "OFFICIAL_RECORD", severity: "EXTREME", uiLabel: "Per official records", monitor: true, attribution: "Page Six" };
  const dev = buildGossipMarkdown({ article, frame: devFrame, provenance: { sensitivity: "high", monitor: true, attribution: "Page Six", sources: [] }, route, topic: { primaryEntity: "X", slug: "x-news", subjectType: "celebrity" }, dateISO: "2026-07-01T00:00:00Z" });
  check("a developing/monitored official-record story is badged DEVELOPING (not CONFIRMED)", dev.frontmatter.storyStatus === "DEVELOPING", dev.frontmatter.storyStatus);
  const confFrame = { tier: "OFFICIAL_RECORD", severity: "NORMAL", uiLabel: "Per official records", monitor: false, attribution: "Page Six" };
  const conf = buildGossipMarkdown({ article, frame: confFrame, provenance: { sensitivity: "normal", monitor: false, attribution: "Page Six", sources: [] }, route, topic: { primaryEntity: "X", slug: "x2", subjectType: "celebrity" }, dateISO: "2026-07-01T00:00:00Z" });
  check("a settled (non-developing) confirmed story stays CONFIRMED", conf.frontmatter.storyStatus === "CONFIRMED", conf.frontmatter.storyStatus);
  check("assemble also backfills empty keyTakeaways/faq via the polish path is separate — tags present", Array.isArray(conf.frontmatter.tags) && conf.frontmatter.tags.length > 0);
}

// ── category guard: only a real musician stays in Music ──
{
  // reality star: not in Deezer (0 fans) and not in MusicBrainz → confirmed NON-musician
  const notMusician = await musicianVerified("Taylor Frankie Paul", { deezerImpl: async () => 0, mbImpl: async () => null });
  check("a reality star is confirmed NOT a musician", notMusician === false);
  // real artist: high Deezer fan count → confirmed musician
  const isMusician = await musicianVerified("Taylor Swift", { deezerImpl: async () => 90_000_000, mbImpl: async () => null });
  check("a real recording artist is confirmed a musician", isMusician === true);
  // outage → unknown (trust the LLM)
  const outage = await musicianVerified("Someone", { deezerImpl: async () => { throw new Error("down"); }, mbImpl: async () => null });
  check("an outage returns null (trust the categorizer)", outage === null);

  // correctSubjectType: a "musician"-routed non-musician → "celebrity"; a real musician → null (unchanged)
  const corr = await correctSubjectType({ subjectType: "musician", primaryEntity: "Taylor Frankie Paul" }, { deezerImpl: async () => 0, mbImpl: async () => null });
  check("a mislabeled musician (reality star) is corrected to celebrity", corr === "celebrity");
  const keep = await correctSubjectType({ subjectType: "musician", primaryEntity: "Taylor Swift" }, { deezerImpl: async () => 90_000_000, mbImpl: async () => null });
  check("a real musician is left unchanged (null)", keep === null);
  const notMusicRoute = await correctSubjectType({ subjectType: "actor", primaryEntity: "Some Actor" }, { deezerImpl: async () => { throw new Error("should not be called"); }, mbImpl: async () => null });
  check("a non-Music route is never touched (no lookup)", notMusicRoute === null);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Owner-review fixes green. ✅\n");
