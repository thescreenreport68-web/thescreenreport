// CLAIM VERIFICATION (FIX-2 Layer A + the award cross-check). Every checkable specific the writer asserts
// must carry a verbatim sourceQuote receipt from the REFERENCE FACTS. We verify each receipt is real AND
// that the claim's own key facts (numbers, the award name, the "won" vs "nominated" status) actually appear
// in that receipt — so the model can't cite a real-but-irrelevant substring. Combined with FIX-1's enriched
// grounding (Wikidata wins/noms, TMDB credits, RT reception all now IN the facts), this catches the
// plausible-but-wrong-specific fabrications the old judge was blind to — for free, no extra LLM call.

const norm = (s) => (s || "").toLowerCase().replace(/[‘’“”]/g, "'").replace(/\s+/g, " ").replace(/[^a-z0-9$%.,'\- ]/g, "").trim();
const stripPunct = (s) => norm(s).replace(/[.,'%$\-]/g, " ").replace(/\s+/g, " ").trim();

// The highest-risk, hardest-to-fake part of a claim is its NUMBERS (a %, a $ figure, a year, a count).
// We require those to actually appear in the receipt; proper nouns are not required (the receipt being a
// real substring of the facts already grounds the wording, and demanding the subject's own name inside
// every receipt produced false positives on grounded claims).
const numberTokens = (text) => [...new Set((text.match(/\$?\d[\d,\.]*%?/g) || []).map(stripPunct))].filter((t) => t && t.length > 1);

// Does the claim assert a WIN? (won/earned/received an award) — but NOT if it says "nomination/nominated".
const claimsAWin = (t) =>
  (/\b(won|winning|winner|wins|took home|claimed|earned|received|landed)\b/i.test(t) || /\b(oscar|emmy|grammy|bafta|golden globe|award)-?winning\b/i.test(t)) &&
  !/\bnominat/i.test(t);
const mentionsAward = (t) => /\b(oscar|academy award|emmy|grammy|bafta|golden globe|sag award|critics'? choice|annie award|tony)\b/i.test(t);

export function verifyClaims(article, topic) {
  const factsText = (topic.facts || []).map((f) => `${f.title}\n${f.extract}`).join("\n\n");
  const hay = norm(factsText);
  const hayLoose = stripPunct(factsText);

  // Split the Wikidata block into WON vs NOMINATED zones (the awards sit AFTER the ":" on the same line).
  const wonZone = (factsText.match(/AWARDS WON[^:]*:\s*([^\n]*)/i) || [])[1] || "";
  const nomZone = (factsText.match(/AWARD NOMINATIONS[^:]*:\s*([^\n]*)/i) || [])[1] || "";
  const wonNorm = norm(wonZone), nomNorm = norm(nomZone);

  const verdicts = [];
  for (const c of article.claims || []) {
    const text = c.text || "";
    let status = "OK", why = "";

    // 1) NUMBERS are the fakeable part — every number in the claim must appear SOMEWHERE in the grounded
    //    facts (we check the FULL facts, not the model's paraphrased receipt, to avoid false positives).
    const missingNums = numberTokens(text).filter((n) => !hayLoose.includes(n));
    if (missingNums.length) { status = "UNVERIFIED"; why = `figure(s) not found in the grounded facts (likely invented): ${missingNums.join(", ")}`; }

    // 2) AWARD WIN-vs-NOMINATED: a claim implying a WIN of an award the facts list only under NOMINATIONS
    //    is the single most trust-killing error — hard CONTRADICTED.
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
    .map((v) => `- "${v.claim}" — ${v.why}. FIX: only state this if a fact in the REFERENCE FACTS supports it verbatim; otherwise remove it or rewrite it qualitatively (and never call a NOMINATION a win).`)
    .join("\n");
  return { verdicts, bad, contradicted, corrections, ok: bad.length === 0 };
}
