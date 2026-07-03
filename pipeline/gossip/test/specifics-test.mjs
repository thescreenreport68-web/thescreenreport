// WS3 — "names & numbers not misplaced". Proves the deterministic specifics-guard (numbers + outlet attribution)
// and the tightened quoteGuard (contiguous match, no scattered-word false positives). Run: node .../specifics-test.mjs
import { checkSpecifics, extractNumbers } from "../specificsGuard.mjs";
import { verifyQuotes } from "../quoteGuard.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== WS3 SPECIFICS GUARD + QUOTE GUARD ===\n");

// ── extractNumbers ──
{
  const nums = extractNumbers("Taylor donated $26 million in 2026; ratings up 12% to 1,200 guests.");
  check("extracts a $ amount", nums.has("$26m"));
  check("extracts a 4-digit year", nums.has("y2026"));
  check("extracts a percentage", nums.has("12%"));
  check("extracts a 3+ digit count", nums.has("1200"));
}

// ── checkSpecifics: numbers ──
const bundle = { sources: [{ outlet: "Just Jared", text: "The couple donated $26 million to charity in 2026, according to Variety. About 1,000 guests attended." }] };
{
  const good = { body: "According to Variety, they gave $26 million in 2026, with 1,000 guests present." };
  const r = checkSpecifics(good, bundle);
  check("grounded numbers pass", r.ok && r.badNumbers.length === 0, JSON.stringify(r.badNumbers));
}
{
  const bad = { body: "They gave $40 million in 2019 — a wrong figure and a wrong year not in the source." };
  const r = checkSpecifics(bad, bundle);
  check("a MISPLACED $ amount is flagged", r.badNumbers.includes("$40m"), JSON.stringify(r.badNumbers));
  check("a MISPLACED year is flagged", r.badNumbers.includes("y2019"), JSON.stringify(r.badNumbers));
}

// ── checkSpecifics: outlet attribution ──
{
  const good = { body: "According to Variety, the pair donated the money." };
  check("a KNOWN outlet that IS in the bundle passes", checkSpecifics(good, bundle).badOutlets.length === 0);
}
{
  const wrong = { body: "According to People, the pair donated the money." }; // People is a known outlet, NOT in the bundle
  const r = checkSpecifics(wrong, bundle);
  check("a KNOWN outlet NOT in the bundle is flagged (misplaced attribution)", r.badOutlets.some((o) => /People/i.test(o)), JSON.stringify(r.badOutlets));
}
{
  const celeb = { body: "According to Selena Gomez, the night was fun." }; // a person, not a known outlet → not flagged
  check("a non-outlet proper name is NOT flagged as an outlet", checkSpecifics(celeb, bundle).badOutlets.length === 0);
}

// ── quoteGuard: contiguous vs scattered ──
const qbundle = { sources: [{ text: "One attendee said, \"Last night I was 100 percent emotional and I left my whole crew behind screaming down the street.\" She was upset the show never started, and many fans later cried in the parking lot." }] };
{
  const okQuote = { title: "t", dek: "d", body: 'A fan said, "Last night I was 100 percent emotional and I left my whole crew behind."' };
  check("a near-verbatim CONTIGUOUS quote passes", verifyQuotes(okQuote, qbundle).ok, JSON.stringify(verifyQuotes(okQuote, qbundle).badQuotes));
}
{
  // "She was mad, she cried" — a FABRICATED sentence whose words (was/she/cried) are scattered across the source
  const fabricated = { title: "t", dek: "d", body: 'Another fan added, "She was so mad, she cried the whole time waiting."' };
  const r = verifyQuotes(fabricated, qbundle);
  check("a FABRICATED quote built from scattered words is now FLAGGED", !r.ok && r.badQuotes.length > 0, JSON.stringify(r.badQuotes));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("WS3 specifics + quote guard green. ✅\n");
