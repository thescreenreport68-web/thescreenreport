// GOSSIP — SEO metaTitle / metaDescription / keyword helpers (gossip-lane only; not shared).
// The reader-facing `title` (the <h1>) is NEVER shortened — these only shape the stored
// metaTitle / metaDescription / targetKeyword / tags frontmatter that the site head + JSON-LD read.
//
// Owner rules:
//  • metaTitle: 45–55 chars, no brand suffix, STARTS with the celebrity's NAME, a COMPLETE clause —
//    NEVER a cut/dangler. Clean endings win over hitting the length band; if there is no clean cut,
//    keep the full title. The WRITER now crafts metaTitle; this file validates it and is the
//    deterministic fallback + the backfill engine for old articles.
//  • metaDescription: 140–160 chars, a teaser + one concrete fact, ends on a full sentence, distinct
//    from the dek.
//  • keywords/tags: real search terms only — NEVER "gossip"/"celebrity gossip" or the junk "general".

const MIN = 45, MAX = 55, SOFT_MIN = 42, HARD_MAX = 65; // render honors a stored metaTitle 30–65 verbatim; 45–55 is the target
const BRAND_SUFFIX_RE = /\s*[—|–\-]\s*(?:The Screen Report|Screen Report)\s*$/i;
// Genuine short filler lead-ins we drop so the NAME can lead (never a meaningful clause).
const FILLER_LEAD_RE =
  /^(?:inside|meet|watch|see|look|exclusive|report|revealed|pics?|photos?|video|here'?s|the truth about)\b[:\s]+/i;

// A title must NOT END on any of these — an ending here reads as a chopped-off fragment/dangler.
const BAD_END = new Set((
  // articles / determiners / possessives
  "a an the this that these those his her its their our your my " +
  // prepositions / particles
  "of to in on at for with from by as into onto over under about after before amid near per via than then " +
  "up out off down back away around through along across upon between against toward towards " +
  // conjunctions
  "and or but nor so yet plus & " +
  // pronouns
  "he she it they we i you him them us who whom whose which " +
  // question / auxiliary words
  "why how what when where is are was were be been being am has have had do does did " +
  "will would can could should may might must " +
  // light/common verbs that dangle when orphaned
  "goes go get gets got put puts came come comes says said say make makes made take takes took " +
  "gave give gives went see sees saw keep keeps kept want wants leaves leave left " +
  // adverb/filler
  "just now also not no very really quite still even more most"
).split(" ").filter(Boolean));

const isContraction = (w) => /['’](t|s|re|ll|ve|d|m)$/i.test(w) || /n['’]t$/i.test(w);
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// last real word, stripped of surrounding quotes/punct so a leading quote ("'It") doesn't hide a bad ending.
const lastWord = (s) => (String(s).toLowerCase().split(/\s+/).pop() || "").replace(/^[^a-z0-9]+/u, "").replace(/[^a-z0-9'’-]+$/u, "");
const cleanEnds = (s) => String(s || "").replace(/^[\s—–\-|:,;]+/u, "").replace(/[\s—–\-|:,;&]+$/u, "").trim();

export const stripBrand = (s) => String(s || "").replace(BRAND_SUFFIX_RE, "").replace(/\s+/g, " ").trim();

// Multi-word names present in the base → char ranges we must not cut INSIDE (never split "Travis Kelce").
function nameRanges(base, names) {
  const ranges = [];
  const low = base.toLowerCase();
  for (const raw of names) {
    const n = String(raw || "").trim();
    if (!n || !/\s/.test(n)) continue; // single words can't be split
    const nl = n.toLowerCase();
    let i = 0;
    while ((i = low.indexOf(nl, i)) !== -1) { ranges.push([i, i + nl.length]); i += nl.length; }
  }
  return ranges;
}

// Does `prefix` (ending at char `endPos` within `full`) end on a clean, complete word?
function endsClean(prefix, endPos, ranges) {
  const w = lastWord(prefix);
  if (!w) return false;
  if (BAD_END.has(w) || isContraction(w)) return false;
  if (w.length === 1 && !/^\d$/.test(w)) return false;                 // orphaned single letter (e.g. "I", "a")
  if (((prefix.match(/["“”]/g) || []).length) % 2 !== 0) return false;  // unclosed double quote
  if (/(?:^|\s)['"‘“][^'"‘“’”]*$/u.test(prefix)) return false;          // orphaned OPENING quote at the end ("… 'It")
  if (ranges.some(([a, b]) => endPos > a && endPos < b)) return false;  // cut lands inside a multi-word name
  return true;
}

function leadNameOf(base, { primaryEntity = "", tags = [], about = [], coSubjects = [] } = {}) {
  const low = base.toLowerCase();
  if (primaryEntity && low.includes(String(primaryEntity).toLowerCase())) return primaryEntity;
  const person = (about || []).find((e) => e && e.name && (e.type === "Person" || !e.type) && low.includes(e.name.toLowerCase()));
  if (person) return person.name;
  const co = (coSubjects || []).find((c) => c && low.includes(String(c).toLowerCase()));
  if (co) return co;
  const nameTag = (tags || []).find((t) => /^[A-Z][a-zà-ÿ]/u.test(t) && /\s/.test(t) && base.includes(t));
  if (nameTag) return nameTag;
  const m = base.match(/[A-ZÀ-Þ][a-zà-ÿA-Z.'’-]+(?:\s+[A-ZÀ-Þ][a-zà-ÿA-Z.'’-]+)+/u);
  return m ? m[0] : "";
}

// Pick the best metaTitle from a name-first `base`: CLEAN ENDINGS WIN over length. Prefer the longest
// clean cut in [MIN,MAX]; else the whole title if it's ≤MAX and clean; else keep the FULL title (never
// a dangler). `names` = known multi-word names so a cut never splits one.
export function bestTitle(base, names = []) {
  const start = cleanEnds(String(base || "").replace(/\s+/g, " "));
  if (!start) return "";
  const variants = [start];
  const comp = cleanEnds(start.replace(/ and /g, " & "));
  if (comp !== start) variants.push(comp);

  let inBand = "";     // longest clean cut with MIN ≤ len ≤ MAX
  let wholeClean = ""; // the full title when it's already ≤MAX and clean
  for (const v of variants) {
    const ranges = nameRanges(v, names);
    // The renderer ships a stored metaTitle of 30–65 chars VERBATIM, so a 56–65 char headline never needed
    // cutting — yet inBand (a strictly shorter cut) used to win and shipped a mid-clause fragment.
    if (v.length <= HARD_MAX && endsClean(v, v.length, ranges) && v.length > wholeClean.length) wholeClean = v;
    const words = v.split(" ");
    let acc = "";
    for (const w of words) {
      acc = acc ? `${acc} ${w}` : w;
      if (acc.length > MAX) break;
      const cand = cleanEnds(acc);
      if (cand.length < SOFT_MIN) continue;                 // clean beats short, but don't go tiny
      if (!endsClean(cand, acc.length, ranges)) continue;
      if (cand.length > inBand.length) inBand = cand;       // longest clean cut in [SOFT_MIN,MAX] wins
    }
  }
  // Prefer the COMPLETE headline whenever it renders verbatim; only cut when it cannot ship whole.
  if (wholeClean && wholeClean.length <= HARD_MAX) return wholeClean;
  if (inBand) return inBand;
  if (wholeClean) return wholeClean;
  // no clean cut in [SOFT_MIN,MAX]: take the longest clean prefix ≤HARD_MAX so we NEVER return a dangler;
  // only if even that fails do we keep the full title (owner: clean beats short).
  let anyClean = "";
  for (const v of variants) {
    const ranges = nameRanges(v, names);
    let acc = "";
    for (const w of v.split(" ")) {
      acc = acc ? `${acc} ${w}` : w;
      const cand = cleanEnds(acc);
      if (cand.length >= 24 && cand.length <= HARD_MAX && endsClean(cand, acc.length, ranges) && cand.length > anyClean.length) anyClean = cand;
    }
  }
  return anyClean || cleanEnds(start);
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Deterministic name-first metaTitle from the full headline (the fallback + the backfill engine).
export function seoMetaTitle({ title, metaTitle, primaryEntity = "", tags = [], about = [], coSubjects = [] } = {}) {
  const full = stripBrand(title);
  if (!full) return "";
  let base = full;
  const lead = leadNameOf(base, { primaryEntity, tags, about, coSubjects });
  if (lead) {
    const idx = base.toLowerCase().indexOf(lead.toLowerCase());
    const before = base.slice(0, idx);
    const secondOfPair = /(?:\band\b|&|,|\bwith\b)\s*$/i.test(before);
    if (idx > 0 && !secondOfPair && before.length <= 16 && FILLER_LEAD_RE.test(before)) base = base.slice(idx).trim();
  } else {
    base = base.replace(FILLER_LEAD_RE, "").trim();
  }
  base = base.replace(/^[\s—–\-|:,]+/u, "").trim();
  const names = [primaryEntity, ...(coSubjects || []), ...(tags || []).filter((t) => /\s/.test(t) && /^[A-Z]/.test(t))].filter(Boolean);
  return cap(bestTitle(base, names)) || cap(bestTitle(full, names));
}

// Is a candidate metaTitle usable AS-IS (the writer crafted it well)? 30–65, brand-free, name-first,
// and a clean complete ending — no dangler, no mid-name split, no orphaned quote.
export function validMetaTitle(s, names = []) {
  const t = stripBrand(s);
  if (!t || t.length < 30 || t.length > HARD_MAX) return false;
  if (BRAND_SUFFIX_RE.test(s)) return false;
  if (!/^[A-ZÀ-Þ0-9"“'‘]/.test(t)) return false;          // starts like a name/proper noun
  if (!endsClean(t, t.length, nameRanges(t, names))) return false;
  return true;
}

// metaTitle = the writer's if it's good, else the deterministic name-first title. (Fix #1)
export function buildMetaTitle({ writerMetaTitle, title, primaryEntity = "", tags = [], about = [], coSubjects = [] } = {}) {
  const names = [primaryEntity, ...(coSubjects || []), ...(tags || []).filter((t) => /\s/.test(t) && /^[A-Z]/.test(t))].filter(Boolean);
  const w = stripBrand(writerMetaTitle);
  if (validMetaTitle(w, names)) return cap(w);
  return seoMetaTitle({ title, primaryEntity, tags, about, coSubjects });
}

// ── metaDescription ─────────────────────────────────────────────────────────
const endsSentence = (s) => /[.!?][”"’']?\s*$/.test(String(s).trim());
function trimToSentence(s, max = 160) {
  let t = String(s || "").trim();
  if (t.length <= max) return endsSentence(t) ? t : t.replace(/[\s,;:—–-]+$/u, "") + ".";
  // cut at the last sentence end ≤ max, else the last word boundary ≤ max
  const cut = t.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (lastStop >= 100) return cut.slice(0, lastStop + 1).trim();
  const sp = cut.lastIndexOf(" ");
  return (sp > 80 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/u, "") + "…";
}

export function validMetaDesc(s, dek = "") {
  const t = String(s || "").trim();
  // Must be ≤160: the site render's clampMeta collapses anything >160 to its FIRST sentence (= the dek),
  // so a 161–165 description silently loses its second sentence. Keep it whole and ≤160.
  if (t.length < 118 || t.length > 160) return false;
  if (!endsSentence(t)) return false;
  if (((t.match(/["“”]/g) || []).length) % 2 !== 0) return false; // unclosed quote
  if (dek && norm(t) === norm(dek)) return false;                 // must be DISTINCT from the dek
  return true;
}

// metaDescription = the writer's teaser if good, else build a 140–160 teaser from dek + one concrete
// fact (keyTakeaways / whatWeKnow), ending on a full sentence, distinct from the dek. (Fix #1)
// ends on a bare number/currency ("$13", "13") that's almost always a cut "$13 million" — but a 4-digit year is fine.
const endsOnNumber = (c) => { const w = (c.split(" ").pop() || ""); return /^[$€£]?\d[\d,.]*[kmb%]?$/i.test(w) && !/^(?:19|20)\d\d$/.test(w); };
// Longest CLEAN-ENDING word-prefix of `fact` that fits in `room` chars (no mid-number / mid-name / dangler cut).
// The appended fact is given a period, so a PARTIAL clause reads as a finished sentence ("…filed in Los
// Angeles Superior." shipped on 146/194 live articles). Accept a truncation only when it keeps
// essentially the whole fact and does not split a proper name; otherwise return nothing and let the
// caller ship the dek alone.
function fitPhrase(fact, room, names = []) {
  if (fact.length <= room) return fact;
  const ranges = nameRanges(fact, names);
  let acc = "", best = "";
  for (const wd of fact.split(" ")) {
    const nx = acc ? `${acc} ${wd}` : wd;
    if (nx.length > room) break;
    acc = nx;
    const c = cleanEnds(acc);
    if (c.length >= 20 && endsClean(c, acc.length, ranges) && !endsOnNumber(c)) best = c;
  }
  if (best && best.length < Math.floor(fact.length * 0.85)) return ""; // mid-clause fragment, not a sentence
  return best;
}
export function buildMetaDescription({ writerMetaDesc, dek = "", keyTakeaways = [], whatWeKnow = [], names = [] } = {}, max = 158) {
  const w = String(writerMetaDesc || "").trim();
  if (validMetaDesc(w, dek)) return w;                            // already a clean ≤160 teaser — honored verbatim

  let d = String(dek || "").trim();
  if (d && !endsSentence(d)) d = d.replace(/[\s,;:—–-]+$/u, "") + ".";
  // A 138–160 char dek used to return here verbatim, shipping metaDescription === dek (which
  // validMetaDesc explicitly rejects) on 21 live articles. Try one distinct fact first.
  const dekOnly = d.length > 160 ? trimToSentence(d, 158) : d;

  // Append ONE distinct fact, WHOLE if it fits else clean-truncated to a word boundary, so it always ends on a
  // full sentence. Pick whichever fact fills the snippet closest to ~160.
  const facts = [...(keyTakeaways || []), ...(whatWeKnow || [])]
    .map((f) => String(f || "").replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim())
    .filter((f) => f.length >= 12 && !norm(d).includes(norm(f).slice(0, 22)));
  let best = "";
  for (const f of facts) {
    const phrase = fitPhrase(f, max - d.length - 2, names);
    if (phrase.length > best.length) best = phrase;
  }
  if (best) d = `${d} ${cap(best)}${endsSentence(best) ? "" : "."}`.replace(/\s+/g, " ");
  else if (dekOnly) return dekOnly;      // nothing distinct fits ⇒ the dek alone
  return endsSentence(d) ? d : d.replace(/[\s,;:—–-]+$/u, "") + ".";
}

/** Clamp any string to ≤max at a word boundary (kept for callers that want a hard cap). */
export function clampDesc(s, max = 160) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/u, "").trim() + "…";
}

/** The single strongest search phrase (stored as targetKeyword) — never the junk terms. */
export function targetKeywordFor({ primaryEntity = "", tags = [] } = {}) {
  const pe = String(primaryEntity || "").trim();
  if (pe && !JUNK_TAG.has(pe.toLowerCase())) return pe;
  const t = (tags || []).map((x) => String(x || "").trim()).filter((x) => x && !JUNK_TAG.has(x.toLowerCase()));
  return t[0] || pe || "";
}

// Reader-facing purge (owner 07-04): NEVER expose "gossip"/"general" as a keyword. (Fix #5)
export const JUNK_TAG = new Set(["gossip", "celebrity gossip", "general", "rumor", "rumour", ""]);

// Clean keyword tags: the people + the topic, no junk. Order = strongest first. (Fix #5)
export function deriveKeywords({ primaryEntity = "", coSubjects = [], category = "", subcategory = "", event = "" } = {}) {
  const raw = [
    primaryEntity,
    ...(coSubjects || []),
    event,
    category,
    subcategory && subcategory !== "news" ? subcategory.replace(/-/g, " ") : "",
  ];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const t = String(r || "").trim();
    if (!t || JUNK_TAG.has(t.toLowerCase())) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(0, 6);
}
