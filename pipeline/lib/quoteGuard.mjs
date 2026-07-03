// VERBATIM-QUOTE GUARD (deterministic, model-independent) — ported from the gossip automation (Phase B).
// The #1 fabrication class is a misquote or invented quote (the source said "substance abuse" but the article
// prints "has a drug problem" in quotation marks; or the source said someone "denies he uses drugs" and the
// article quotes "uses drugs"). A prompt can't reliably stop this — CODE can: every quoted phrase in the article
// MUST be a real (verbatim, or near-verbatim with >=85% token coverage) substring of the gathered source bundle,
// AND must not have been lifted out of a denial. verifyGate's LLM quote check is the smart layer; this is the
// cheap deterministic backstop that catches ANY writer's misquotes, every time, with no model call.

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Pull quoted phrases from the reader-visible copy (straight or curly quotes), 12+ chars with a space (skip
// single-word scare-quotes like "icon"). We check the title + dek + body — anywhere a reader sees a quote.
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

// Was the quote LIFTED OUT OF A DENIAL? Checked in the ORIGINAL (punctuated) source so the denial token must
// share a SENTENCE with the quote (a denial in a PRIOR sentence is irrelevant), across EVERY occurrence — flag
// only if the quote is denial-led at ALL of them (an attributed occurrence elsewhere clears it).
function deniedInSource(quote, raw) {
  const words = norm(quote).split(" ").filter((w) => w.length > 1).slice(0, 6);
  if (words.length < 2) return false;
  let re;
  try { re = new RegExp(words.join("[^a-z0-9]+"), "gi"); } catch { return false; }
  let m, any = false;
  while ((m = re.exec(raw)) !== null) {
    any = true;
    const before = raw.slice(0, m.index);
    const cut = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"));
    const sentence = before.slice(cut + 1).toLowerCase(); // the current sentence, up to the quote
    if (!DENIAL_NEAR.test(sentence)) return false;         // a clean (non-denial) occurrence → legit quote
    if (re.lastIndex <= m.index) re.lastIndex = m.index + 1; // zero-width guard
  }
  return any;
}

// bundle = { sources: [{ text }] } (the content-finder bundle on topic._bundle). Returns { ok, badQuotes[] }.
export function verifyQuotes(article, bundle) {
  const raw = (bundle?.sources || []).map((s) => s.text).filter(Boolean).join("\n");
  const hay = norm(raw);
  if (!hay) return { ok: true, badQuotes: [] }; // nothing to check against (structured-fact-only grounding)
  const haySet = new Set(hay.split(" ")); // word-boundary token set so "art" doesn't match "apart" (the 85% fallback)
  const bad = [];
  for (const q of quotedPhrases(article)) {
    const qn = norm(q);
    if (qn.length < 8) continue;
    // (1) is the quote a real substring, or are >=85% of its words present AS WHOLE WORDS?
    let matched = hay.indexOf(qn) >= 0;
    if (!matched) {
      const toks = qn.split(" ").filter((w) => w.length > 2);
      const hit = toks.filter((t) => haySet.has(t)).length;
      matched = toks.length > 0 && hit / toks.length >= 0.85;
    }
    if (!matched) { bad.push(q.slice(0, 80)); continue; } // fabricated / altered quote
    // (2) lifted out of a denial? (original text, sentence-bounded, all occurrences)
    if (deniedInSource(q, raw)) bad.push(q.slice(0, 80) + " [lifted from a denial in the source]");
  }
  return { ok: bad.length === 0, badQuotes: bad };
}
