// DATE-ATTACHMENT test — the root-cause fix for wrong background/historical YEARS. The old floor only checked a
// year was PRESENT in the source; the writer's real error is MISATTACHING a present year (source: "dating since
// 2023" → article: "engaged in 2023"). This guard catches that deterministically (LLM off), synonym-aware, and
// must NOT false-flag a correctly-attributed year. Run: node .../date-attachment-test.mjs
import { verifyGate } from "../verifyGate.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
const llmOff = async () => ({ list: [], ran: false });
const V = async (body, bundleText) => verifyGate({ article: { title: "", dek: "", body, claims: [] }, bundle: { sources: [{ outlet: "S", text: bundleText }] }, llmImpl: llmOff });

console.log("\n=== DATE-ATTACHMENT TEST ===\n");

// 1) THE BUG: engagement year misattached (2023 is the DATING year in the source).
{
  const v = await V("The relationship led to an engagement announcement in August 2023.",
    "Swift and Kelce began dating in 2023 and married July 3, 2026 at MSG. Their engagement was announced in August 2025.");
  check("misattached engagement year (2023 = dating year) is FLAGGED", v.unsupported.some((u) => /2023/.test(u.claim) && u.problem === "misattached"), JSON.stringify(v.unsupported.map((u) => u.claim)));
}
// 2) NO false positive: engagement year correct (source ties 2025 to the engagement).
{
  const v = await V("They got engaged in August 2025 after two years together.",
    "Their engagement was announced in August 2025 at a garden party.");
  check("correct engagement year (source ties 2025 to engagement) is NOT flagged", !v.unsupported.some((u) => /2025/.test(u.claim)), JSON.stringify(v.unsupported.map((u) => u.claim)));
}
// 3) NO false positive: a year with no historical-EVENT anchor is not attachment-checked.
{
  const v = await V("She performed at the 2024 Grammys in a red dress.", "The 2024 Grammys took place in February 2024.");
  check("a year not tied to an event anchor is not misattach-flagged", !v.unsupported.some((u) => u.problem === "misattached"));
}
// 4) NO false positive: synonym-aware ('wed' ≈ 'married') near the year in the source.
{
  const v = await V("Sharon and Ozzy wed in 1982.", "Ozzy and Sharon Osbourne married on July 4, 1982 in Maui, Hawaii.");
  check("synonym (wed≈married) near 1982 in source → NOT flagged", !v.unsupported.some((u) => /1982/.test(u.claim)), JSON.stringify(v.unsupported.map((u) => u.claim)));
}
// 5) THE KELLY CASE: 'married since 1980' but the source ties 1980 to a different event (his solo debut). The guard
//    is CONSERVATIVE — it flags only when the source's nearest event to the year is a DIFFERENT group (so a correct
//    date is never cut). Subtler "years before/after" phrasings are left to the L3 LLM + the writer rule.
{
  const v = await V("Kelly noted her parents had been married since 1980.",
    "Ozzy Osbourne released his debut solo album in 1980. The record went platinum.");
  check("'married since 1980' where source ties 1980 to his album → FLAGGED (misattached)", v.unsupported.some((u) => /1980/.test(u.claim)), JSON.stringify(v.unsupported.map((u) => u.claim)));
}
// 6) a background year ABSENT from the source is still caught (by the L2 invented floor).
{
  const v = await V("They married in 1975.", "The couple married at Madison Square Garden on July 3.");
  check("a background year absent from the source is still flagged", v.unsupported.some((u) => /1975/.test(u.claim)));
}
// 7) NO false positive: multiple mentions — the event word is near the year at one occurrence.
{
  const v = await V("The band, formed in 1994, is touring again.",
    "Oasis released records for years. The band was formed in 1994 in Manchester. In 1994 they signed to Creation.");
  check("a year with the event anchor near ONE of its source occurrences → NOT flagged", !v.unsupported.some((u) => /1994/.test(u.claim)));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Date-attachment green. ✅\n");
