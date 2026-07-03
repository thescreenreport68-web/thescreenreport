// DEV-ONLY unit test (no network): prove the deterministic verbatim-quote guard (Phase B). A quote in the
// article must be a real substring of the gathered source bundle AND not lifted out of a denial.
import { verifyQuotes } from "../lib/quoteGuard.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ FAIL: " + m); } };
const bundle = (text) => ({ sources: [{ text }] });

console.log("=== a VERBATIM quote present in the source passes ===");
ok(verifyQuotes({ body: 'She said, "I am beyond grateful for this moment."' },
  bundle('In a statement, the actress said, "I am beyond grateful for this moment."')).ok,
  "exact quote present in the bundle → ok");

console.log("=== a FABRICATED / ALTERED quote is flagged ===");
const r1 = verifyQuotes({ body: 'He called it "the greatest betrayal of his career."' },
  bundle("The director described the studio decision as disappointing but understandable."));
ok(!r1.ok && r1.badQuotes.length === 1, "invented quote not in the bundle → flagged");

console.log("=== a quote LIFTED OUT OF A DENIAL is flagged even if the words are present ===");
const r2 = verifyQuotes({ body: 'The report claims the actor "used performance enhancers" on set.' },
  bundle('His rep firmly denies he used performance enhancers during filming, calling the story false.'));
ok(!r2.ok && /denial/.test(r2.badQuotes[0] || ""), "verbatim-but-from-a-denial → flagged with the denial note");

console.log("=== checks the headline + dek too, not just the body ===");
const r3 = verifyQuotes({ title: 'Star Slams "Toxic Set Culture" in New Interview', dek: "", body: "x" },
  bundle("The actor spoke warmly about the cast and crew and praised the working environment."));
ok(!r3.ok, "fabricated quote in the TITLE → flagged");

console.log("=== no bundle text (structured-fact-only grounding) → nothing to check, ok ===");
ok(verifyQuotes({ body: 'Someone said "anything at all here."' }, { sources: [] }).ok, "empty bundle → ok (verifyGate handles it)");

console.log("=== a single-word scare-quote is ignored (not a real quote) ===");
ok(verifyQuotes({ body: 'The so-called "reboot" arrives next year.' }, bundle("A new version of the franchise is planned.")).ok,
  "single-word scare-quote → not treated as a quote");

console.log("=== QG-1: a denial in a PRIOR sentence must NOT false-flag a legit quote in the next sentence ===");
ok(verifyQuotes({ body: 'She said, "I love this role and this cast."' },
  bundle('The studio denied the report. In a new interview she said, "I love this role and this cast."')).ok,
  "denial in the previous sentence → the clean quote is NOT flagged (sentence-bounded)");

console.log("=== QG-5: 85%-token match must be WORD-BOUNDARY (a fabricated quote of sub-word fragments is flagged) ===");
const r5 = verifyQuotes({ body: 'He called it "art star part" on the record.' },
  bundle("The crew worked apart as filming started in a remote department."));
ok(!r5.ok, "tokens that are only SUBSTRINGS of source words (art⊂apart, star⊂started, part⊂department) → flagged, not passed");

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
