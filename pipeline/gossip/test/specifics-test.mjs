// SPECIFICS VERIFICATION (the accuracy spine). Tests the deterministic FLOOR inside verifyGate — every number,
// year, month-date, and italic work-title in the body must appear in the source; an invented one is flagged even
// with the LLM down — plus the tightened quoteGuard (contiguous match). Run: node .../specifics-test.mjs
import { _internals, verifyGate } from "../verifyGate.mjs";
import { verifyQuotes } from "../quoteGuard.mjs";
const { extractDeterministicSpecifics } = _internals;

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== SPECIFICS VERIFICATION + QUOTE GUARD ===\n");

// ── extractDeterministicSpecifics ──
{
  const s = extractDeterministicSpecifics('They gave $26 million in 2026, up 12% to 1,200 guests on July 3, and released *Confessions II*.');
  const texts = s.map((x) => x.text);
  check("extracts a $ amount", texts.some((t) => /\$26 million/.test(t)));
  check("extracts a year", texts.includes("2026"));
  check("extracts a percentage", texts.some((t) => /12\s?%/.test(t)));
  check("extracts a 3+ digit count", texts.some((t) => /1,200/.test(t)));
  check("extracts a month-date", texts.some((t) => /July 3/.test(t)));
  check("extracts an italic work title", texts.includes("Confessions II"));
}

// ── deterministic FLOOR (via verifyGate with the LLM stubbed off) — an INVENTED specific is flagged; grounded passes ──
const bundle = { sources: [{ outlet: "Just Jared", text: "The couple donated $26 million to charity in 2026. About 1,000 guests attended the ceremony on July 3." }] };
const llmOff = async () => ({ list: [], ran: false }); // LLM down → only the deterministic floor runs

{
  const good = { body: "According to Just Jared, they gave $26 million in 2026 with 1,000 guests present on July 3.", claims: [] };
  const v = await verifyGate({ article: good, bundle, llmImpl: llmOff });
  check("grounded numbers/years/dates PASS the deterministic floor", v.ok, JSON.stringify(v.unsupported.map((u) => u.claim)));
}
{
  const bad = { body: "They gave $40 million in 2019 — a wrong figure and a wrong year the source never states.", claims: [] };
  const v = await verifyGate({ article: bad, bundle, llmImpl: llmOff });
  check("an INVENTED $ amount is flagged (even LLM down)", v.unsupported.some((u) => /\$40 million/.test(u.claim) && u.isSpecific));
  check("an INVENTED year is flagged (even LLM down)", v.unsupported.some((u) => /2019/.test(u.claim)));
  check("every deterministic flag is marked isSpecific", v.unsupported.every((u) => u.isSpecific === true));
}
{
  const badTitle = { body: "The scandal is detailed in her memoir *Totally Invented Title*, out now.", claims: [] };
  const v = await verifyGate({ article: badTitle, bundle, llmImpl: llmOff });
  check("an INVENTED work title is flagged", v.unsupported.some((u) => /Totally Invented Title/.test(u.claim) && u.kind === "title"));
}

// ── quoteGuard: contiguous vs scattered ──
const qbundle = { sources: [{ text: "One attendee said, \"Last night I was 100 percent emotional and I left my whole crew behind screaming down the street.\" She was upset the show never started; many fans cried in the lot." }] };
check("a near-verbatim CONTIGUOUS quote passes", verifyQuotes({ title: "t", dek: "d", body: 'A fan said, "Last night I was 100 percent emotional and I left my whole crew behind."' }, qbundle).ok);
check("a FABRICATED quote built from scattered words is FLAGGED", !verifyQuotes({ title: "t", dek: "d", body: 'Another fan added, "She was so mad, she cried the whole time waiting."' }, qbundle).ok);

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Specifics verification + quote guard green. ✅\n");
