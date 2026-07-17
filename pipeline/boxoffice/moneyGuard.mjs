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
  // Longest-alternative-first + (?![a-z]) so a magnitude LETTER never eats the start of a following word:
  // "$750,000 budget" must parse as $750,000 — not "b"(illion) = $750 trillion (a live false-cut source).
  const m = s.match(/\$?\s*([\d]+(?:\.\d+)?)\s*(thousand|million|billion|mil|bil|[kmb])?(?![a-z])/);
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
// Magnitude alternatives longest-first + (?![a-z]) so "m"/"b"/"k" never bite into a following word
// ("$750,000 budget" is $750,000, not "$750,000 b[illion]" — that mis-parse produced false fidelity cuts).
const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:thousand|million|billion|mil|bil|[kmb])(?![a-z]))?|\b\d[\d,]*(?:\.\d+)?\s*(?:million|billion|thousand)\b/gi;
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
  const vals = []; // raw allowed money values, for the faithful-rounding tolerance in numberFidelity
  const addFromText = (s) => { for (const f of extractFigures(String(s))) { set.add(f.bucket); if (f.kind === "money") { const v = normMoney(f.raw); if (v) vals.push(v); } } };
  for (const n of numbers) addFromText(n);
  for (const s of moneyStrings) { const v = normMoney(s); if (v != null) { set.add(moneyBucket(v)); vals.push(v); } addFromText(s); }
  for (const p of pcts) { const n = parseFloat(p); if (Number.isFinite(n)) set.add(pctBucket(n)); }
  for (const c of counts) { const n = parseInt(String(c).replace(/,/g, ""), 10); if (Number.isFinite(n)) set.add(countBucket(n)); }
  set.moneyValues = vals; // (a Set can carry a property; existing `.has(bucket)` callers are unaffected)
  return set;
}

// Split on NEWLINES first, then terminal punctuation followed by whitespace — a decimal ("$45.2
// million") is never broken at its own period, and a markdown HEADING becomes its own atomic unit.
// (The old newline-flattening glued "## Heading With $1 Billion" onto the next sentence, so the cutter
// could never remove a figure-bearing heading — it survived every cut pass as an unrecoverable phantom.)
const splitSentences = (body) => String(body || "").split(/\n+/)
  .flatMap((line) => line.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);

