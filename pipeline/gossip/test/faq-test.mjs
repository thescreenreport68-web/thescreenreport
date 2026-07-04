// FAQ test — every published article must carry relevant FAQs WITH real answers (owner UI/UX requirement). When the
// writer returns no FAQ, the fallback must build Q&A from CONFIRMED facts (real answers), not "not confirmed"
// placeholders. Run: node .../faq-test.mjs
import { ensureFaq } from "../polish.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== FAQ TEST ===\n");

// 1) writer's own FAQ (real answers) is kept as-is.
{
  const a = { faq: [{ q: "Who designed the dress?", a: "Jonathan Anderson for Christian Dior." }] };
  const out = ensureFaq(a);
  check("a writer FAQ with real answers is kept", out.length === 1 && out[0].a.includes("Anderson"));
}

// 2) no writer FAQ but confirmed facts → Q&A with REAL answers (not placeholders).
{
  const a = { faq: [], primaryEntity: "Bunnie Xo", whatWeKnow: [
    "Bunnie Xo announced her acceptance to Arizona State University via Instagram Story.",
    "Jelly Roll filed for divorce from Bunnie Xo on May 18, 2026.",
  ], whatWeDont: ["The degree program she'll pursue."] };
  const out = ensureFaq(a);
  check("fallback builds FAQs from confirmed facts", out.length === 2);
  check("every fallback answer is a REAL fact, not the 'not confirmed' placeholder", out.every((f) => !/not been confirmed|not confirmed|unknown/i.test(f.a)));
  check("answers carry the actual facts", out.some((f) => /Arizona State/.test(f.a)) && out.some((f) => /divorce/.test(f.a)));
  check("questions are non-empty and distinct", out.every((f) => f.q && f.q.length > 5) && new Set(out.map((f) => f.q)).size === out.length);
}

// 3) only unknowns available → placeholder is the LAST resort (still Q&A, honest).
{
  const a = { faq: [], whatWeKnow: [], whatWeDont: ["Whether the couple will reconcile."] };
  const out = ensureFaq(a);
  check("with only unknowns, still returns an FAQ (last-resort placeholder)", out.length === 1 && out[0].q && out[0].a);
}

// 4) an FAQ item with an empty answer is not counted as a real FAQ (falls through to fact-based build).
{
  const a = { faq: [{ q: "Q?", a: "" }], whatWeKnow: ["Taylor Swift wore a Christian Dior gown."] };
  const out = ensureFaq(a);
  check("an empty-answer FAQ is replaced by a real fact-based one", out.every((f) => f.a && f.a.trim()) && out.some((f) => /Dior/.test(f.a)));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("FAQ green. ✅\n");
