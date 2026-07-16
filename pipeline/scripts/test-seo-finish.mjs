// DEV-ONLY unit test (no network): prove the 2026-07-16 root-cause fixes with the ACTUAL defective
// inputs that shipped to the live site. One suite per root cause:
//   1. finishMetaTitle — never a mid-phrase fragment (known-bads: "…Cast in Netflix's The",
//      "…Lineup with Margot", "…Casts Paddy Considine, America")
//   2. driftGuard — the Bonta/"swimming lesson" wrong-story metadata case
//   3. entityFidelity — the 'Unleeshed'→"Unleashed" writer spell-"correction" case
//   4. finishMetaDescription — 140–160 chars ending on a complete sentence
//   5. slugifyTitle — no mid-word truncation, diacritics transliterated
//   6. findDuplicate — cross-lane same-story detection (Batman-2028 ×2), without killing
//      different stories that merely share a person
import { finishMetaTitle, finishMetaDescription, driftGuard, entityFidelity, slugifyTitle } from "../lib/seoFinish.mjs";
import { findDuplicate } from "../lib/dupGuard.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ FAIL: " + m); } };
const FRAG_TAIL = /\b(the|a|an|in|on|of|for|with|and|to|at|by|from|joins?|casts|sets|says|reveals|new)$|['’]s$|[,;:&–—-]$/i;
const inBand = (s, lo = 45, hi = 65) => s.length >= lo && s.length <= hi;

console.log("=== 1. finishMetaTitle — the three LIVE known-bad cases ===");
{
  // LIVE BAD #1: model wrote "Vincent D'Onofrio, Kate Mara Cast in Netflix's The" (in-band 52 but a fragment)
  const t = finishMetaTitle({
    model: "Vincent D'Onofrio, Kate Mara Cast in Netflix's The",
    title: "Vincent D'Onofrio, Kate Mara Join Oscar Isaac in Netflix's Las Vegas Drama 'The Roman'",
  });
  ok(!FRAG_TAIL.test(t), `no fragment tail: "${t}" (${t.length})`);
  ok(inBand(t), `length 45-65: ${t.length}`);
}
{
  // LIVE BAD #2: model wrote "Venice Film Festival Immersive Lineup with Margot" (49, splits Margot Robbie)
  const t = finishMetaTitle({
    model: "Venice Film Festival Immersive Lineup with Margot",
    title: "Margot Robbie, Andy Serkis Join Venice Film Festival's Immersive Lineup",
  });
  ok(!/\bMargot$/.test(t), `name pair completed or avoided: "${t}" (${t.length})`);
  ok(!FRAG_TAIL.test(t) && inBand(t), `clean + in band: "${t}"`);
}
{
  // LIVE BAD #3: "Army of Shadows Series Casts Paddy Considine, America" (53, splits America Ferrera)
  const t = finishMetaTitle({
    model: "Army of Shadows Series Casts Paddy Considine, America",
    title: "Paddy Considine, America Ferrera, Alex Hassell, Kit Harington Lead 'Army of Shadows' Series",
  });
  ok(!/\bAmerica$/.test(t) && !FRAG_TAIL.test(t), `no split name / fragment: "${t}" (${t.length})`);
  ok(inBand(t), `length 45-65: ${t.length}`);
}
{
  // unbalanced quote must never survive
  const t = finishMetaTitle({ model: "Jimmy Tatro Cast as Gorilla Grodd in 'Superman", title: "Jimmy Tatro Cast as Gorilla Grodd in HBO Max's Jimmy Olsen Superman Spinoff Series" });
  ok(!FRAG_TAIL.test(t), `no fragment tail: "${t}"`);
  // straight quotes that are NOT intra-word apostrophes (Max's, D'Onofrio) must pair up
  const q1 = (t.replace(/(\w)'(\w)/g, "$1$2").replace(/(\w)'s\b/g, "$1s").match(/'/g) || []).length;
  ok(q1 % 2 === 0, `non-apostrophe straight quotes paired (${q1})`);
}
{
  // GOOD in-band metaTitles pass through UNCHANGED (idempotence — the fix must not damage healthy output)
  for (const [model, title] of [
    ["Jimmy Tatro Cast as Gorilla Grodd in Superman Spinoff", "Jimmy Tatro Cast as Gorilla Grodd in HBO Max's Jimmy Olsen Superman Spinoff Series"],
    ["Gabriel Luna Cast in Dexter: Resurrection Season 2", "Gabriel Luna Joins 'Dexter: Resurrection' Season 2 Cast as a Serial Killer"],
    ["It's Always Sunny in Philadelphia Season 18 Premiere", "It's Always Sunny in Philadelphia Sets August 17 Return for Expanded Season 18"],
  ]) {
    const t = finishMetaTitle({ model, title });
    ok(t === model, `unchanged: "${model}" → "${t}"`);
  }
}
{
  // over-55 model with NO clean cut in 45-60 keeps the full ≤65 verbatim (never a fragment)
  const model = "Blue Beetle Superman Sequel: Xolo Maridueña Joins Man of Tomorrow"; // 65 chars, ends clean
  const t = finishMetaTitle({ model, title: "Xolo Maridueña Confirms Blue Beetle's Return for Superman Sequel Man of Tomorrow" });
  ok(!FRAG_TAIL.test(t) && t.length <= 65, `no fragment, ≤65: "${t}" (${t.length})`);
}

console.log("=== 2. driftGuard — the LIVE Bonta wrong-story-metadata case ===");
{
  const article = {
    title: "California AG Rob Bonta Denies CNN Spinoff Would End Paramount Merger Lawsuit",
    dek: "The California attorney general directly refuted a claim by FCC Chair Brendan Carr.",
    about: [],
    imageQuery: "The Swimming Lesson",
  };
  const bodyText = "California Attorney General Rob Bonta denied that a CNN spinoff would end the antitrust lawsuit against the Paramount Warner Bros Discovery merger. FCC Chair Brendan Carr responded on X citing a Puck News report. The Writers Guild filed its own suit.";
  const topic = { primaryKeyword: "the swimming lesson cast", primaryEntity: "The Swimming Lesson", eventSlug: "the-swimming-lesson-casting", eventType: "casting" };
  const tags = ["the swimming lesson cast", "rob bonta", "brendan carr", "paramount-warner bros. discovery merger", "lamorne morris", "abby elliott"];
  const d = driftGuard({ article, topic, tags, bodyText, slug: "california-ag-rob-bonta" });
  ok(d.drifted, "drift detected");
  ok(!/swimming/i.test(d.targetKeyword), `targetKeyword re-derived: "${d.targetKeyword}"`);
  ok(!d.tags.some((t) => /swimming|lamorne|abby/i.test(t)), `foreign tags dropped: [${d.tags.join(", ")}]`);
  ok(d.tags.some((t) => /bonta/i.test(t)) && d.tags.some((t) => /carr/i.test(t)), "real-story tags kept");
  ok(d.eventSlug !== "the-swimming-lesson-casting" && d.eventSlug.length > 0, `eventSlug re-derived: "${d.eventSlug}"`);
  ok(d.eventType === "news", `eventType neutralized: "${d.eventType}"`);
  ok(d.imageQueryOk === false, "crossed imageQuery prefix rejected");
}
{
  // healthy article: NOTHING changes
  const article = { title: "Danny McBride to Direct and Write New G.I. Joe Movie for Paramount", dek: "", about: [], imageQuery: "Danny McBride" };
  const bodyText = "Danny McBride is set to direct and write the next G.I. Joe movie for Paramount Pictures, his feature directorial debut.";
  const topic = { primaryKeyword: "danny mcbride g.i. joe movie", primaryEntity: "Danny McBride", eventSlug: "danny-mcbride-gi-joe", eventType: "hiring" };
  const d = driftGuard({ article, topic, tags: ["danny mcbride", "g.i. joe", "paramount"], bodyText, slug: "x" });
  ok(!d.drifted, "no false drift on a healthy article");
  ok(d.targetKeyword === topic.primaryKeyword && d.eventSlug === topic.eventSlug && d.eventType === "hiring", "inherited fields untouched");
  ok(d.imageQueryOk === true, "matching imageQuery kept");
}

console.log("=== 3. entityFidelity — the LIVE Unleeshed case ===");
{
  const article = {
    title: "Alisha Dhillon, Quentin Lee Reunite for New Vertical Series ‘Unleashed’",
    metaTitle: "Alisha Dhillon, Quentin Lee Reunite for ‘Unleashed’ Series",
    body: "The vertical series ‘Unleashed’ premieres on AAM.tv. “When I first read the pilot for ‘Unleashed,’ I immediately fell in love,” Lee said.",
    faq: [{ q: "What is ‘Unleashed’ about?", a: "The series ‘Unleashed’ follows a standup comic." }],
    tags: ["unleashed vertical series", "unleeshed"],
  };
  const fixed = entityFidelity(article, "Unleeshed");
  const s = JSON.stringify(fixed);
  ok(!/Unleashed/.test(s), "every 'Unleashed' corrected (title, body, FAQ, quote)");
  ok(/Unleeshed/.test(fixed.title) && /Unleeshed/.test(fixed.body), "source spelling restored");
  ok(/first read the pilot for ‘Unleeshed,’/.test(fixed.body), "direct quote restored to the speaker's real words");
}
{
  // must NOT fire when the entity IS present, or on short/absent variants
  const a1 = { title: "The Roman Casts Kate Mara", body: "Netflix's The Roman adds cast." };
  ok(JSON.stringify(entityFidelity(a1, "The Roman")) === JSON.stringify(a1), "no false fire: entity present verbatim");
  const a2 = { title: "Romans season 2 announced", body: "The Romans continues." };
  ok(JSON.stringify(entityFidelity(a2, "Roman")) === JSON.stringify(a2), "no false fire: token under 6 chars skipped");
}

console.log("=== 4. finishMetaDescription — 140-160, complete sentence ===");
{
  // the live pattern: model writes 124-139 chars → topped up from dek/body sentences, never invented
  const d = finishMetaDescription({
    model: "California Attorney General Rob Bonta refutes an FCC claim about the antitrust lawsuit against the merger.", // 108
    dek: "The California attorney general directly refuted a claim by FCC Chair Brendan Carr, clarifying he never said dropping the case was conditional.",
    bodyText: "Bonta leads 12 states in the antitrust challenge filed Monday.",
  });
  ok(d.length >= 140 && d.length <= 160, `in [140,160]: ${d.length}`);
  ok(/[.!?…]$/.test(d), `ends on sentence: "…${d.slice(-25)}"`);
}
{
  const d = finishMetaDescription({ model: "", dek: "Short dek only.", bodyText: "" });
  ok(/[.!?…]$/.test(d) && d.length > 0, `graceful when material is thin (${d.length} chars, complete sentence)`);
}

console.log("=== 5. slugifyTitle — word-boundary cap + diacritics ===");
{
  const s = slugifyTitle("California AG Rob Bonta Denies CNN Spinoff Would End Paramount Merger Lawsuit");
  ok(!/lawsu$/.test(s), `no mid-word cut: "${s}"`);
  ok(s.length <= 75 && /-(lawsuit|merger)$/.test(s), "ends on a whole word");
  const s2 = slugifyTitle("Xolo Maridueña Confirms Blue Beetle's Return for Superman Sequel Man of Tomorrow");
  ok(/mariduena/.test(s2), `diacritics transliterated: "${s2.slice(0, 20)}…"`);
  ok(!/-[a-z]$/.test(s2) || s2.length < 70, `no stray single-letter tail: "${s2}"`);
}

console.log("=== 6. findDuplicate — cross-lane same-story vs same-person-different-story ===");
{
  const recent = [
    { slug: "the-batman-2-delayed-to-2028-fans-are-groaning", title: "The Batman 2 Delayed to 2028, Fans Are Groaning", words: new Set(["batman", "2028", "delay", "fan", "groan"]) },
    { slug: "margot-robbie-andy-serkis-join-venice", title: "Margot Robbie, Andy Serkis Join Venice Film Festival's Immersive Lineup", words: new Set(["margot", "robbie", "andy", "serki", "venice", "festival", "immersive", "lineup"]) },
  ];
  const dup = findDuplicate({ title: "The Batman Part II Slips to 2028 — Fans Joke About Aging Out", primaryEntity: "The Batman Part II", primaryKeyword: "the batman 2 delayed 2028", entities: [], eventSlug: "the-batman-part-ii-2028-delay" }, recent);
  ok(!!dup && /batman/.test(dup.slug), `Batman-2028 re-run caught (shared: ${dup?.shared.join(", ")})`);
  const notDup = findDuplicate({ title: "Margot Robbie to Produce New A24 Thriller", primaryEntity: "Margot Robbie", primaryKeyword: "margot robbie a24 thriller", entities: ["A24"], eventSlug: "margot-robbie-a24-thriller" }, recent);
  ok(!notDup, "same person + DIFFERENT story survives (margot robbie only shares 2 stems)");
  const notDup2 = findDuplicate({ title: "Jimmy Tatro Cast as Gorilla Grodd in Superman Spinoff", primaryEntity: "Jimmy Tatro", primaryKeyword: "jimmy tatro gorilla grodd", entities: [], eventSlug: "x" }, recent);
  ok(!notDup2, "unrelated story untouched");
}

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
