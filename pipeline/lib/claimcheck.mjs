// CLAIM VERIFICATION (PR2 rebuild — receipts are now load-bearing). Every checkable specific the writer
// asserts must carry a VERBATIM `sourceQuote` receipt copied from the REFERENCE FACTS. We now actually:
//   (1) READ the receipt (the old code never did — comment lied), validate it is a real substring of the
//       grounded facts, and reject a fabricated/irrelevant receipt;
//   (2) require a receipt for any CHECKABLE claim (a number, platform, award, date, credit) — a checkable
//       claim with NO receipt is NO_RECEIPT (the writer's "well-known" opt-out is exactly where it fabricated);
//   (3) require the claim's NUMBERS to be grounded in the facts (catches a purely invented figure).
// VALUE-correctness (RT 86≠90, Netflix≠Prime, OTT-has-no-box-office, winner X≠Y) is verified deterministically
// against the structured TMDB/OMDb/Wikidata facts in lib/verifyEngine.mjs (PR3) — this file is the cheap,
// claims[]-scoped first line; verifyEngine is the independent prose-scan second line. No extra LLM call here.

const norm = (s) => (s || "").toLowerCase().replace(/[‘’“”]/g, "'").replace(/\s+/g, " ").replace(/[^a-z0-9$%.,'\- ]/g, "").trim();
const stripPunct = (s) => norm(s).replace(/[.,'%$\-]/g, " ").replace(/\s+/g, " ").trim();

// The highest-risk, hardest-to-fake part of a claim is its NUMBERS (a %, a $ figure, a year, a count).
const numberTokens = (text) => [...new Set((text.match(/\$?\d[\d,\.]*%?/g) || []).map(stripPunct))].filter((t) => t && t.length > 1);

// A claim is CHECKABLE (needs a receipt) if it asserts a number, a streaming platform, an award, a date/year,
// or a runtime — the specifics readers and Google check. Pure analysis/opinion sentences are not checkable.
const PLATFORM = /\b(netflix|prime video|amazon prime|amazon|hulu|max|hbo max|disney\s?\+|disney plus|apple tv\s?\+|apple tv plus|peacock|paramount\s?\+|paramount plus|starz|showtime|mubi|criterion|tubi)\b/i;
const DATEY = /\b(19|20)\d{2}\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const RUNTIMEY = /\b\d{1,3}\s?(minutes|min|hours|hrs)\b/i;
const mentionsAward = (t) => /\b(oscar|academy award|emmy|grammy|bafta|golden globe|sag award|critics'? choice|annie award|tony|vma|amas?)\b/i.test(t);
const isCheckable = (t) =>
  numberTokens(t).length > 0 || PLATFORM.test(t) || mentionsAward(t) || DATEY.test(t) || RUNTIMEY.test(t);

// Does the claim assert a WIN? (won/earned/received an award) — but NOT if it says "nomination/nominated".
const claimsAWin = (t) =>
  (/\b(won|winning|winner|wins|took home|claimed|earned|received|landed)\b/i.test(t) || /\b(oscar|emmy|grammy|bafta|golden globe|award)-?winning\b/i.test(t)) &&
  !/\bnominat/i.test(t);

// Significant tokens (len>2) of a string, for order-agnostic coverage scoring.
const sigTokens = (s) => stripPunct(s).split(" ").filter((w) => w.length > 2);

// Is the receipt a REAL quote from the facts? Verbatim substring (the contract) OR ≥80% significant-token
// coverage (tolerates trivial whitespace/case/truncation). A fabricated or off-topic receipt fails both.
function receiptIsReal(quote, hayLoose) {
  const q = stripPunct(quote);
  if (!q || q.length < 4) return false;
  if (hayLoose.includes(q)) return true;
  const toks = sigTokens(quote);
  if (!toks.length) return false;
  const hit = toks.filter((t) => hayLoose.includes(t)).length;
  return hit / toks.length >= 0.8;
}

export function verifyClaims(article, topic) {
  const factsText = (topic.facts || []).map((f) => `${f.title}\n${f.extract}`).join("\n\n");
  const hayLoose = stripPunct(factsText);

  // Split the Wikidata/awards block into WON vs NOMINATED zones (awards sit AFTER the ":" on the same line).
  const wonZone = (factsText.match(/AWARDS WON[^:]*:\s*([^\n]*)/i) || [])[1] || "";
  const nomZone = (factsText.match(/AWARD NOMINATIONS[^:]*:\s*([^\n]*)/i) || [])[1] || "";
  const wonNorm = norm(wonZone), nomNorm = norm(nomZone);

  const verdicts = [];
  for (const c of article.claims || []) {
    const text = c.text || "";
    const quote = c.sourceQuote || "";
    let status = "OK", why = "";
    const checkable = isCheckable(text);
    const receiptOk = quote ? receiptIsReal(quote, hayLoose) : false;

    // 1) RECEIPT REQUIRED for a checkable claim. No receipt → the writer asserted a specific it did not
    //    ground (the "uncontroversially well-known" loophole — exactly where it fabricated).
    if (checkable && !quote.trim()) {
      status = "UNVERIFIED";
      why = "checkable specific (number/platform/award/date) with NO sourceQuote receipt — ground it in the facts or remove it";
    }
    // 2) RECEIPT MUST BE REAL. A receipt that is not a substring of the grounded facts is fabricated or
    //    points at the wrong fact — the receipt was decorative before; now it must actually hold.
    else if (quote.trim() && !receiptOk) {
      status = "UNVERIFIED";
      why = `the cited sourceQuote ("${quote.slice(0, 70)}") is NOT found in the reference facts — it cannot support this claim`;
    }
    // 3) NUMBERS must be grounded. Every figure in the claim must appear in the receipt (preferred) or at
    //    least somewhere in the facts; a number in neither is invented.
    else {
      const nums = numberTokens(text);
      const qLoose = stripPunct(quote);
      const missing = nums.filter((n) => !qLoose.includes(n) && !hayLoose.includes(n));
      if (missing.length) { status = "UNVERIFIED"; why = `figure(s) not grounded in the facts (likely invented): ${missing.join(", ")}`; }
    }

    // 4) AWARD WIN-vs-NOMINATED: a claim implying a WIN of an award the facts list only under NOMINATIONS
    //    is the single most trust-killing error — hard CONTRADICTED. (Value-correct winner identity is the
    //    Wikidata diff in verifyEngine; this catches the win/nom inversion cheaply.)
    if (claimsAWin(text) && mentionsAward(text) && (wonNorm || nomNorm)) {
      const award = (norm(text).match(/(academy award|oscar|emmy|grammy|bafta|golden globe|annie award|critics'? choice|sag award)[a-z '\-]*/) || [])[0];
      if (award) {
        const key = award.slice(0, 14);
        const inWon = wonNorm.includes(key);
        const inNom = nomNorm.includes(key);
        if (!inWon && inNom) { status = "CONTRADICTED"; why = `claims a WIN, but the facts list this award under NOMINATIONS (nominated, not won)`; }
        else if (!inWon && !inNom && nomNorm) { status = "CONTRADICTED"; why = `claims a WIN, but it is not in the verified wins list`; }
      }
    }
    verdicts.push({ claim: text.slice(0, 140), status, why });
  }

  const bad = verdicts.filter((v) => v.status === "UNVERIFIED" || v.status === "CONTRADICTED");
  const contradicted = verdicts.filter((v) => v.status === "CONTRADICTED");
  const corrections = bad
    .map((v) => `- "${v.claim}" — ${v.why}. FIX: only state this if a fact in the REFERENCE FACTS supports it verbatim; otherwise remove it or write it qualitatively (and never call a NOMINATION a win).`)
    .join("\n");
  return { verdicts, bad, contradicted, corrections, ok: bad.length === 0 };
}
