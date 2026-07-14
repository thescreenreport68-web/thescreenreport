// THE FIDELITY WALLS (deterministic, free, no LLM) — the accuracy spine of the box-office lane
// (plan §10). Everything here is pure functions over strings so the offline suite can hammer them.
//
//  1. NUMBER-FIDELITY WALL — every money figure / percentage / theater-count in the article must
//     normalize to a value the gatherer extracted from the trade report OR the deterministic TMDB
//     data. An unsupported figure → the sentence is CUT (owner's cut-don't-hold policy).
//  2. NO-INVENTION WALL — a domestic/international split or a "record"/"all-time"/"biggest-ever"
//     claim the source never stated is flagged (the writer must never invent a split or a record).
//
// Conservative BY DESIGN: only money ($-amounts or magnitude-worded), percentages, and
// theater/screen counts are extracted. Bare integers, years, and ordinals are ignored — so the wall
// never false-positives on "No. 1", "second weekend", "2026", or "two films".

// ── normalization ────────────────────────────────────────────────────────────────────────────────
const MAG = { k: 1e3, thousand: 1e3, m: 1e6, mil: 1e6, million: 1e6, b: 1e9, bil: 1e9, billion: 1e9 };

// Canonical value for a money string → integer dollars, or null. Handles "$1.45 billion", "$162M",
// "$636.8 million", "$50,000", "$162". A magnitude word (million/billion/…) is required when there
// is no "$" so a bare integer is never mistaken for money.
export function normMoney(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/,/g, "").trim();
  const m = s.match(/\$?\s*([\d]+(?:\.\d+)?)\s*(k|thousand|m|mil|million|b|bil|billion)?/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  const magWord = m[2];
  const hasDollar = /\$/.test(s);
  if (!magWord && !hasDollar) return null;        // bare number, no $ and no magnitude → not money
  const mult = magWord ? MAG[magWord] : 1;
  return Math.round(num * mult);
}

// Round to 3 significant figures so "$162 million" and "$162.0 million" and a TMDB raw that fmts to
// "$162 million" all collapse to the same bucket (trades round; we must match how we handed the
// figure to the writer, which is the fmtUSD string).
export function moneyBucket(dollars) {
  if (dollars == null) return null;
  if (dollars === 0) return "money:0";
  const digits = Math.floor(Math.log10(Math.abs(dollars)));
  const scale = Math.pow(10, Math.max(0, digits - 2));
  return "money:" + Math.round(dollars / scale) * scale;
}

const pctBucket = (n) => "pct:" + Math.round(n);
const countBucket = (n) => "count:" + n;

// ── extraction from article prose ──────────────────────────────────────────────────────────────
// A money token: "$1.45 billion", "$162M", "$636.8 million", "$50,000", or a magnitude-worded amount
// even without "$" ("grossed 162 million"). Returns {raw, bucket}.
const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|thousand|m|mil|million|b|bil|billion)?|\b\d[\d,]*(?:\.\d+)?\s*(?:million|billion|thousand)\b/gi;
// No trailing \b after "%" — between "%" and a following comma/space there is no word boundary.
const PCT_RE = /\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?percent\b/gi;
// A count is only a "theater count" when a venue word sits right next to it.
const COUNT_RE = /\b([\d][\d,]{2,})\s*(?:theaters?|theatres?|screens?|locations?|venues?|cinemas?)\b/gi;

export function extractFigures(text) {
  const out = [];
  const t = String(text || "");
  for (const m of t.matchAll(MONEY_RE)) {
    const v = normMoney(m[0]);
    if (v != null) out.push({ raw: m[0].trim(), kind: "money", bucket: moneyBucket(v) });
  }
  for (const m of t.matchAll(PCT_RE)) {
    const n = parseFloat(m[0]);
    if (Number.isFinite(n)) out.push({ raw: m[0].trim(), kind: "pct", bucket: pctBucket(n) });
  }
  for (const m of t.matchAll(COUNT_RE)) {
    const n = parseInt(m[1].replace(/,/g, ""), 10);
    if (Number.isFinite(n)) out.push({ raw: m[0].trim(), kind: "count", bucket: countBucket(n) });
  }
  return out;
}

