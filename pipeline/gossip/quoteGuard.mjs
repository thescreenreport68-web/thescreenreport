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

// A quote is near-verbatim only if MOST of its content words appear CLOSE TOGETHER in the source — inside one
// contiguous window ~1.6× the quote's length — not merely present somewhere in the article. This kills the
// "reassemble a fake quote from scattered common words" false-match while still allowing minor punctuation/word diffs.
function contiguousMatch(qn, hay) {
  const q = qn.split(" ").filter((w) => w.length > 2);
  if (q.length < 2) return hay.includes(qn);
  const h = hay.split(" ");
  const win = Math.ceil(q.length * 1.6) + 2;
  const need = Math.max(2, Math.ceil(q.length * 0.8));
  for (let i = 0; i + 1 <= h.length; i++) {
    const window = h.slice(i, i + win);
    const wset = new Set(window);
    let hit = 0;
    for (const t of q) if (wset.has(t)) hit++;
    if (hit >= need) return true;
    if (i + win >= h.length) break;
  }
  return false;
}

export function verifyQuotes(article, bundle) {
  const hay = norm((bundle?.sources || []).map((s) => s.text).join("  "));
  if (!hay) return { ok: true, badQuotes: [] }; // nothing to check against (e.g. inline-text test bundles)
  const bad = [];
  for (const q of quotedPhrases(article)) {
    const qn = norm(q);
    if (qn.length < 8) continue;
    // (1) is the quote a real substring, or near-verbatim in a CONTIGUOUS run of the source? The old fallback
    // (≥85% of the quote's words appear ANYWHERE) let a fabricated SENTENCE pass when its common words were merely
    // scattered across the article ("She was mad, she cried"). We now require the words to cluster together — the
    // quote must sit inside a contiguous window of the source, not be reassembled from words spread across it.
    const idx = hay.indexOf(qn);
    let matched = idx >= 0;
    if (!matched) matched = contiguousMatch(qn, hay);
    if (!matched) { bad.push(q.slice(0, 80)); continue; } // fabricated / altered / misattributed quote
    // (2) even a verbatim quote is unsafe if it was lifted right out of a denial. Narrow window (~the 3-4 words
    // immediately before the quote) so we catch "denies he <quote>" but NOT a legit quote of the denial itself.
    if (idx >= 0 && DENIAL_NEAR.test(hay.slice(Math.max(0, idx - 22), idx))) {
      bad.push(q.slice(0, 80) + " [lifted from a denial in the source]");
    }
  }
  return { ok: bad.length === 0, badQuotes: bad };
}
