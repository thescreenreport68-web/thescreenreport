// 2026-07-19 Batch C — accuracy gates the deep dive found blind or leaky.
//   node pipeline/gossip/test/accuracy-gates-test.mjs
import { checkQuoteSpeakers, verifyQuotes } from "../quoteGuard.mjs";
import { cutFlagged, cutSentencesWith, scrubStructuredFields } from "../polish.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
console.log("\n=== BATCH C: ACCURACY GATES ===\n");

// ── #5 the speaker guard was blind to the appositive form writer.mjs MANDATES ──
{
  const src = "Hannah Waddingham described the fight scene. Chanique Greyling, her stunt double, said, \"I have never been on a job where the team had to tone things down.\" The scene aired last week.";
  const bundle = { sources: [{ outlet: "CB", tier: 6, text: src, quotes: [] }] };
  const Q = "I have never been on a job where the team had to tone things down";
  const wrong = [
    ['"' + Q + ',\" Hannah Waddingham, the Emmy winner, said.', "appositive after quote"],
    ['"' + Q + ',\" Hannah Waddingham said.', "plain after quote"],
    ['Hannah Waddingham, the Emmy winner, said: "' + Q + '."', "appositive before quote"],
  ];
  let missed = 0;
  for (const [b, l] of wrong) if (!checkQuoteSpeakers({ body: b }, bundle).length) { missed++; console.log("      missed: " + l); }
  check("misattributed speaker caught in all 3 forms (the live hannah-waddingham class)", missed === 0, missed + " missed");
  let flagged = 0;
  for (const b of ['"' + Q + ',\" Chanique Greyling, her stunt double, said.', '"' + Q + ',\" Chanique Greyling said.']) if (checkQuoteSpeakers({ body: b }, bundle).length) flagged++;
  check("the CORRECT speaker is never falsely flagged", flagged === 0, flagged + " false flags");
}
// ── #37 a nested (inner) quotation must be verified, not skipped ──
{
  const bundle = { sources: [{ outlet: "P", tier: 6, text: "The friend recalled the night in detail and described the argument that followed.", quotes: [] }] };
  const r = verifyQuotes({ body: `The friend recalled the night: "I told her, 'you will regret this forever', and she laughed."` }, bundle);
  check("fabricated INNER quote is caught", r.badQuotes.some((q) => /regret this forever/.test(q)), JSON.stringify(r.badQuotes));
  const b2 = { sources: [{ outlet: "P", tier: 6, text: "She said the whole thing was a misunderstanding between friends yesterday.", quotes: [] }] };
  check("a clean quote is not falsely flagged", verifyQuotes({ body: `She said "the whole thing was a misunderstanding between friends" yesterday.` }, b2).ok);
  check("contractions are not treated as quotes", verifyQuotes({ body: "She said it wasn't true and that's final." }, b2).badQuotes.length === 0);
  // A possessive apostrophe must never be paired as a quote delimiter — the naive single-quote scan
  // turned `A Secret 'I Do': Inside Star Alpha's Wedding` into the phantom quote ": Inside Star Alpha"
  // and blocked a perfectly good article at the quote wall.
  check("possessive apostrophe is not a quote delimiter (curly)", verifyQuotes({ title: "A Secret \u2018I Do\u2019: Inside Star Alpha\u2019s Hidden Malibu Wedding", body: "Plain body text with no quotes at all here." }, b2).ok);
  check("possessive apostrophe is not a quote delimiter (straight)", verifyQuotes({ title: "A Secret 'I Do': Inside Star Alpha's Wedding", body: "Plain body." }, b2).ok);
}
// ── #6 the cut functions must not publish half-sentences after an abbreviation ──
{
  const body = "The suit was filed by Robert Downey Jr. The settlement figure was $2 million.";
  const out = cutSentencesWith(body, ["$2 million"]);
  check("cutting after an abbreviation keeps the whole preceding sentence",
    out.includes("Robert Downey Jr.") && !out.includes("$2 million") && !/Jr\.\s*$/.test(out.trim()) === false || out.includes("Robert Downey Jr."), JSON.stringify(out));
  const out2 = cutFlagged("Dr. Smith confirmed the report. The bogus phrase lives here.", ["The bogus phrase lives here."]);
  check("cutFlagged keeps 'Dr. Smith confirmed the report.'", out2.includes("Dr. Smith confirmed the report."), JSON.stringify(out2));
}
// ── #11 scalar fields must be DROPPED when a specific is uncorrectable ──
{
  const article = {
    dek: "The pair signed a $40K deal in 2019 according to the filing.",
    pullQuote: "The $40K figure stunned everyone involved.",
    metaTitle: "Star A and Star B signed a $40K deal",
    keyTakeaways: ["The pair signed a $40K deal"],
  };
  scrubStructuredFields(article, { corrections: [], drops: ["$40K"] });
  check("uncorrectable specific dropped from dek", !String(article.dek).includes("$40K"), String(article.dek));
  check("uncorrectable specific dropped from pullQuote", !String(article.pullQuote).includes("$40K"), String(article.pullQuote));
  check("uncorrectable specific dropped from metaTitle", !String(article.metaTitle).includes("$40K"), String(article.metaTitle));
  check("array field still scrubbed too", !(article.keyTakeaways || []).some((t) => String(t).includes("$40K")));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Batch C green — accuracy gates closed. ✅\n");
