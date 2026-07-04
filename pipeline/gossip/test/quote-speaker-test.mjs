// QUOTE-SPEAKER guard test — a verbatim-real quote credited to the WRONG person is a fabrication the text-check
// misses (the Taylor-Swift-line-attributed-to-Kelce bug). The guard resolves names through a bundle-built map so
// "Swift"/"Taylor" are the same person — this is what stops it from cutting a legit quote on a name variant.
// Run: node .../quote-speaker-test.mjs
import { verifyQuotes, checkQuoteSpeakers } from "../quoteGuard.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== QUOTE-SPEAKER GUARD TEST ===\n");

const QUOTE = "But I'm wearing Louboutins. Like, it is a privilege for my feet to ache like this";
// source1 ties the quote to SWIFT; source2 establishes both full names for the resolver map.
const bundle = { sources: [
  { outlet: "E!", text: `In a 2025 documentary, Taylor Swift reflected on her tour footwear. "${QUOTE}," Swift said with a laugh about her red-soled heels.` },
  { outlet: "WWD", text: "Taylor Swift married Travis Kelce on July 3, 2026 at Madison Square Garden in a Christian Dior gown." },
] };

// 1) THE BUG: the quote is Swift's, but the article credits Kelce → flagged.
{
  const article = { title: "", dek: "", body: `As for the pain, she might just agree with the sentiment Kelce once shared: "${QUOTE}," he said in a past interview.` };
  const mis = checkQuoteSpeakers(article, bundle);
  check("a verbatim quote credited to the WRONG person (Kelce, source says Swift) is flagged", mis.some((m) => /Kelce/.test(m)), JSON.stringify(mis));
  const qc = verifyQuotes(article, bundle);
  check("verifyQuotes reports it (ok=false, in badQuotes)", qc.ok === false && qc.badQuotes.some((b) => /attributed to Kelce/.test(b)));
}

// 2) NO false positive: correctly attributed to Swift → not flagged.
{
  const article = { title: "", dek: "", body: `Reflecting on the pain, Swift said, "${QUOTE}."` };
  check("a correctly-attributed quote (Swift) is NOT flagged", checkQuoteSpeakers(article, bundle).length === 0);
}

// 3) NO false positive on a NAME VARIANT: article uses surname 'Swift', source window uses first name 'Taylor'.
{
  const b2 = { sources: [
    { outlet: "E!", text: `Taylor reflected on her heels. "${QUOTE}," Taylor said with a laugh.` },
    { outlet: "WWD", text: "Taylor Swift wore custom Louboutins to her wedding." },
  ] };
  const article = { title: "", dek: "", body: `Swift said, "${QUOTE}."` };
  check("surname-vs-firstname variant (Swift vs Taylor) does NOT false-flag", checkQuoteSpeakers(article, b2).length === 0, JSON.stringify(checkQuoteSpeakers(article, b2)));
}

// 4) NO flag on a pronoun-only attribution (no named speaker to check).
{
  const article = { title: "", dek: "", body: `She laughed. "${QUOTE}," she said quietly.` };
  check("a pronoun-only ('she said') attribution is skipped, not flagged", checkQuoteSpeakers(article, bundle).length === 0);
}

// 5) NO flag when the article names a speaker we can't resolve to a bundle person (avoid damage on unknowns).
{
  const article = { title: "", dek: "", body: `Beyonce said, "${QUOTE}."` };
  check("an unresolvable speaker (not in the bundle) is skipped, not flagged", checkQuoteSpeakers(article, bundle).length === 0);
}

// 6) a quote NOT in the source at all is still caught by the existing text-check (unchanged behavior).
{
  const article = { title: "", dek: "", body: `Swift said, "I have never worn heels once in my entire life, not even to a single show."` };
  const qc = verifyQuotes(article, bundle);
  check("a fabricated (not-in-source) quote is still flagged by the text-check", qc.ok === false);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Quote-speaker guard green. ✅\n");
