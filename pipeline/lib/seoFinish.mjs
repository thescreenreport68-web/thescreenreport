// seoFinish.mjs — NEWS-lane deterministic SEO finishers (owner root-cause directive 2026-07-16).
// Five guarantees, all deterministic (no LLM), all applied at assemble time so NO future article can ship:
//   1. a FRAGMENT metaTitle ("…Cast in Netflix's The", "…Lineup with Margot") — smart clamp that never ends a
//      cut on a function word / dangling verb / possessive, never splits a Capitalized First+Last name pair,
//      never leaves an unbalanced quote; if no clean cut exists in 45–60 it keeps the writer's full metaTitle
//      (≤65 — the render honors 30–65 verbatim) instead of shipping a fragment.
//   2. TOPIC→ARTICLE DRIFT (the 2026-07-16 Bonta article: targetKeyword "the swimming lesson cast" + wrong
//      tags/eventSlug inherited from a FIND topic whose source page resolved to a DIFFERENT story) — every
//      topic-inherited SEO field is validated against the FINAL title+body and re-derived from the article
//      itself on mismatch; inherited tags not present in the article are dropped.
//   3. an ENTITY MISSPELLING (the 2026-07-16 'Unleeshed'→"Unleashed" case: the writer spell-"corrected" the
//      show's real name everywhere, INCLUDING inside a direct quote) — if the topic's primaryEntity never
//      appears verbatim but a near-miss variant does, the variant is replaced with the source spelling.
//   4. a SHORT metaDescription — 140–160 chars, built only from the article's own real sentences
//      (metaDescription → dek → opening body), always ending on a complete sentence. Never invents text.
//   5. a BROKEN slug — diacritics transliterated (Maridueña → mariduena, not maridue-a) and the 75-char cap
//      lands on a word boundary (never "…-merger-lawsu").

