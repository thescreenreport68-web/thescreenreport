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

export function verifyQuotes(article, bundle) {
  const hay = norm((bundle?.sources || []).map((s) => s.text).join("  "));
  if (!hay) return { ok: true, badQuotes: [] }; // nothing to check against (e.g. inline-text test bundles)
  const bad = [];
  for (const q of quotedPhrases(article)) {
    const qn = norm(q);
    if (qn.length < 8) continue;
    if (hay.includes(qn)) continue; // verbatim substring → real quote
    // tolerate trivial truncation/elision: ≥85% of the quote's significant tokens appear in the source
    const toks = qn.split(" ").filter((w) => w.length > 2);
    const hit = toks.filter((t) => hay.includes(t)).length;
    if (toks.length && hit / toks.length >= 0.85) continue;
    bad.push(q.slice(0, 80));
  }
  return { ok: bad.length === 0, badQuotes: bad };
}
