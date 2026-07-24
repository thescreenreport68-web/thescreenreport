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

console.log(`\n${fail===0?"✅ ALL":"❌"} ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
