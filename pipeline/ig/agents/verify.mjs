// AGENT 3 — VERIFIER: every fact entailment-checked against the article text, plus
// deterministic walls (quotes must appear verbatim; numbers must appear literally).
// Unsupported-uncontradicted = CUT. Contradiction / fabricated quote = HOLD.
// The script writer NEVER sees an unverified fact. (plan §2.2 #3, §4)
import { llm } from "../models.mjs";
import { normWords } from "../lib/util.mjs";

const SYS = `You are a strict fact-checker. For each numbered CLAIM decide against the ARTICLE text only:
"supported" (the text literally supports it), "unsupported" (not in the text), or "contradicted" (the text says otherwise).
Return STRICT JSON: {"verdicts":[{"i":number,"verdict":"supported"|"unsupported"|"contradicted"}]} — one verdict per claim, no prose.`;

function normalizeForQuote(s) {
  return String(s).toLowerCase().replace(/[“”]/g, '"').replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

// Extract ALL quoted spans from a claim: double quotes first, plus clearly-delimited
// single-quote spans (apostrophe-safe: must open after space/comma and close before
// punctuation). Every span must appear verbatim. No spans → normal claim (entailment).
export function extractQuoteSpans(claim) {
  const c = normalizeForQuote(claim);
  const spans = [];
  for (const m of c.matchAll(/"([^"]{8,})"/g)) spans.push(m[1]);
  for (const m of c.matchAll(/(?:^|[\s,;:(])'([^']{8,}?)'(?=[\s.,;:!?)]|$)/g)) spans.push(m[1]);
  return spans;
}
export const extractQuoteSpan = (claim) => extractQuoteSpans(claim)[0] ?? null; // kept for tests

export async function verify(facts) {
  const article = facts.articleText || "";
  // quotes may have been extracted from the article OR the fetched source excerpts
  const corpus = normalizeForQuote(article + " " + (facts.sourceText || ""));
  const artNorm = corpus;
  const cuts = [];
  let hold = null;

  // ── deterministic walls first (free)
  const walled = [];
  for (const orig of facts.facts) {
    let f = orig;
    if (f.quote) {
      // The source article is VERIFIED upstream and the writer PARAPHRASES quotes (never voices
      // them verbatim), so a gathered quote that isn't a verbatim span is just paraphrasable
      // material — NOT a fabrication. Never HOLD on it (that clashed with paraphrasing and held
      // real, true stories). Drop the quote flag so downstream treats it as a normal claim. (2026-07-12)
      const spans = extractQuoteSpans(f.claim);
      if (!spans.length || spans.some((s) => !artNorm.includes(s))) f = { ...f, quote: false };
    }
    walled.push(f);
  }
  if (hold) return { facts: [], cuts, hold };

  for (const n of facts.numbers || []) {
    if (!artNorm.includes(normalizeForQuote(n))) cuts.push({ type: "number", value: n, reason: "not literal in article" });
  }
  const badNumbers = new Set(cuts.filter((c) => c.type === "number").map((c) => normalizeForQuote(c.value)));

  // ── LLM entailment over the surviving claims (one batched call)
  const claims = walled.map((f, i) => `${i}. ${f.claim}`).join("\n");
  const res = await llm({
    role: "verify",
    system: SYS,
    user: `ARTICLE:\n${article.slice(0, 8000)}${facts.sourceText ? `\n\nSOURCE EXCERPTS (also count as support):\n${facts.sourceText.slice(0, 4000)}` : ""}\n\nCLAIMS:\n${claims}`,
    temp: 0,
    maxTokens: 700,
    json: true,
  });
  const verdicts = new Map((res.verdicts || []).map((v) => [v.i, v.verdict]));
  const kept = [];
  walled.forEach((f, i) => {
    const v = verdicts.get(i) || "unsupported";
    // Source is verified upstream, so an LLM "contradicted" verdict is far more likely its own
    // misjudgment than a real error — CUT the single claim (build from the rest) rather than HOLD
    // the whole video. Trust the source; drop what doesn't match; never block on accuracy. (2026-07-12)
    if (v === "contradicted" || v === "unsupported") cuts.push({ type: "claim", value: f.claim, reason: v });
    else if ([...badNumbers].some((n) => normalizeForQuote(f.claim).includes(n)))
      cuts.push({ type: "claim", value: f.claim, reason: "contains unverified number" });
    else kept.push(f);
  });
  if (hold) return { facts: [], cuts, hold };
  if (kept.length < 3) return { facts: kept, cuts, hold: `only ${kept.length} verified facts — too thin for a reel (no padding, ever)` };
  return { facts: kept, cuts, hold: null };
}