// NUMBER-FIDELITY WALL. Returns { ok, unsupported:[{raw,bucket,sentence}], cutClaims:[sentence] }.
export function numberFidelity(article, allowed) {
  const body = article?.body || "";
  // dek + metaDescription are DERIVED short fields the shared cutArticle can't strip, so they are
  // auto-repaired in qa.fidelityLocks (stripUnsupportedSentences) rather than becoming an unclearable
  // cutClaim here. Only body + keyTakeaways + faq (all cuttable) feed the cut-generating scan.
  const extra = [...(article?.keyTakeaways || []),
    ...(article?.faq || []).flatMap((f) => [f?.q, f?.a])].filter(Boolean).join(". ");
  // A faithful ROUNDING of an allowed money figure ($111.7M reported as "$111 million") is not a fabrication —
  // accept a money figure within ~1.5% of an allowed value; a genuinely wrong number is still cut.
  const money = allowed.moneyValues || [];
  const roundedFromAllowed = (raw) => { const v = normMoney(raw); return v != null && money.some((a) => a > 0 && Math.abs(v - a) / a <= 0.015); };
  const unsupported = [];
  const cutClaims = [];
  for (const sent of splitSentences(body + ". " + extra)) {
    for (const f of extractFigures(sent)) {
      if (allowed.has(f.bucket)) continue;
      if (f.kind === "money" && roundedFromAllowed(f.raw)) continue;
      unsupported.push({ raw: f.raw, bucket: f.bucket, sentence: sent.trim() });
      cutClaims.push(sent.trim());
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

// ── SINGLE SOURCE OF TRUTH (the anti-self-contradiction spine) ──────────────────────────────────
// The live Obsession failure: metaTitle said "$100M+", the boxOffice block said $26.4M/$68.3M, the
// takeaways said BOTH "$26.4M" and "$106M domestically", and two FAQs gave different worldwide totals —
// every surface drew its numbers from a different place. canonicalFigures reconciles ONE figure set from
// the LABELED sources only (the daily chart's cume, the gatherer's labeled fields, trusted TMDB), and
// every downstream surface (title, metaTitle, dek, meta, takeaways, FAQ, boxOffice block, body) must draw
// from it. numberConsistencyGate then diffs every dollar figure across all surfaces and BLOCKS publish on
// contradiction — an article can no longer disagree with itself.
export function canonicalFigures({ gathered = {}, boxData = {}, film = {} } = {}) {
  const dc = film?.dailyChart || {};
  const pick = (...cands) => {
    for (const c of cands) { if (c == null || c === "") continue; const v = normMoney(c); if (v != null && v > 0) return { text: String(c), raw: v }; }
    return null;
  };
  const openingWeekend = pick(gathered.openingWeekend);
  // Domestic running total: the daily chart is ground truth when present; else the gatherer's labels.
  const domestic = pick(dc.cume, gathered.cume, gathered.domestic);
  const international = pick(gathered.international);
  let worldwide = pick(gathered.worldwide, boxData.worldwide);
  // Reconcile: worldwide ⊇ domestic — a "worldwide" below the domestic total is a wrong figure → drop it.
  if (worldwide && domestic && worldwide.raw < domestic.raw * 0.99) worldwide = null;
  // Reconcile: if domestic + international ≉ worldwide (>12% off), the worldwide is mis-extracted → drop it.
  if (worldwide && domestic && international && Math.abs(domestic.raw + international.raw - worldwide.raw) / worldwide.raw > 0.12) worldwide = null;
  const budget = pick(boxData.budget);
  const dailyGross = pick(dc.dailyGross);
  const hoursViewed = pick(gathered.hoursViewed);
  const theatersN = parseInt(String(gathered.theaters || dc.theaters || "").replace(/,/g, ""), 10);
  const theaters = Number.isFinite(theatersN) && theatersN > 0 ? { text: String(gathered.theaters || dc.theaters), raw: theatersN } : null;
  const dropN = parseFloat(String(gathered.dropPct ?? "").replace("%", ""));
  const dropPct = Number.isFinite(dropN) ? { text: String(gathered.dropPct), raw: dropN } : null;
  const dayInRelease = (String(dc.dayInRelease || "").match(/\d+/) || [null])[0];
  return { openingWeekend, domestic, international, worldwide, budget, dailyGross, hoursViewed, theaters, dropPct, dayInRelease };
}

// Scope words that BIND a nearby money figure to a specific canonical slot — "its domestic total hit
// $106 million" must match canon.domestic, not merely SOME allowed figure. This is what catches a body
// that contradicts the structured block.
const FIGURE_SCOPES = [
  { key: "domestic", re: /\bdomestic(ally)?\b|\bnorth americ(a|an)\b|\bstateside\b/i, keys: ["domestic", "openingWeekend", "dailyGross"] },
  { key: "worldwide", re: /\bworldwide\b|\bglobal(ly)?\b|\bglobal box office\b/i, keys: ["worldwide"] },
  { key: "budget", re: /\bbudget\b|\bproduction cost\b|\bcost(s)? to (produce|make)\b/i, keys: ["budget"] },
  { key: "openingWeekend", re: /\bopening weekend\b|\bopened to\b|\bdebut(ed)? (to|with)\b/i, keys: ["openingWeekend", "domestic"] },
];

// numberConsistencyGate — run on the FINAL assembled surfaces right before publish.
//  STRICT surfaces (title, metaTitle, dek, metaDescription, keyTakeaways, faq): every money figure must
//  match a CANONICAL figure (±5%) or a figure inside the film's own verbatim record claims. No grab-bag.
//  ALL surfaces (incl. body): a figure bound to a scope word must match THAT canonical slot.
// Returns { ok, violations: [string] } — any violation must block publish (accuracy is existential).
export function numberConsistencyGate(surfaces, canon, { recordTexts = [] } = {}) {
  const canonMoney = [canon.openingWeekend, canon.domestic, canon.international, canon.worldwide,
    canon.budget, canon.dailyGross, canon.hoursViewed].filter(Boolean).map((c) => c.raw);
  const recFigs = recordTexts.flatMap((r) => extractFigures(String(r || "")));
  const recMoney = recFigs.filter((f) => f.kind === "money").map((f) => normMoney(f.raw)).filter((v) => v != null);
  const recPcts = new Set(recFigs.filter((f) => f.kind === "pct").map((f) => Math.round(parseFloat(f.raw))));
  const okMoney = (v) => [...canonMoney, ...recMoney].some((a) => a > 0 && Math.abs(v - a) / a <= 0.05);
  const okPct = (n) => (canon.dropPct && Math.abs(n - canon.dropPct.raw) <= 1) || recPcts.has(Math.round(n));
  const okCount = (n) => !!(canon.theaters && n === canon.theaters.raw);
  const violations = [];

  const strict = (label, text) => {
    for (const f of extractFigures(String(text || ""))) {
      if (f.kind === "money") { const v = normMoney(f.raw); if (v != null && !okMoney(v)) violations.push(`${label}: "${f.raw}" is not a canonical figure for this film`); }
      else if (f.kind === "pct") { const n = parseFloat(f.raw); if (Number.isFinite(n) && !okPct(n)) violations.push(`${label}: "${f.raw}" is not the film's verified change figure`); }
      else if (f.kind === "count") { const n = parseInt(String(f.raw).replace(/[^\d]/g, ""), 10); if (Number.isFinite(n) && !okCount(n)) violations.push(`${label}: theater count "${f.raw}" is not the verified count`); }
    }
  };
  strict("title", surfaces.title);
  strict("metaTitle", surfaces.metaTitle);
  strict("dek", surfaces.dek);
  strict("metaDescription", surfaces.metaDescription);
  (surfaces.keyTakeaways || []).forEach((t, i) => strict(`keyTakeaways[${i}]`, t));
  (surfaces.faq || []).forEach((f, i) => { strict(`faq[${i}].q`, f?.q); strict(`faq[${i}].a`, f?.a); });

  // Scoped-coherence over EVERY surface including the body: a figure bound to "domestic"/"worldwide"/
  // "budget"/"opening weekend" must match that canonical slot — this catches "pushed its domestic total
  // to $106 million" when the canonical domestic is $26.4M. A figure binds to its NEAREST scope word
  // (never across another figure), so "$26.4M domestically, with $68.3M worldwide" binds each correctly.
  const scoped = (label, text) => {
    for (const sent of splitSentences(String(text || ""))) {
      const tokens = [...sent.matchAll(MONEY_RE)]
        .map((m) => ({ raw: m[0].trim(), v: normMoney(m[0]), start: m.index, end: m.index + m[0].length }))
        .filter((t) => t.v != null);
      if (!tokens.length) continue;
      const occ = [];
      for (const sc of FIGURE_SCOPES) {
        const re = new RegExp(sc.re.source, "gi");
        for (const m of sent.matchAll(re)) occ.push({ sc, start: m.index, end: m.index + m[0].length });
      }
      for (const t of tokens) {
        let best = null;
        for (const o of occ) {
          const gap = o.start >= t.end ? o.start - t.end : (o.end <= t.start ? t.start - o.end : 0);
          if (gap > 60) continue;
          const lo = Math.min(o.start, t.start), hi = Math.max(o.end, t.end);
          if (tokens.some((x) => x !== t && x.start >= lo && x.end <= hi)) continue; // never bind across another figure
          if (!best || gap < best.gap) best = { sc: o.sc, gap };
        }
        if (!best) continue;
        const targets = best.sc.keys.map((k) => canon[k]).filter(Boolean).map((c) => c.raw);
        if (!targets.length) violations.push(`${label}: "${t.raw}" is scoped ${best.sc.key} but the film has no canonical ${best.sc.key} figure`);
        else if (!targets.some((a) => Math.abs(t.v - a) / a <= 0.05) && !recMoney.some((a) => a > 0 && Math.abs(t.v - a) / a <= 0.05))
          violations.push(`${label}: "${t.raw}" contradicts the canonical ${best.sc.key} figure (${best.sc.keys.map((k) => canon[k]?.text).filter(Boolean)[0] || "n/a"})`);
      }
    }
  };
  scoped("body", surfaces.body);
  scoped("title", surfaces.title);
  (surfaces.keyTakeaways || []).forEach((t, i) => scoped(`keyTakeaways[${i}]`, t));
  (surfaces.faq || []).forEach((f, i) => scoped(`faq[${i}].a`, f?.a));

  // SAME-METRIC RULE: the title and metaTitle must headline the SAME canonical metric — a SERP snippet
  // promising "$882M Worldwide" over an H1 reporting "$410.6M domestic" is a broken promise (live audit:
  // 7/9). Each surface's money figures are mapped to canonical slots; the two sets must intersect.
  const SLOT_KEYS = ["domestic", "worldwide", "openingWeekend", "budget", "dailyGross", "hoursViewed"];
  const slotsOf = (text) => {
    const set = new Set();
    for (const f of extractFigures(String(text || ""))) {
      if (f.kind !== "money") continue;
      const v = normMoney(f.raw);
      if (v == null) continue;
      const k = SLOT_KEYS.find((key) => canon[key] && Math.abs(v - canon[key].raw) / canon[key].raw <= 0.05);
      set.add(k || "other");
    }
    return set;
  };
  const tSlots = slotsOf(surfaces.title), mSlots = slotsOf(surfaces.metaTitle);
  if (tSlots.size && mSlots.size && ![...mSlots].some((s) => tSlots.has(s)))
    violations.push(`metaTitle: headlines ${[...mSlots].join("/")} while the title headlines ${[...tSlots].join("/")} — the SERP promise must match the page`);

  return { ok: violations.length === 0, violations: [...new Set(violations)] };
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