// ── shared text utils ────────────────────────────────────────────────────────────────────────────
export const stripBrand = (s) => String(s || "").replace(/\s*[|—–\-]\s*The Screen Report\s*$/i, "").replace(/\s+/g, " ").trim();
const deburr = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
const STOP = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "is", "are", "was", "were", "be", "been", "it", "its", "of", "on", "or", "over", "per", "so", "than", "that", "the", "their", "this", "these", "those", "to", "under", "until", "up", "upon", "via", "vs", "with", "without", "will", "would", "has", "have", "had", "not", "no", "s", "his", "her", "he", "she", "they", "them", "after", "before", "amid", "about", "new"]);
const sigWords = (s) => deburr(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
const normHay = (s) => " " + deburr(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";

// ── 5. slug: transliterated + word-boundary cap ─────────────────────────────────────────────────
export function slugifyTitle(s, max = 75) {
  let out = deburr(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (out.length > max) {
    const cut = out.slice(0, max + 1), at = cut.lastIndexOf("-");
    out = (at > max * 0.5 ? cut.slice(0, at) : cut.slice(0, max)).replace(/-+$/g, "");
  }
  return out;
}

// ── 1. metaTitle: semantic-clean 45–55 (≤60 clean cut, ≤65 verbatim, never a fragment) ──────────
// Words that must never END a metaTitle — cutting after them always reads as a fragment.
const BAD_TAIL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "is", "are", "was", "were", "be", "it", "its", "nor", "of", "on", "or", "over", "per", "so", "than", "that", "the", "their", "this", "his", "her", "to", "under", "until", "up", "upon", "via", "vs", "with", "without", "will", "would", "can", "could", "may", "might", "must", "shall", "should", "has", "have", "had", "not", "no", "new", "joins", "join", "casts", "sets", "gets", "adds", "says", "said", "teases", "reveals", "confirms", "announces", "stars", "leads", "after", "before", "during", "while", "when", "where", "who", "whom", "whose", "why", "how", "amid", "between", "against", "about", "de", "la", "del", "von", "van", "also", "more", "most", "&",
  // dangling media ADJECTIVES — "…for New Vertical" (sans "Series") is as broken as "…in Netflix's The"
  "vertical", "animated", "upcoming", "live", "official", "final", "untitled", "expanded", "limited", "original", "exclusive", "reunite", "reunites"]);
const lastWord = (s) => ((String(s).match(/([\w'’.&-]+)[)"'’”\]]*$/) || [])[1] || "");
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function balancedQuotes(s) {
  if (((s.match(/"/g) || []).length) % 2) return false;
  if (((s.match(/“/g) || []).length) !== ((s.match(/”/g) || []).length)) return false;
  // Mask apostrophes so only REAL quote marks count. 2026-07-17 root-fix: a word-final quote was ALWAYS
  // treated as an apostrophe, so a closing quote ("…the Song' Feature") orphaned its opener and the checker
  // rejected every legitimate 'Quoted Title' candidate — that's how 30-char model titles kept winning.
  // Rule: intra-word = apostrophe (D'Onofrio); word-final AFTER 's' = plural possessive (actors'); word-final
  // after any other letter = a CLOSING quote and stays countable.
  const t = s.replace(/(\w)[’'](?=\w)/g, "$1x").replace(/s[’'](?=\s|$)/g, "sx");
  if (((t.match(/‘/g) || []).length) !== ((t.match(/’/g) || []).length)) return false;
  return ((t.match(/'/g) || []).length) % 2 === 0;
}

// Headline verbs + generic media nouns: a Capitalized successor from THIS set does NOT make the previous
// word half of a person's name ("Superman Spinoff | Series" is a fine ending; "Jimmy | Olsen" is not).
const CONT_OK = new Set(["series", "season", "movie", "movies", "film", "films", "show", "spinoff", "sequel", "trailer", "teaser", "premiere", "review", "lineup", "special", "reboot", "remake", "franchise", "joins", "join", "casts", "cast", "stars", "star", "leads", "lead", "sets", "set", "directs", "direct", "writes", "write", "returns", "return", "teases", "tease", "drops", "drop", "reveals", "reveal", "confirms", "confirm", "announces", "announce", "denies", "deny", "slips", "slip", "delays", "delay", "wins", "win", "says", "say", "lands", "land", "nabs", "nab", "taps", "tap", "boards", "board", "exits", "exit", "eyes", "eye", "debuts", "debut", "talks", "talk", "signs", "sign", "reunites", "reunite", "reprises", "reprise", "hits", "hit", "gets", "get", "adds", "add", "expands", "expand"]);
// Person-list cues: when the tail is "<cue> <Capitalized>", the Capitalized word is very likely a FIRST
// name whose surname got cut ("…with Margot", "…Casts Paddy Considine, America").
const CUE_RE = /(?:\bwith|\band|&|,|\bcasts?|\bstars?|\bjoins?|\bfeaturing|\bfeat\.?)\s+[A-Z][\w'’.-]*$/;

// Unique non-generic Capitalized successor of `word` in the full title (quotes excluded), or null.
function uniqueSuccessor(word, full) {
  const re = new RegExp("\\b" + escRe(word) + "\\s+([A-Z][\\w’.-]*\\w)", "g");
  const succ = new Set();
  for (const m of String(full || "").matchAll(re)) if (!CONT_OK.has(m[1].toLowerCase())) succ.add(m[1]);
  return succ.size === 1 ? [...succ][0] : null;
}

// If the candidate ends on "<cue> <FirstName>" and the full title supplies exactly one surname
// ("…with Margot" ← "Margot Robbie"), append it (cap 60). Anything else passes through unchanged.
function completeNamePair(c, full, cap = 60) {
  if (!CUE_RE.test(c)) return c;
  const lw = lastWord(c), s = lw && uniqueSuccessor(lw, full);
  if (s && c.length + 1 + s.length <= cap) return c + " " + s;
  return c;
}

// A candidate is CLEAN when it can stand alone as a search title: no dangling tail word, no split
// person name (cue + first name whose surname lives in the full title), balanced quotes, no
// trailing connector punctuation.
function isCleanTitle(c, full) {
  if (!c || /[,;:&/–—-]$/.test(c.trim())) return false;
  const lw = lastWord(c);
  if (!lw || BAD_TAIL.has(lw.toLowerCase()) || /['’]s$/i.test(lw)) return false;
  if (!balancedQuotes(c)) return false;
  if (CUE_RE.test(c)) { // "…with Margot" — a surname exists in the title but not here → fragment
    const re = new RegExp("\\b" + escRe(lw) + "\\s+([A-Z][\\w’.-]*\\w)", "g");
    for (const m of String(full || "").matchAll(re)) if (!CONT_OK.has(m[1].toLowerCase())) return false;
  }
  return true;
}

// Find the longest CLEAN cut of `s` with length in [min,max]; null when none exists. Position-aware:
// the cut also must not split an adjacent Capitalized pair ("Jimmy | Olsen" — but "Considine, | Kit"
// and "Spinoff | Series" are fine) and must not strand a lowercase-connector phrase ("Man | of Tomorrow").
function cleanCut(s, full, min, max) {
  s = String(s || "").trim();
  for (let end = Math.min(max, s.length); end >= min; end--) {
    if (end !== s.length && s[end] !== " ") continue;
    if (end !== s.length) {
      const next = (s.slice(end + 1).match(/^([\w'’.&-]+)/) || [])[1] || "";
      if (/^(of|du|de|della|vs)$/i.test(next)) continue;                      // mid-phrase ("Man of Tomorrow")
      // Split-NAME check, Title-Case-safe (2026-07-17: the old any-adjacent-caps rule rejected nearly every
      // headline cut — "…Original Series | Commissioned" — so short model titles kept winning). A cut before a
      // Capitalized word is only a split NAME when the kept text ends in a person-cue ("…with Margot |Robbie")
      // or a possessive holder ("HBO Max's Jimmy |Olsen").
      const kept = s.slice(0, end);
      if (/^[A-Z]/.test(next) && !CONT_OK.has(next.toLowerCase()) && (CUE_RE.test(kept) || /['’]s\s+[A-Z][\w'’.-]*$/.test(kept))) continue;
    }
    const c = s.slice(0, end).replace(/[\s,;:–—-]+$/, "");
    if (c.length >= min && c.length <= max && isCleanTitle(c, full)) return c;
  }
  return null;
}

// Remove UNPAIRED quote marks (2026-07-17 root-fix): a title like «Netflix's '14th» (writer forgot the closing
// quote) failed balancedQuotes on EVERY pass, so the finisher fell through to the raw short model metaTitle —
// the 7 live under-45 metaTitles. A lone quote char carries no meaning; strip it and the candidate is usable.
function stripUnpaired(s) {
  // Count on a copy with apostrophes masked (Max's, D'Onofrio, Netflix's) so only REAL quote marks count,
  // then delete ONE lone quote char from the original. Legit apostrophes are never touched.
  const masked = s.replace(/(\w)[\u2019'](?=\w)/g, "$1x").replace(/(\w)[\u2019']s\b/g, "$1xs");
  const n = (re) => (masked.match(re) || []).length;
  let out = s;
  if (n(/'/g) % 2) out = out.replace(/(?<!\w)'(?=\w|\s|$)|(?<=\s)'/, "");
  if (n(/"/g) % 2) out = out.replace(/"/, "");
  const o1 = n(/\u2018/g), c1 = n(/\u2019/g);
  if (o1 > c1) out = out.replace(/\u2018/, "");
  else if (c1 > o1) out = out.replace(/\u2019(?!\w)/, "");
  const o2 = n(/\u201c/g), c2 = n(/\u201d/g);
  if (o2 > c2) out = out.replace(/\u201c/, "");
  else if (c2 > o2) out = out.replace(/\u201d/, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

export function finishMetaTitle({ model, title, min = 45, max = 55, cutMax = 60, hardMax = 65 } = {}) {
  const prep = (s) => stripUnpaired(stripBrand(s).replace(/\s*\(\d{4}\)\s*$/, "").trim());
  const mt = prep(model), tt = prep(title);
  const cands = [mt, tt].filter(Boolean);
  // pass 1 — candidate already clean in [45,55] once a split name is completed (completion may run to 60)
  for (const c of cands) {
    const cc = completeNamePair(c, title);
    if (cc.length >= min && cc.length <= max && isCleanTitle(cc, title)) return cc;
  }
  for (const c of cands) {
    const cc = completeNamePair(c, title);
    if (cc.length > max && cc.length <= cutMax && isCleanTitle(cc, title)) return cc;
  }
  // pass 2 — longest clean cut in [45,55], then the 56–60 stretch band
  for (const c of cands) { const k = cleanCut(c, title, min, max); if (k) return k; }
  for (const c of cands) { const k = cleanCut(c, title, max + 1, cutMax); if (k) return k; }
  // pass 3 — no clean cut exists: ship the writer's/headline's FULL text if ≤65 (verbatim beats a fragment)
  for (const c of cands) if (c.length <= hardMax && isCleanTitle(c, title)) return c;
  // pass 3b (2026-07-17): a clean HEADLINE cut anywhere in [45,65] still beats anything short — the full
  // display title is 55-86 chars, so this nearly always lands in-range even when the strict bands failed.
  { const k = cleanCut(tt, title, min, hardMax); if (k) return k; }
  // last resorts — a clean short cut (≥30) beats an in-band fragment…
  for (const c of cands) { const k = cleanCut(c, title, 30, min - 1); if (k) return k; }
  // …and the FINAL fallback can never ship a fragment (2026-07-17 root-fix: the old blind cut returned the
  // model's "'Heartstopper Forever' Movie Releases on" verbatim): prefer the LONGEST candidate, cut at a word
  // boundary, then iteratively strip dangling tail words until the ending is clean.
  const s = [...cands].sort((a, b) => b.length - a.length)[0] || "";
  const cut0 = s.length <= max ? s : (() => { const c = s.slice(0, max), at = c.lastIndexOf(" "); return at > max * 0.4 ? c.slice(0, at) : c; })();
  let out = cut0.replace(/[\s,;:–—-]+$/, "");
  for (let i = 0; i < 6; i++) {
    const lw = lastWord(out);
    if (!lw || (!BAD_TAIL.has(lw.toLowerCase()) && !/['’]s$/i.test(lw))) break;
    out = out.slice(0, out.length - lw.length).replace(/[\s,;:–—-]+$/, "");
  }
  return out || cut0;
}

// ── 4. metaDescription: 140–160 chars of REAL article sentences, complete-sentence ending ───────
// Sentence split, abbreviation-aware (2026-07-17 root-fix: "No. 2 on the Billboard 200" was split after "No."
// and the orphan "2 on the Billboard 200." shipped in a live metaDescription). Never split after a known
// abbreviation, and only split when a capital/quote actually starts the next sentence.
const sentSplit = (s) => String(s || "").replace(/\s+/g, " ").trim()
  .split(/(?<!\b(?:No|Mr|Mrs|Ms|Dr|Jr|Sr|St|Mt|vs|Vol|Inc|Ltd|Co|Corp|Bros|approx|etc|U\.S|U\.K)\.)(?<=[.!?…])\s+(?=[A-Z“"'‘(])/)
  .filter(Boolean);
export function finishMetaDescription({ model, dek, bodyText, min = 140, max = 160 } = {}) {
  // Greedy sentence accumulation, tried in several source orders (the model's metaDescription first, but a
  // 143-char dek alone can be in-band when model+anything overshoots) — best in-band result wins, else longest.
  const build = (srcs) => {
    const seen = new Set(); const pool = [];
    for (const src of srcs) for (const s of sentSplit(src)) {
      const k = normHay(s); if (!seen.has(k)) { seen.add(k); pool.push(s); }
    }
    let acc = "";
    for (const s of pool) {
      const t = acc ? acc + " " + s : s;
      if (t.length <= max) acc = t; // else skip — a later shorter sentence may still fit
      if (acc.length >= min) break;
    }
    return acc;
  };
  const tries = [[model, dek, bodyText], [dek, bodyText, model], [model, bodyText, dek], [bodyText, dek, model]]
    .map(build).filter(Boolean);
  let acc = tries.find((t) => t.length >= min && t.length <= max)
    || tries.sort((a, b) => b.length - a.length)[0]
    || String(model || dek || "").slice(0, max).trim();
  if (acc && !/[.!?…]$/.test(acc)) acc += ".";
  return acc;
}

// ── 2. topic→article drift guard ────────────────────────────────────────────────────────────────
// Validates every topic-inherited SEO field against the FINAL article text; re-derives from the
// article itself on mismatch. `has` demands EVERY significant word of the phrase appear in the
// article — "the swimming lesson cast" fails against the Bonta body on all three words.
export function driftGuard({ article, topic, tags, bodyText, slug } = {}) {
  const hay = normHay([article?.title, article?.dek, bodyText].filter(Boolean).join(" "));
  const has = (phrase) => { const ws = sigWords(phrase || ""); return ws.length > 0 && ws.every((w) => hay.includes(" " + w + " ")); };
  const hasMost = (phrase) => { const ws = sigWords(phrase || ""); return ws.length > 0 && ws.filter((w) => hay.includes(" " + w + " ")).length >= Math.ceil(ws.length * 0.6); };

  const kwOk = has(topic?.primaryKeyword);
  const entity = has(topic?.primaryEntity) ? topic.primaryEntity
    : (article?.about || []).map((e) => e?.name).find((n) => n && has(n)) || null;
  // Re-derived keyword = the entity (when the article really names one) + the title's first salient words.
  const titleSig = sigWords(article?.title || "").filter((w) => !sigWords(entity || "").includes(w));
  const targetKeyword = kwOk ? topic.primaryKeyword
    : [...sigWords(entity || ""), ...titleSig].slice(0, 6).join(" ") || sigWords(article?.title || "").slice(0, 6).join(" ");

  const keptTags = (tags || []).filter((t) => t && hasMost(t));
  const topUp = [entity, ...(article?.about || []).map((e) => e?.name).filter((n) => n && has(n))]
    .filter(Boolean).map((s) => String(s).toLowerCase());
  const finalTags = [...new Set([...keptTags.map((t) => String(t).toLowerCase()), ...topUp])].slice(0, 8);

  const eventOk = kwOk || hasMost(String(topic?.eventSlug || "").replace(/-/g, " "));
  return {
    drifted: !kwOk,
    targetKeyword,
    tags: finalTags,
    eventSlug: eventOk ? topic?.eventSlug : slugifyTitle(targetKeyword) || slug || "",
    eventType: eventOk ? topic?.eventType : "news",
    // imageAlt keeps its imageQuery prefix only when the query names THIS article's story
    imageQueryOk: hasMost(article?.imageQuery),
  };
}

// ── 3. entity-spelling fidelity ─────────────────────────────────────────────────────────────────
// The writer must never "correct" a real proper noun (Unleeshed→Unleashed). Fires ONLY when the
// entity token (≥6 chars) appears ZERO times verbatim in the article while a near-miss variant
// (same first letter, length ±2, edit distance ≤2, used Capitalized) does — then every occurrence
// of the variant, in every string field INCLUDING quotes, is replaced with the source spelling.
function editDistLe2(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, dp[i][j]);
    }
    if (rowMin > 2) return false;
  }
  return dp[a.length][b.length] <= 2;
}
export function entityFidelity(article, primaryEntity) {
  // Tokens are SANITIZED to bare words (2026-07-17 root-fix): "Power: Origins" used to tokenize to "Power:" —
  // \b can't sit between ':' and space, so the guard thought the token was absent, matched "Power" as a
  // "misspelled variant", and rewrote it to "Power:" → the live "Power:: Origins" corruption. Punctuation
  // is never part of a spelling check.
  const tokens = String(primaryEntity || "").split(/\s+/)
    .map((t) => t.replace(/^[^A-Za-z0-9'’-]+|[^A-Za-z0-9'’-]+$/g, ""))
    .filter((t) => t.length >= 6 && /^[A-Za-z0-9'’-]+$/.test(t));
  if (!tokens.length || !article) return article;
  const allText = JSON.stringify(article);
  let out = article;
  for (const tok of tokens) {
    if (new RegExp("\\b" + escRe(tok) + "\\b").test(allText)) continue; // verbatim present somewhere → nothing to fix
    // find Capitalized near-miss variants actually used in the article
    const words = [...new Set(allText.match(/\b[A-Z][a-z'’]{4,}\b/g) || [])];
    const variant = words.find((w) => w !== tok && w[0].toLowerCase() === tok[0].toLowerCase() && editDistLe2(w.toLowerCase(), tok.toLowerCase()));
    if (!variant) continue;
    const re = new RegExp("\\b" + escRe(variant) + "\\b", "g");
    const fix = (v) => typeof v === "string" ? v.replace(re, tok)
      : Array.isArray(v) ? v.map(fix)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)])) : v;
    out = fix(out);
  }
  return out;
}