// Build the ALLOWED bucket set from the gatherer's extracted numbers + the deterministic TMDB data.
// `numbers` = array of strings/numbers the gatherer pulled verbatim; `moneyStrings` = the fmtUSD
// strings we actually hand the writer (TMDB worldwide/budget); `pcts`/`counts` optional.
export function buildAllowed({ numbers = [], moneyStrings = [], pcts = [], counts = [] } = {}) {
  const set = new Set();
  const addFromText = (s) => { for (const f of extractFigures(String(s))) set.add(f.bucket); };
  for (const n of numbers) addFromText(n);
  for (const s of moneyStrings) { const v = normMoney(s); if (v != null) set.add(moneyBucket(v)); addFromText(s); }
  for (const p of pcts) { const n = parseFloat(p); if (Number.isFinite(n)) set.add(pctBucket(n)); }
  for (const c of counts) { const n = parseInt(String(c).replace(/,/g, ""), 10); if (Number.isFinite(n)) set.add(countBucket(n)); }
  return set;
}

// Split only on terminal punctuation FOLLOWED BY whitespace — so a decimal ("$45.2 million") is
// never broken at its own period (the period there is between digits, not before a space).
const splitSentences = (body) => String(body || "").replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

// NUMBER-FIDELITY WALL. Returns { ok, unsupported:[{raw,bucket,sentence}], cutClaims:[sentence] }.
export function numberFidelity(article, allowed) {
  const body = article?.body || "";
  // dek + metaDescription are DERIVED short fields the shared cutArticle can't strip, so they are
  // auto-repaired in qa.fidelityLocks (stripUnsupportedSentences) rather than becoming an unclearable
  // cutClaim here. Only body + keyTakeaways + faq (all cuttable) feed the cut-generating scan.
  const extra = [...(article?.keyTakeaways || []),
    ...(article?.faq || []).flatMap((f) => [f?.q, f?.a])].filter(Boolean).join(". ");
  const unsupported = [];
  const cutClaims = [];
  for (const sent of splitSentences(body + ". " + extra)) {
    for (const f of extractFigures(sent)) {
      if (!allowed.has(f.bucket)) {
        unsupported.push({ raw: f.raw, bucket: f.bucket, sentence: sent.trim() });
        cutClaims.push(sent.trim());
      }
    }
  }
  return { ok: unsupported.length === 0, unsupported, cutClaims: [...new Set(cutClaims)] };
}

// Strip any sentence carrying an UNSUPPORTED figure from a short DERIVED field (dek/metaDescription).
// The shared cutArticle never touches those two fields, so without this an unsupported number there
// would become an unclearable cutClaim and dead-hold an otherwise-clean article. Returns cleaned text.
export function stripUnsupportedSentences(text, allowed) {
  if (!text) return text || "";
  return splitSentences(text).filter((s) => extractFigures(s).every((f) => allowed.has(f.bucket))).join(" ").trim();
}
// The first body sentence whose every figure is supported — a safe backfill for an emptied dek.
export function firstCleanSentence(body, allowed) {
  for (const s of splitSentences(body)) if (extractFigures(s).every((f) => allowed.has(f.bucket))) return s;
  return "";
}

