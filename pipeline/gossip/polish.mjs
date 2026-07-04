// GOSSIP — FINAL POLISH (deterministic). Runs on the finished article right before publish to fix the mechanical
// SEO/readability defects the owner flagged: (1) a repeated sentence appearing twice (e.g. the "did not respond to
// a request for comment" boilerplate at both the top and the bottom — bad for SEO + looks broken); (2) empty
// keyTakeaways / faq / tags. All deterministic — no LLM, no new facts invented (derivations only reuse the
// article's OWN confirmed points), so it can never add a fabrication.

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
    const parts = para.split(/(?<=[.!?])\s+/);
    const kept = [];
    for (const s of parts) {
      const t = s.trim();
      if (!t) continue;
      if (NO_COMMENT.test(t)) {
        if (sawNoComment) continue; // a no-comment line already appeared — drop this repeat
        sawNoComment = true;
      }
      if (keptSentences.some((prev) => jaccard(t, prev) >= threshold)) continue; // near-duplicate → drop
      keptSentences.push(t);
      kept.push(s);
    }
    return kept.join(" ");
  });
  return out.filter((p) => p.trim()).join("\n\n");
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
  const paras = String(body).split(/\n{2,}/).map((para) =>
    para.split(/(?<=[.!?])\s+/).filter((s) => s.trim() && !hit(s)).join(" ")
  );
  return paras.filter((p) => p.trim()).join("\n\n");
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
  const paras = String(body).split(/\n{2,}/).map((para) =>
    para.split(/(?<=[.!?])\s+/).filter((s) => s.trim() && !hit(s)).join(" ")
  );
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
  for (const f of ["dek", "pullQuote", "gossipPull", "metaTitle", "metaDescription"]) if (article[f]) article[f] = fix(article[f]);
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
  if (cur.length >= 1) return cur.slice(0, 4);
  // Prefer REAL answers from confirmed facts (whatWeKnow) over "we don't know yet" placeholders — an FAQ a reader
  // actually learns something from (owner: every published article must carry relevant FAQs WITH real answers).
  const known = [...new Set((article.whatWeKnow || []).map((x) => String(x).trim()).filter(Boolean))];
  if (known.length) {
    const seen = new Set();
    return known.slice(0, 3).map((fact) => {
      let q = factToQuestion(fact, article);
      if (seen.has(q)) q = q.replace(/^What\b/, "What else").replace(/^Where\b/, "Where else");
      seen.add(q);
      return { q, a: fact };
    });
  }
  return (article.whatWeDont || [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((x) => ({ q: toQuestion(x), a: "This has not been confirmed or made public as of publication; we'll update the story as more is verified." }));
}

// Tags: the entity + the gossip angle + the category (deterministic, for internal-linking/SEO). No stuffing.
export function deriveTags(topic, article, category, gossipType) {
  const tags = [topic?.primaryEntity, category, gossipType, "celebrity gossip"].map((t) => String(t || "").trim()).filter(Boolean);
  return [...new Set(tags)].slice(0, 6);
}
