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

// ── SPEAKER-ATTRIBUTION GUARD ─────────────────────────────────────────────────────────────────────────────────
// A quote can be verbatim-real yet MISATTRIBUTED — the writer prints a real line but credits the wrong person
// (e.g. Taylor Swift's own "privilege for my feet to ache" line printed as "the sentiment Kelce once shared").
// The text-check above cannot see this. We verify the SPEAKER: if the article names person P as the speaker of a
// quote, but the SOURCE places that quote next to a DIFFERENT named person, it is misattributed. To avoid
// first-name/surname false positives ("Swift" vs "Taylor"), we resolve every name through a map built from the
// bundle's own full "First Last" mentions, and we only flag when BOTH sides resolve to DIFFERENT full names — so a
// legitimate quote is never cut by a name-variant mismatch (owner: fix it, don't cause new damage).
const SAY_VERB = "said|says|told|tells|shared|shares|added|adds|wrote|writes|asked|asks|recalled|recalls|explained|explains|noted|notes|admitted|admits|revealed|reveals|continued|joked|jokes|gushed|tweeted|posted|captioned|stated|states|insisted|claimed|claims|confirmed|declared|quipped";
const NAMEP = "[A-Z][a-zA-Z.'’-]+(?:\\s+[A-Z][a-zA-Z.'’-]+){0,2}";
const NOT_A_PERSON = new Set(["The","A","An","But","And","She","He","They","It","As","For","In","On","At","When","While","Her","His","Their","This","That","There","So","Now","After","Before","During","Instagram","Twitter","TikTok","News","Page","Six","People","Variety","Just","Jared"]);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Map every token of each "First Last[ Last2]" run in the bundle → the full lowercased name, so Swift/Taylor both
// resolve to "taylor swift". Single-token names that never appear as part of a full name stay unresolved (skipped).
function buildNameMap(bundleText) {
  const map = new Map();
  for (const m of String(bundleText).matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z'’-]+){1,2})\b/g)) {
    const full = m[1].toLowerCase().replace(/\s+/g, " ").trim();
    for (const tok of full.split(" ")) if (tok.length > 1 && !map.has(tok)) map.set(tok, full);
    map.set(full, full);
  }
  return map;
}
const resolveFull = (nameRaw, map) => {
  const full = String(nameRaw).toLowerCase().replace(/[^a-z' ’-]/g, "").trim();
  if (map.has(full)) return map.get(full);
  const last = full.split(/\s+/).filter(Boolean).pop() || "";
  return map.get(last) || null;
};
// The person the ARTICLE credits as the speaker of `quoteRaw` (raw name string), or null if none / a pronoun.
function attributedSpeaker(articleRaw, quoteRaw) {
  const i = articleRaw.indexOf(quoteRaw);
  if (i < 0) return null;
  const pre = articleRaw.slice(Math.max(0, i - 140), i);
  const post = articleRaw.slice(i + quoteRaw.length, i + quoteRaw.length + 70);
  let name = null;
  for (const m of pre.matchAll(new RegExp(`\\b(${NAMEP})\\s+(?:once |also |later |then |had |has )?(?:${SAY_VERB})\\b`, "g"))) name = m[1];
  for (const m of pre.matchAll(new RegExp(`\\b(?:sentiment|words|line|quote|remark|comment|thing)s?\\s+(?:that )?(${NAMEP})\\s+(?:once |had )?(?:${SAY_VERB})`, "g"))) name = m[1];
  const pm = post.match(new RegExp(`^["'’,)\\s]*(${NAMEP})\\s+(?:${SAY_VERB})\\b`));
  if (pm) name = pm[1];
  if (!name) return null;
  const first = name.split(/\s+/)[0];
  if (NOT_A_PERSON.has(first) || NOT_A_PERSON.has(name.split(/\s+/).pop())) return null;
  return name;
}
// Full names the SOURCE places next to this quote (window ±180 chars around the quote's occurrence).
function sourceSpeakerFulls(sourceRaw, quoteRaw, map) {
  // Locate the quote in the source using its first ~6 CONSECUTIVE tokens (keep short words like "I'm" so the
  // \W+ joiner doesn't break across them), tolerant of punctuation/whitespace differences.
  const toks = quoteRaw.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean).slice(0, 6);
  if (toks.length < 3) return null;
  const m = String(sourceRaw).match(new RegExp(toks.map(escRe).join("\\W+"), "i"));
  if (!m) return null;
  const win = sourceRaw.slice(Math.max(0, m.index - 180), m.index + quoteRaw.length + 180);
  const fulls = new Set();
  for (const nm of win.matchAll(new RegExp(NAMEP, "g"))) {
    const full = resolveFull(nm[0], map);
    if (full) fulls.add(full);
  }
  return fulls;
}
export function checkQuoteSpeakers(article, bundle) {
  const sources = (bundle?.sources || []).map((s) => s.text || "").filter(Boolean);
  if (!sources.length) return [];
  const map = buildNameMap(sources.join("  "));
  const articleRaw = [article.title, article.dek, article.body].filter(Boolean).join("\n");
  const bad = [];
  for (const q of quotedPhrases(article)) {
    const spk = attributedSpeaker(articleRaw, q);
    if (!spk) continue;
    const spkFull = resolveFull(spk, map);
    if (!spkFull) continue; // article names a speaker we can't resolve to a bundle person → don't risk a false flag
    for (const src of sources) {
      const fulls = sourceSpeakerFulls(src, q, map);
      if (fulls && fulls.size && !fulls.has(spkFull)) { bad.push(`${q.slice(0, 70)} [attributed to ${spk}, but the source ties this quote to ${[...fulls][0]} — fix the speaker or drop the quote]`); break; }
    }
  }
  return bad;
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
  // (3) SPEAKER attribution — a verbatim quote credited to the WRONG person is still a fabrication. The writer gets
  // this flag to re-attribute correctly (or drop the quote); as a last resort the misattributed quote is cut.
  for (const mis of checkQuoteSpeakers(article, bundle)) if (!bad.includes(mis)) bad.push(mis);
  return { ok: bad.length === 0, badQuotes: bad };
}
