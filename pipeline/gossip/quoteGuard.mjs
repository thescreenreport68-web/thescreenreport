// GOSSIP — VERBATIM-QUOTE GUARD (deterministic). The #1 fabrication class is a misquote or invented quote
// (e.g. the source said "substance abuse" but the writer printed "has a drug problem" in quotation marks).
// A prompt can't reliably stop this; CODE can: every quoted phrase in the article MUST be a real (verbatim, or
// near-verbatim with ≥85% token coverage) substring of the source-bundle text. Anything else is flagged — the
// orchestrator then blocks it and makes the writer fix it (use the real quote, or drop the quotation marks).
// Model-independent: it catches ANY writer's misquotes, every time.

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Pull quoted phrases from the article (straight or curly quotes), 12+ chars with a space (skip single words /
// scare-quotes like "icon"). We check the body + headline + dek (anywhere a reader sees a quote).
function quotedPhrases(article) {
  const text = [article.title, article.dek, article.body].filter(Boolean).join("\n");
  const out = [];
  for (const m of text.matchAll(/[“"]([^”"\n]{12,200})[”"]/g)) {
    const q = m[1].trim();
    if (/\s/.test(q) && !out.includes(q)) out.push(q);
  }
  return out;
}

// DENIAL words — if one appears just BEFORE a quote's occurrence in the source, the writer likely lifted the
// quote OUT OF a denial (source: "denies he uses drugs" → article quotes "uses drugs"). Only explicit denial
// tokens (not generic "not"/"no") so we don't over-block a legitimate quote that merely sits near a negation.
const DENIAL_NEAR = /\b(deny|denies|denied|denying|disputed|disputes|disputing|debunk\w*|untrue|refut\w+|false (report|claim|rumou?r|story)|never (happened|did|said|true)|no truth)\b/;

export function verifyQuotes(article, bundle) {
  const hay = norm((bundle?.sources || []).map((s) => s.text).join("  "));
  if (!hay) return { ok: true, badQuotes: [] }; // nothing to check against (e.g. inline-text test bundles)
  const bad = [];
  for (const q of quotedPhrases(article)) {
    const qn = norm(q);
    if (qn.length < 8) continue;
    // (1) is the quote a real substring (or ≥85%-token) of the source?
    const idx = hay.indexOf(qn);
    let matched = idx >= 0;
    if (!matched) {
      const toks = qn.split(" ").filter((w) => w.length > 2);
      const hit = toks.filter((t) => hay.includes(t)).length;
      matched = toks.length > 0 && hit / toks.length >= 0.85;
    }
    if (!matched) { bad.push(q.slice(0, 80)); continue; } // fabricated / altered quote
    // (2) even a verbatim quote is unsafe if it was lifted right out of a denial. Narrow window (~the 3-4 words
    // immediately before the quote) so we catch "denies he <quote>" but NOT a legit quote of the denial itself.
    if (idx >= 0 && DENIAL_NEAR.test(hay.slice(Math.max(0, idx - 22), idx))) {
      bad.push(q.slice(0, 80) + " [lifted from a denial in the source]");
    }
  }
  return { ok: bad.length === 0, badQuotes: bad };
}
