// STRUCTURED-FIELDS ACCURACY test — proves the verifier + cleanse now hold keyTakeaways / whatWeKnow / dek / FAQ
// answers to the SAME specifics bar as the body (the "filed May 18, 2024" wrong-year bug lived ONLY in the
// structured fields and bypassed the body-only verifier). LLM is stubbed OFF so the DETERMINISTIC floor is what's
// under test — it must catch an invented specific even when the LLM is down. Run: node .../structured-fields-test.mjs
import { verifyGate, readerFacingText } from "../verifyGate.mjs";
import { scrubStructuredFields, applyCorrections } from "../polish.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
const llmOff = async () => ({ list: [], ran: false });

console.log("\n=== STRUCTURED-FIELDS ACCURACY TEST ===\n");

// The real bundle says the filing was May 18, 2026. The body (no year) is fine; the WRONG year lives only in the
// structured fields — exactly the Bunnie Xo case.
const bundle = { sources: [{ outlet: "Page Six", text: "Jelly Roll filed for divorce from Bunnie Xo on May 18, 2026 in Williamson County, Tennessee, citing irreconcilable differences." }] };

// 1) THE BUG: a wrong year in keyTakeaways + whatWeKnow (never in the body) is now caught, LLM-off.
{
  const article = {
    body: "Last month, Jelly Roll filed for divorce on May 18, citing irreconcilable differences.",
    keyTakeaways: ["Jelly Roll filed for divorce from Bunnie Xo on May 18, 2024, as confirmed by Page Six."],
    whatWeKnow: ["Jelly Roll filed for divorce from Bunnie Xo on May 18, 2024, as confirmed by Page Six."],
    claims: [],
  };
  const v = await verifyGate({ article, bundle, llmImpl: llmOff });
  check("a wrong year that lives ONLY in keyTakeaways/whatWeKnow is flagged (deterministic)", v.unsupported.some((u) => /2024/.test(u.claim) && u.kind === "date"), JSON.stringify(v.unsupported.map((u) => u.claim)));
  check("the flagged wrong-year is marked isSpecific", v.unsupported.some((u) => /2024/.test(u.claim) && u.isSpecific === true));
}

// 2) readerFacingText covers the ASSERTING fields but NOT whatWeDont / FAQ questions (those state unknowns).
{
  const article = {
    title: "T", dek: "D", body: "B", pullQuote: "P",
    keyTakeaways: ["KT-alpha"], whatWeKnow: ["WK-bravo"],
    whatWeDont: ["WD-charlie"], faq: [{ q: "FQ-delta?", a: "FA-echo" }],
  };
  const t = readerFacingText(article);
  check("readerFacingText includes body + takeaways + whatWeKnow + pullQuote + FAQ answers", ["B", "KT-alpha", "WK-bravo", "P", "FA-echo"].every((x) => t.includes(x)));
  check("readerFacingText EXCLUDES whatWeDont + FAQ questions (they state unknowns, not claims)", !t.includes("WD-charlie") && !t.includes("FQ-delta"));
}

// 3) CORRECT path: given the source's right value, the wrong specific is fixed EVERYWHERE (body + every field).
{
  const article = {
    body: "Jelly Roll filed on May 18, 2024.",
    dek: "The split was filed May 18, 2024.",
    keyTakeaways: ["Filed for divorce on May 18, 2024, per Page Six."],
    whatWeKnow: ["Filed for divorce on May 18, 2024."],
    faq: [{ q: "When was it filed?", a: "It was filed on May 18, 2024." }],
    whatWeDont: ["What the settlement terms are."],
  };
  const corrections = [{ bad: "2024", correction: "2026" }];
  article.body = applyCorrections(article.body, corrections);
  scrubStructuredFields(article, { corrections, drops: [] });
  check("correction fixes the body", /2026/.test(article.body) && !/2024/.test(article.body));
  check("correction fixes keyTakeaways", article.keyTakeaways[0].includes("2026") && !article.keyTakeaways[0].includes("2024"));
  check("correction fixes whatWeKnow", article.whatWeKnow[0].includes("2026"));
  check("correction fixes the FAQ answer", article.faq[0].a.includes("2026") && !article.faq[0].a.includes("2024"));
  check("an unrelated whatWeDont item is untouched", article.whatWeDont[0] === "What the settlement terms are.");
}

// 4) DROP path: an uncorrectable invented specific removes the offending bullet/FAQ but keeps clean ones.
{
  const article = {
    body: "text",
    keyTakeaways: ["She danced to Kesha's Grow-a-Pear-9000 track.", "She was accepted to Arizona State University."],
    whatWeKnow: ["The invented figure was $9,999,999.", "She announced it on Instagram."],
    faq: [{ q: "What track?", a: "The Grow-a-Pear-9000 track." }, { q: "Where?", a: "On Instagram." }],
  };
  scrubStructuredFields(article, { corrections: [], drops: ["Grow-a-Pear-9000", "$9,999,999"] });
  check("a takeaway carrying an uncorrectable invented specific is dropped", !article.keyTakeaways.some((t) => /Grow-a-Pear-9000/.test(t)));
  check("the clean takeaway survives", article.keyTakeaways.some((t) => /Arizona State/.test(t)));
  check("a whatWeKnow bullet with an invented number is dropped", !article.whatWeKnow.some((t) => /9,999,999/.test(t)) && article.whatWeKnow.some((t) => /Instagram/.test(t)));
  check("the FAQ entry with the invented specific is dropped, the clean one kept", article.faq.length === 1 && article.faq[0].a.includes("Instagram"));
}

// 5) NO false positive: a GROUNDED specific in a takeaway (present in the source) passes clean.
{
  const article = {
    body: "Jelly Roll filed on May 18.",
    keyTakeaways: ["Jelly Roll filed for divorce on May 18, 2026 in Williamson County."],
    whatWeKnow: ["Filed in Williamson County, Tennessee, citing irreconcilable differences."],
    claims: [],
  };
  const v = await verifyGate({ article, bundle, llmImpl: llmOff });
  check("a grounded takeaway specific (2026, in source) is NOT flagged", v.ok, JSON.stringify(v.unsupported.map((u) => u.claim)));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Structured-fields accuracy spine green. ✅\n");
