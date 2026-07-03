// UNIFIED ARTICLE CUTTER (2026-07-03 restructure). PUBLISH-EVERYTHING cut pass (owner 2026-07-02): given the
// exact flagged claim texts, remove the SENTENCES that carry them (fuzzy: a sentence sharing >=60% of a claim's
// significant tokens IS that claim; short numeric specifics match by substring). Moved out of run.mjs and
// extended to the WHOLE article: the old cutter only edited body — a flagged fabrication SURVIVED in
// keyTakeaways, FAQ answers, and structured fields straight into the published frontmatter (critical audit
// defect D3). One cutter now serves BOTH cut paths (gate cut-and-publish + the web reality-check).
const toks = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 3);
const normNum = (s) => String(s).toLowerCase().replace(/[^a-z0-9$%. ]/g, " ").replace(/\s+/g, " ").trim();

// Each claim → its significant tokens PLUS, for a SHORT NUMERIC/DATE specific (few words but has $/%/digits —
// which tokenizes to nothing and used to SURVIVE the cut, e.g. "$10.5M" / "Billie Piper 2023"), a distinctive
// substring to also match.
export function buildMatchers(claims) {
  return (claims || [])
    .filter((c) => typeof c === "string" && c.length > 8)
    .map((c) => {
      const tk = toks(c);
      // A SHORT claim (few significant tokens) can't be token-overlap matched — match it as a normalized
      // SUBSTRING instead: numeric specifics ("$10.5M", "Billie Piper 2023") AND short phrases like
      // "according to Variety" (the specifics-guard attribution findings) both cut this way.
      const short = tk.length < 3 && (/\d|\$|%/.test(c) || c.length >= 12);
      // Numeric CORES of the claim ("$72.5 million" → "72.5") — used for STRUCTURED-FIELD matching only: an
      // atomic field value ("$72.5 million") carries none of the claim's prose tokens, so it must match on the
      // poisoned number itself. Bare 4-digit years are excluded (they would over-cut harmless field values).
      const nums = (c.match(/\d[\d,]*(?:\.\d+)?/g) || [])
        .map((n) => n.replace(/,/g, ""))
        .filter((n) => n.length >= 2 && !/^(19|20)\d{2}$/.test(n));
      return { tk, sub: short ? normNum(c) : null, nums };
    })
    .filter((m) => m.tk.length >= 3 || (m.sub && m.sub.length >= 5) || m.nums.length);
}
const isFlagged = (text, matchers) => {
  const st = new Set(toks(text));
  const sn = normNum(text);
  return matchers.some((m) => (m.tk.length >= 3 && m.tk.filter((t) => st.has(t)).length / m.tk.length >= 0.6) || (m.sub && sn.includes(m.sub)));
};
// Field-value matching adds the numeric-core check (an atomic "$72.5 million" field shares no prose tokens
// with the long claim that flagged the figure). FIELDS ONLY — on body prose this would over-cut.
const isFlaggedField = (text, matchers) => {
  if (isFlagged(text, matchers)) return true;
  const digits = normNum(text).replace(/,/g, "");
  return matchers.some((m) => (m.nums || []).some((n) => digits.includes(n)));
};

// Body pass: sentence-level deletion; headings / list rows / table rows / blanks stay so structure survives.
export function cutBody(body, matchers) {
  let cut = 0;
  const out = String(body || "").split("\n").map((line) => {
    if (/^\s*(#{1,6}\s|[-*]\s|\|)/.test(line) || !line.trim()) return line;
    const sents = line.split(/(?<=[.!?])\s+/);
    const kept = sents.filter((sent) => { const f = isFlagged(sent, matchers); if (f) cut++; return !f; });
    return kept.join(" ");
  });
  return { body: out.join("\n").replace(/\n{3,}/g, "\n\n"), cut };
}

// WHOLE-ARTICLE pass (mutates `article`): body sentences + keyTakeaways bullets + FAQ entries (flag on q+a) +
// the writer-emitted numeric box-office fields. System-supplied verified figures (boxOffice.worldwide/budget,
// straight from TMDB) are NEVER cut — they were not written by the model.
export function cutArticle(article, claims) {
  const matchers = buildMatchers(claims);
  if (!matchers.length || !article) return { cut: 0, fieldCuts: 0 };
  let fieldCuts = 0;
  const { body, cut } = cutBody(article.body, matchers);
  article.body = body;
  if (Array.isArray(article.keyTakeaways)) {
    const kept = article.keyTakeaways.filter((k) => !isFlagged(k, matchers));
    fieldCuts += article.keyTakeaways.length - kept.length;
    article.keyTakeaways = kept;
  }
  if (Array.isArray(article.faq)) {
    const kept = article.faq.filter((f) => !isFlagged(`${f?.q || ""} ${f?.a || ""}`, matchers));
    fieldCuts += article.faq.length - kept.length;
    article.faq = kept;
  }
  if (article.boxOffice) {
    for (const k of ["domestic", "international", "openingWeekend"]) {
      if (article.boxOffice[k] && isFlaggedField(String(article.boxOffice[k]), matchers)) { delete article.boxOffice[k]; fieldCuts++; }
    }
  }
  for (const k of ["records", "awardRecords"]) {
    if (Array.isArray(article[k])) {
      const kept = article[k].filter((r) => !isFlaggedField(typeof r === "string" ? r : JSON.stringify(r || ""), matchers));
      fieldCuts += article[k].length - kept.length;
      article[k] = kept;
    }
  }
  return { cut, fieldCuts };
}