// NO-INVENTION WALL — a domestic/international SPLIT or a RECORD claim the source never stated.
// `hasSplit` / `hasRecord` = whether the gathered material actually contained that kind of claim.
const SPLIT_RE = /\b(domestic(?:ally)?|international(?:ly)?|overseas|abroad|foreign)\b/i;
// A worldwide/global/lifetime TOTAL that merely mentions "overseas/international" is NOT a split —
// don't flag "Overseas, its worldwide total hit $1.45 billion" as an invented domestic/intl split.
const NONSPLIT_RE = /\b(worldwide|global|lifetime|combined|overall)\b/i;
const RECORD_RE = /\b(record|all[- ]time|biggest[- ]ever|highest[- ]grossing|best[- ]ever|fastest[- ]to|milestone|surpass(?:ed|es|ing)?|overtak(?:e|es|en|ing))\b/i;
export function noInvention(article, { hasSplitNumber = false, hasRecord = false } = {}) {
  const blocks = [];
  const sentences = splitSentences(article?.body || "");
  for (const sent of sentences) {
    // A split CLAIM tied to a specific figure the source didn't break out (a worldwide total isn't one).
    if (!hasSplitNumber && SPLIT_RE.test(sent) && /\$|\bmillion\b|\bbillion\b/i.test(sent) && !NONSPLIT_RE.test(sent))
      blocks.push({ kind: "invented-split", sentence: sent.trim() });
    if (!hasRecord && RECORD_RE.test(sent))
      blocks.push({ kind: "invented-record", sentence: sent.trim() });
  }
  return { ok: blocks.length === 0, blocks, cutClaims: [...new Set(blocks.map((b) => b.sentence))] };
}

// PLATFORM GUARD (NOW-STREAMING) — a streaming-service named in prose must be a TMDB-confirmed
// platform for this title. Prevents "now on Netflix" when JustWatch says Max.
const SERVICES = ["netflix", "max", "hbo max", "disney+", "disney plus", "hulu", "prime video", "amazon prime", "apple tv+", "apple tv plus", "peacock", "paramount+", "paramount plus", "starz", "showtime"];
export function platformGuard(article, allowedPlatforms = []) {
  const allow = new Set(allowedPlatforms.map((p) => String(p).toLowerCase().replace(/\s+/g, " ").trim()));
  const body = String(article?.body || "").toLowerCase();
  const bad = [];
  for (const svc of SERVICES) {
    if (!body.includes(svc)) continue;
    const ok = [...allow].some((a) => a.includes(svc) || svc.includes(a));
    if (!ok) bad.push(svc);
  }
  return { ok: bad.length === 0, bad };
}

// STREAMING-AVAILABILITY GUARD — a "now streaming" CLAIM must be backed by a FLATRATE (subscription)
// provider. A title available ONLY to rent/buy (Amazon Video, Apple TV storefront, Fandango At Home)
// is NOT "now streaming" — saying so is a wrong message (the live "Michael now streaming" bug: it was
// $19.99 rent/buy, not on any subscription service). This is the verification the platformGuard missed:
// platformGuard checks the NAMED service is a provider; THIS checks the streaming CLAIM matches the
// provider TYPE. `flatrate` = the confirmed subscription platforms (TMDB providers.stream + a
// streaming gathered.platform like Netflix). Returns offending sentences to cut + whether a short
// field (title/dek) carries the false claim (uncuttable → hard block).
const STREAM_CLAIM_RE = /\b(now streaming|streaming (now|debut|today|this week|exclusively)|available (to|for) stream(ing)?|stream(s|ing)? (it |the film |the movie )?(now|today|on (netflix|max|hbo|disney|hulu|prime|apple tv\+|peacock|paramount|starz))|start(s|ed|ing)? streaming|hits? streaming|is streaming|streaming (debut|release|arrival)|watch it (now )?on (netflix|max|hbo max|disney\+|hulu|prime video|apple tv\+|peacock|paramount\+|starz))\b/i;
export function streamingClaimGuard(article, { flatrate = [] } = {}) {
  const hasFlatrate = (flatrate || []).map((x) => String(x || "").trim()).filter(Boolean).length > 0;
  if (hasFlatrate) return { ok: true, cuts: [], hardWrong: false }; // real subscription provider → streaming is TRUE
  const cuts = splitSentences(article?.body || "").filter((s) => STREAM_CLAIM_RE.test(s));
  const inShort = STREAM_CLAIM_RE.test(`${article?.title || ""} ${article?.dek || ""} ${article?.metaTitle || ""}`);
  return { ok: cuts.length === 0 && !inShort, cuts: [...new Set(cuts)], hardWrong: inShort };
}
