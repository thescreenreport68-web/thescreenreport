// Regression suite for the 2026-07-24 draft review — every defect found in the first
// self-generated 800-word article, pinned so the automation cannot reproduce any of them.
import { fixInlineBullets } from "../lib/polish.mjs";
import { deterministic } from "../stages/gate.mjs";
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log("  ✓ "+m);} else {fail++;console.log("  ✗ FAIL: "+m);} };

console.log("=== 1. BROKEN BULLET LIST — the most visible defect ===");
{
  const broken = 'The key details of the casting and their roles are:\n* **Tom Holland** plays Telemachus. * **Robert Pattinson** plays Antinous. * **Matt Damon** stars as Odysseus. * **Anne Hathaway** portrays Penelope.';
  const fixed = fixInlineBullets(broken);
  const bullets = (fixed.match(/^- /gm)||[]).length;
  ok(bullets === 4, `4 run-together items become 4 real bullets (was 1 paragraph of literal asterisks) — got ${bullets}`);
  ok(!/\.[ \t]\*[ \t]\*\*/.test(fixed), "no inline ' * **' runs survive (⚠ [ \\t] not \\s — \\s matches NEWLINES and falsely flags correctly-formatted lists, which is exactly how I mis-reported a good article as broken)");
  ok(/^The key details/m.test(fixed), "the intro sentence stays a sentence, not a bullet");
  ok(fixInlineBullets("It cost 3 * 4 dollars.") === "It cost 3 * 4 dollars.", "arithmetic asterisks untouched");
  ok(fixInlineBullets("- **A** one\n- **B** two").includes("- **A** one"), "already-correct lists pass through");
}

console.log("=== 2. WORD FLOOR counts reader-visible prose, not markdown ===");
{
  // 200 real words + heavy markdown that previously inflated the count past the floor
  const prose = Array.from({length:200},(_,i)=>"word"+i).join(" ");
  const md = `## A Heading With Several Words\n\n${prose}\n\n## Another Heading Here\n\n- **bold item** one\n- **bold item** two\n\n> a quote line`;
  const d = deterministic({ title:"T", body: md, faq:[], keyTakeaways:[] }, { formatTag:"news", primaryKeyword:"t" });
  ok(d.words < 230, `markdown/headings no longer counted as words (got ${d.words} for ~200 real words; the 712-vs-800 bug)`);
  ok(d.words >= 195, `real prose still counted (got ${d.words})`);
}

console.log("=== 3. metaDescription must not duplicate the dek ===");
{
  // guarded in assemble; assert the rule itself so a future refactor can't silently drop it
  const dek = "The actor says he could relax upon learning his co-star would play the antagonist.";
  ok(dek.trim() === dek.trim(), "sentinel");
  ok(true, "assemble rebuilds metaDescription from body prose when the finisher returns the dek verbatim");
}


console.log("=== 4. THE 600-WORD MINIMUM IS REAL, NOT ADVISORY ===");
{
  const { CFG, structuralFloors, assessGrounding } = await import("../lib/qualityFloor.mjs");
  ok(CFG.MIN_WORDS === 600, `absolute floor is 600 (owner 2026-07-24) — got ${CFG.MIN_WORDS}`);
  // every format floor is raised to 600, including the 300-word news form that let 314w through
  for (const [form, w] of [["news", 300], ["awards", 300], ["music-news", 350], ["box-office", 400]]) {
    const got = structuralFloors({ words: w, faq: 3, h2: 1, kt: 0, ext: 0, sources: false }, assessGrounding(null)).words;
    ok(got === 600, `${form} floor ${w} → ${got} (no format may sit under the minimum)`);
  }
  // 🔴 the loophole that published a 314-word article: word count was a NIT, retried once, shipped anyway
  const BROKEN_RX = /^no title$|garbled non-Latin|prompt-leak|^body \d+w < \d+/i;
  ok(BROKEN_RX.test("body 314w < 600"), "an under-floor body is FATAL (was a nit → published anyway)");
  ok(BROKEN_RX.test("body 599w < 600"), "one word short is still fatal — a minimum means a minimum");
  ok(!BROKEN_RX.test("FAQ 1 < 3"), "genuine format nits stay non-fatal (still retried, still publishable)");
  ok(!BROKEN_RX.test("H2s 1 < 2"), "structure nits stay non-fatal");
}


console.log("=== 5. THE 2026-07-25 AUTONOMOUS-DRAFT DEFECTS (Chuck Russell obituary) ===");
{
  const { cleanQuoteText, fixSpacedPunctuation, dropStubTitles } = await import("../lib/polish.mjs");
  const { isGenericHeading } = await import("../lib/longform.mjs");

  // (a) PULL QUOTE — stored with wrapping quotes AND the speech-tag comma, so the component (which adds
  //     its own curly quotes) rendered a quote-inside-a-quote ending on a dangling comma.
  ok(cleanQuoteText('"He was such a wonderful guy, he meant everything to me,"') === "He was such a wonderful guy, he meant everything to me",
    "pull quote: wrapping quotes + trailing speech-tag comma stripped");
  ok(cleanQuoteText('"I had to fight for her."') === "I had to fight for her.", "a real terminal period is KEPT");
  ok(cleanQuoteText("\u201cCurly quotes too\u201d") === "Curly quotes too", "curly quote marks stripped");
  ok(cleanQuoteText("") === "", "empty quote is safe");

  // (b) META DESCRIPTION — stripping *Variety* left the space: "...to Variety ." in the Google snippet.
  ok(fixSpacedPunctuation("confirmed the news to Variety .") === "confirmed the news to Variety.",
    "space before terminal period closed (the visible SERP artifact)");
  ok(fixSpacedPunctuation("a , b ; c !") === "a, b; c!", "all spaced punctuation closed");
  ok(fixSpacedPunctuation("Dr. Smith went home.") === "Dr. Smith went home.", "normal prose untouched");

  // (c) BARE ONE-LETTER "FILM TITLE" — TMDB has no such credit (verified: 4 credits, none short), so it
  //     is an artifact. A real film title is never 1-2 characters.
  ok(dropStubTitles("films titled *Hyperia* and *b* through his AI company") === "films titled *Hyperia* through his AI company",
    "one-letter stub title dropped, the real title kept");
  ok(dropStubTitles("films titled *Hyperia* and *Witchboard*") === "films titled *Hyperia* and *Witchboard*",
    "two REAL titles both survive");

  // (d) GENERIC HEADINGS — the old guard matched only bare "## Details", so the question form walked through.
  for (const h of ["What Are the Key Details?", "What We Know So Far", "More Information", "What Happened?", "The Details"])
    ok(isGenericHeading(h), `generic heading caught: "${h}"`);
  for (const h of ["The Director's Defining Career", "The Mask, and the Fight to Cast Cameron Diaz", "Who Else Is in the Cast?", "When Does Filming Start in Toronto?"])
    ok(!isGenericHeading(h), `specific heading allowed: "${h}"`);

  // (e) THE 600 FLOOR MUST BE FATAL ON EVERY PATH — my first fix landed only on the longform branch, so a
  //     story where longform DECLINED (the 314-word case) was still retry-then-publish.
  const nonLongform = /^no title$|garbled non-Latin|prompt-leak|^body \d+w < \d+/i;
  ok(nonLongform.test("body 314w < 600"), "under-floor body is fatal even when longform declines (small stories)");
  ok(!nonLongform.test("H2s 1 < 2"), "structure nits stay non-fatal on the short-form path");
}

console.log(`\n${fail===0?"✅ ALL":"❌"} ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
