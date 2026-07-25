// GOSSIP — FINAL POLISH (deterministic). Runs on the finished article right before publish to fix the mechanical
// SEO/readability defects the owner flagged: (1) a repeated sentence appearing twice (e.g. the "did not respond to
// a request for comment" boilerplate at both the top and the bottom — bad for SEO + looks broken); (2) empty
// keyTakeaways / faq / tags. All deterministic — no LLM, no new facts invented (derivations only reuse the
// article's OWN confirmed points), so it can never add a fabrication.
import { deriveKeywords } from "./seo.mjs";
import { splitSentences } from "./proseGuards.mjs";

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const contentTokens = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 3));

// token-Jaccard similarity of two sentences (content words only).
function jaccard(a, b) {
  const A = contentTokens(a), B = contentTokens(b);
  if (A.size < 4 || B.size < 4) return 0; // too short to judge as a "duplicate"
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// The classic gossip repeat: a "reps did not respond to a request for comment" line placed at BOTH the top and
// the bottom (they're worded differently, so token-similarity alone misses them). Collapse to the first one.
const NO_COMMENT = /\b(did|does|didn'?t|do not|have not|has not)\b[^.?!]{0,50}\b(respond|reply|replied|responded)\b[^.?!]{0,40}\bcomment\b|\bdeclined to comment\b|\brequests? for comment\b/i;

// Remove a later sentence that is a NEAR-DUPLICATE of an earlier one (>=0.72 Jaccard token overlap) OR a SECOND
// no-comment boilerplate line — kills the doubled closing while preserving paragraph structure + everything unique.
export function dedupeSentences(body, threshold = 0.72) {
  if (!body) return body;
  const paras = String(body).split(/\n{2,}/);
  const keptSentences = [];
  let sawNoComment = false;
  const out = paras.map((para) => {
    const parts = splitSentences(para); // abbreviation-safe: never splits after "David H." etc.
    const kept = [];
    for (const s of parts) {
      const t = s.trim();
      if (!t) continue;
      if (NO_COMMENT.test(t)) {
        if (sawNoComment) continue; // a no-comment line already appeared — drop this repeat
        sawNoComment = true;
      }
      if (keptSentences.some((prev) => jaccard(t, prev) >= threshold)) continue; // near-duplicate → drop
      // fragment dedupe: a repeated quote fragment ("It was horrible,") is a SUBSTRING of an already-kept
      // sentence but slips under the jaccard threshold — a live article shipped every quote twice this way.
      if (t.length >= 18 && keptSentences.some((prev) => prev.includes(t) || (t.length <= prev.length + 40 && t.includes(prev) && prev.length >= 18))) continue;
      keptSentences.push(t);
      kept.push(s);
    }
    return kept.join(" ");
  });
  // final pass: the SAME verbatim quoted span repeated within a paragraph (a live article shipped every
  // quote twice) — keep the first occurrence, delete exact repeats.
  // Drop the whole CARRYING SENTENCE when its quoted span already appeared, instead of blanking the span
  // and leaving "Later, asked about the wedding, she circled right back:" dangling with nothing after it.
  const seenSpans = new Set();
  const spanDeduped = out.filter((p) => p.trim()).map((para) => {
    const sentences = para.split(/(?<=[.!?]["”']?)\s+/);
    const keptS = sentences.filter((sent) => {
      const spans = sent.match(/"[^"\n]{15,300}"|“[^”\n]{15,300}”/g) || [];
      if (!spans.length) return true;
      const norm = spans.map((q) => q.replace(/[“”]/g, '"'));
      const repeat = norm.every((k) => seenSpans.has(k));
      norm.forEach((k) => seenSpans.add(k));
      return !repeat;                      // every quote in it is a repeat ⇒ the sentence adds nothing
    });
    return keptS.join(" ").replace(/\s{2,}/g, " ").trim();
  });
  return spanDeduped.filter(Boolean).map(collapseRepeatedRuns).filter(Boolean).join("\n\n");
}

// 🔴 2026-07-25 — A LIVE ARTICLE PUBLISHED A QUOTE TWICE, MID-SENTENCE:
//   “I'm 41 years old … I'm going to age. I'm going to get older. "I'm 41 years old … I'm going to
//    age. I am fatter because I've had three kids," She didn't sugarcoat it…
// Nothing upstream could see it. The sentence deduper compares WHOLE sentences and these two spans
// only OVERLAP. The quoted-span deduper needs a CLOSING mark, and the first “ here is never closed —
// the writer reopened with a straight " instead. So the duplicate slipped every existing net.
//
// This collapses a word-run that repeats verbatim inside one paragraph, keeping the FIRST occurrence.
// Deliberately conservative: 8+ words, same paragraph, exact match after normalising quote characters
// — long enough that legitimate prose never repeats it by accident.
const RUN_MIN_WORDS = 8;
export function collapseRepeatedRuns(para) {
  let text = String(para || "");
  if (!text.trim()) return text;
  const key = (w) => w.toLowerCase().replace(/[\u2018\u2019']/g, "'").replace(/[\u201C\u201D"]/g, '"').replace(/[^a-z0-9'"$%.,!?-]/g, "");
  for (let guard = 0; guard < 6; guard++) {
    const words = text.split(/(\s+)/);                       // keep separators so we can rebuild exactly
    const idx = [];                                          // indices of real words
    for (let i = 0; i < words.length; i++) if (words[i].trim()) idx.push(i);
    if (idx.length < RUN_MIN_WORDS * 2) break;
    const norm = idx.map((i) => key(words[i]));
    let cut = null;
    for (let a = 0; a + RUN_MIN_WORDS <= norm.length && !cut; a++) {
      const probe = norm.slice(a, a + RUN_MIN_WORDS).join(" ");
      if (probe.replace(/[^a-z0-9]/g, "").length < 18) continue;   // too little substance to judge
      for (let b = a + RUN_MIN_WORDS; b + RUN_MIN_WORDS <= norm.length; b++) {
        if (norm.slice(b, b + RUN_MIN_WORDS).join(" ") !== probe) continue;
        // extend the match as far as it stays identical, then drop the SECOND copy
        let n = RUN_MIN_WORDS;
        while (b + n < norm.length && a + n < b && norm[a + n] === norm[b + n]) n++;
        cut = { from: idx[b], to: idx[b + n - 1] };
        break;
      }
    }
    if (!cut) break;
    words.splice(cut.from, cut.to - cut.from + 1);
    text = words.join("").replace(/\s{2,}/g, " ").trim();
  }
  // the removal can strand an opening quote mark with no partner — balance it rather than ship a stray
  const opens = (text.match(/[\u201C]/g) || []).length, closes = (text.match(/[\u201D]/g) || []).length;
  if (opens > closes) text = text.replace(/[\u201C]/, "");
  const straight = (text.match(/"/g) || []).length;
  if (straight % 2 === 1) text = text.replace(/"(?=[^"]*$)/, "");
  return text.replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

// CUT-AND-PUBLISH (owner rule: the gate never blocks — it corrects, and as a last resort CUTS the offending
// phrase so the clean article still publishes). Given the flagged texts (a fabricated quote, an unsupported claim,
// an unattributed damaging phrase), remove the SENTENCES that contain them, keeping everything else. Deterministic,
// so an article is never blocked over a few bad phrases — the bad phrases are simply removed.
export function cutFlagged(body, texts) {
  if (!body || !Array.isArray(texts) || !texts.length) return body;
  const targets = texts.map(norm).filter((t) => t.length >= 12);
  if (!targets.length) return body;
  const hit = (sentence) => {
    const ns = norm(sentence);
    return targets.some((t) => ns.includes(t.slice(0, 55)) || (ns.length >= 25 && t.includes(ns.slice(0, 45))));
  };
  const paras = String(body).split(/\n{2,}/).map((para) => cutUnits(para, hit));
  return paras.filter((p) => p.trim()).join("\n\n");
}

// splitSentences deliberately MERGES across abbreviations ("…Robert Downey Jr. The settlement was $2M."
// is ONE unit), which is right for DETECTION but wrong for CUTTING — dropping the whole unit deletes the
// verified fact sitting next to the offender. Detect on the merged unit, then cut at the finer boundary.
function cutUnits(para, hit) {
  const kept = [];
  for (const unit of splitSentences(para)) {
    if (!unit.trim()) continue;
    if (!hit(unit)) { kept.push(unit); continue; }
    const parts = unit.split(/(?<=[.!?]["”']?)\s+/);
    const survivors = parts.filter((p) => p.trim() && !hit(p));
    if (survivors.length) kept.push(survivors.join(" "));
  }
  return kept.join(" ");
}

// DROP a SENTENCE that still carries an unverified SPECIFIC (a bare date/number/name/title cutFlagged's 12-char
// floor won't match, e.g. "2022", "$40K"). Word-boundary exact match so we don't nuke an unrelated sentence.
// This is the last resort AFTER the writer had its correction passes — a specific we could not verify is removed,
// never published (owner's hard rule), while the rest of the story stays.
export function cutSentencesWith(body, needles) {
  if (!body || !Array.isArray(needles) || !needles.length) return body;
  const terms = [...new Set(needles.map((n) => String(n || "").trim()).filter((n) => n.length >= 2))];
  if (!terms.length) return body;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = terms.map((t) => new RegExp(`(^|[^\\w])${esc(t)}([^\\w]|$)`, "i"));
  const hit = (sentence) => rx.some((r) => r.test(sentence));
  const paras = String(body).split(/\n{2,}/).map((para) => cutUnits(para, hit));
  return paras.filter((p) => p.trim()).join("\n\n");
}

// APPLY a verified CORRECTION everywhere: replace an exact wrong specific with the right value from the source
// (word-boundary, case-insensitive) — so a wrong year/number/name is FIXED in the body AND every structured field,
// not just deleted. corrections = [{ bad, correction }]. Never invents: only substitutes a value the verifier
// took from the source bundle.
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function applyCorrections(text, corrections = []) {
  let s = String(text ?? "");
  for (const c of corrections) {
    if (!c || !c.bad || c.correction == null || String(c.correction).trim() === "") continue;
    s = s.replace(new RegExp(`(^|[^\\w])${escRe(c.bad)}([^\\w]|$)`, "gi"), (m, a, b) => `${a}${c.correction}${b}`);
  }
  return s;
}

// HOLD EVERY reader-facing STRUCTURED field to the same specifics bar as the body. After the writer's correction
// passes, any specific the source did NOT support is either CORRECTED (source gave the right value) or DROPPED
// (uncorrectable ⇒ removed, never published — owner's hard rule). This closes the hole where a wrong date/number
// in keyTakeaways / whatWeKnow / dek / an FAQ answer bypassed the body-only verifier. drops = specific texts with
// no source-correction. Mutates + returns the article.
export function scrubStructuredFields(article, { corrections = [], drops = [] } = {}) {
  if (!article || typeof article !== "object") return article;
  const terms = [...new Set((drops || []).map((d) => String(d || "").trim()).filter((d) => d.length >= 2))];
  const rx = terms.map((t) => new RegExp(`(^|[^\\w])${escRe(t)}([^\\w]|$)`, "i"));
  const stillBad = (str) => rx.some((r) => r.test(String(str)));
  const fix = (str) => applyCorrections(str, corrections);
  const cleanArr = (arr) => Array.isArray(arr) ? arr.map(fix).filter((x) => x && String(x).trim() && !stillBad(x)) : arr;
  // Scalars used to get `fix` only, which is a no-op when the verifier had no correction — so an
  // uncorrectable unverified specific survived in the dek/pull-quote/meta fields while the array
  // fields were properly dropped. Apply the same drop test the arrays get.
  for (const f of ["dek", "pullQuote", "gossipPull", "metaTitle", "metaDescription"]) {
    if (!article[f]) continue;
    const v = fix(article[f]);
    article[f] = stillBad(v) ? "" : v;   // empty ⇒ the SEO backfill rebuilds it from grounded facts
  }
  if ("keyTakeaways" in article) article.keyTakeaways = cleanArr(article.keyTakeaways);
  if ("whatWeKnow" in article) article.whatWeKnow = cleanArr(article.whatWeKnow);
  if ("whatWeDont" in article) article.whatWeDont = cleanArr(article.whatWeDont);
  if (Array.isArray(article.faq)) article.faq = article.faq
    .map((f) => (f && f.q && f.a) ? { q: fix(f.q), a: fix(f.a) } : f)
    .filter((f) => f && f.q && f.a && !stillBad(f.q) && !stillBad(f.a));
  return article;
}

// TRIM a dangling incomplete sentence from the end (truncation backstop): if the last generation got cut off
// mid-sentence, drop that trailing fragment so the published article never ends mid-thought.
export function trimIncomplete(body) {
  if (!body) return body;
  let paras = String(body).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  // 1) Drop a MID-BODY orphan incomplete-quote fragment (its own paragraph with an UNCLOSED quote AND a dangling
  //    ellipsis or very short) — e.g. a lone `"It's more like...` the writer opened and never finished.
  paras = paras.filter((p) => {
    const unclosedQuote = ((p.match(/"/g) || []).length % 2) !== 0;
    const dangling = /(\.\.\.|…)\s*$/.test(p) || p.split(/\s+/).filter(Boolean).length < 6;
    return !(unclosedQuote && dangling);
  });
  // 2) Trim a trailing incomplete sentence from the end (the cut-off-generation case).
  for (let i = paras.length - 1; i >= 0; i--) {
    const sents = paras[i].split(/(?<=[.!?"'”’])\s+/);
    // drop a trailing fragment with no terminal punctuation OR an unclosed markdown bold (a cut-off heading/label).
    const bad = (s) => !/[.!?"'”’)\]]\s*$/.test(s) || ((s.match(/\*\*/g) || []).length % 2 !== 0);
    while (sents.length && bad(sents[sents.length - 1])) sents.pop();
    paras[i] = sents.join(" ");
    if (paras[i]) break;          // kept a complete paragraph — done
    paras.splice(i, 1);           // that paragraph was entirely a fragment — drop it and check the previous one
  }
  return paras.filter(Boolean).join("\n\n");
}

// keyTakeaways fallback: reuse the article's OWN confirmed/attributed points (whatWeKnow) — never invents.
export function ensureTakeaways(article) {
  const cur = (article.keyTakeaways || []).filter((x) => x && x.trim());
  if (cur.length >= 2) return cur.slice(0, 4);
  const fromKnow = (article.whatWeKnow || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 3);
  return (cur.length ? [...new Set([...cur, ...fromKnow])] : fromKnow).slice(0, 4);
}

// FAQ fallback: turn the article's OWN open questions (whatWeDont) into Q/A — the answer is the honest
// "not yet confirmed/public" state, never an invented fact. Only used when the writer returned none.
function toQuestion(s) {
  let q = String(s).trim().replace(/[.?!]+$/, "");
  if (/^whether /i.test(q)) q = "Will " + q.replace(/^whether /i, "");
  else if (/^if /i.test(q)) q = "Will " + q.replace(/^if /i, "");
  else if (/^the /i.test(q)) q = "What " + (/\b(are|were|include|allegations|details|reasons)\b/i.test(q) ? "are" : "is") + " " + q.replace(/^the /i, "the ");
  else q = q.charAt(0).toUpperCase() + q.slice(1);
  return q.replace(/\s+/g, " ").trim() + "?";
}
// Turn a confirmed FACT (a whatWeKnow line) into a reader Q&A whose ANSWER is the fact itself — never a placeholder.
// Deterministic, invents nothing: it just phrases a natural question around the fact's subject + beat.
function factToQuestion(fact, article) {
  const f = String(fact).trim();
  const subjM = f.match(/^((?:[A-Z][\w'’.&-]+)(?:\s+(?:and\s+|&\s+)?[A-Z][\w'’.&-]+){0,3})/);
  const subj = (subjM && subjM[1].trim()) || String(article?.primaryEntity || "").trim() || (String(article?.title || "").split(/[:—–-]/)[0] || "this story").trim();
  const low = f.toLowerCase();
  if (/\bfiled for divorce|\bsplit\b|broke up|separat/.test(low)) return `What happened between ${subj} and their partner?`;
  if (/\bwed\b|married|engaged|wedding|nuptials/.test(low)) return `What's the latest on ${subj}'s wedding?`;
  if (/\bwore|dress|gown|outfit|heels|\blook\b/.test(low)) return `What did ${subj} wear?`;
  if (/\bdonat|charity|\bgift\b/.test(low)) return `What did ${subj} donate?`;
  if (/\bspotted|\bseen\b|attended|arriv/.test(low)) return `Where was ${subj} spotted?`;
  if (/\bannounc|reveal|shared|confirmed/.test(low)) return `What did ${subj} announce?`;
  return `What do we know about ${subj}?`;
}
export function ensureFaq(article) {
  const cur = (article.faq || []).filter((f) => f && f.q && f.a && String(f.a).trim());
  // Keep the writer's own 2–5 FAQ (fix #3: vary the count by substance, never a fixed 3). Only synthesize when
  // the writer returned too few (<2), and then match the count to how many real facts the story supports (2–4).
  if (cur.length >= 2) return cur.slice(0, 5);
  // Prefer REAL answers from confirmed facts (whatWeKnow) over "we don't know yet" placeholders — an FAQ a reader
  // actually learns something from (owner: every published article must carry relevant FAQs WITH real answers).
  const known = [...new Set((article.whatWeKnow || []).map((x) => String(x).trim()).filter(Boolean))];
  if (known.length) {
    const seen = new Set();
    const target = Math.min(4, Math.max(2, known.length)); // vary 2–4 by substance
    return [...cur, ...known.slice(0, target).map((fact) => {
      let q = factToQuestion(fact, article);
      if (seen.has(q)) q = q.replace(/^What\b/, "What else").replace(/^Where\b/, "Where else");
      seen.add(q);
      return { q, a: fact };
    })].slice(0, 5);
  }
  if (cur.length) return cur; // no facts to synthesize from → keep whatever real FAQ the writer gave
  return (article.whatWeDont || [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((x) => ({ q: toQuestion(x), a: "This has not been confirmed or made public as of publication; we'll update the story as more is verified." }));
}

// Tags/keywords: the people + the topic, deterministic, for internal-linking + keyword SEO. Fix #5 (owner 07-04
// reader-facing purge): NEVER emit "gossip"/"celebrity gossip" or the junk "general" gossipType — only real
// search terms (the entity, any co-subjects, and the category as a clean keyword).
export function deriveTags(topic, article, category, gossipType) {
  return deriveKeywords({
    primaryEntity: topic?.primaryEntity || "",
    coSubjects: topic?.coSubjects || article?.coSubjects || [],
    category,
    subcategory: topic?.subcategory || "",
  });
}
