// factGuards.mjs — NEWS-lane deterministic anti-fabrication guards (owner root-cause directive 2026-07-17).
// The 2026-07-17 12h audit found the writer inventing PRECISION the source never gave: quotes that don't
// exist in the Billboard cover story (Jagger), an invented casting date (Oct 25 vs the real Oct 31), an
// invented "confirmed in August 2025", a nonexistent album name. The trust model says the writer may ONLY
// restate the source — so anything quoted or precisely dated that is NOT in the source bundle gets CUT
// (cut-not-hold, per the publish-everything policy). Deterministic, no LLM, fail-open when there is no
// bundle text to check against (guards need ground truth to act).
const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const toks = (s) => norm(s).split(" ").filter((w) => w.length > 1);

// Split a paragraph into sentences (abbreviation-aware — same rule as seoFinish).
const SENT_RE = /(?<!\b(?:No|Mr|Mrs|Ms|Dr|Jr|Sr|St|Mt|vs|Vol|Inc|Ltd|Co|Corp|Bros|approx|etc|U\.S|U\.K)\.)(?<=[.!?…])\s+(?=[A-Z“"'‘(])/;

// ── QUOTE ANCHOR ─────────────────────────────────────────────────────────────────────────────────
// Every quoted passage of ≥ 8 words in the article must be anchored in the bundle: ≥80% of its tokens
// present in the bundle text. Unanchored → the whole containing sentence is cut (a quote is never
// paraphrasable back to safety; the speaker did not say it).
export function quoteAnchored(quote, bundleNorm) {
  const t = toks(quote);
  if (t.length < 8) return true; // short fragments ("huge fan") are too generic to police
  const hits = t.filter((w) => bundleNorm.includes(" " + w + " ")).length;
  return hits / t.length >= 0.8;
}
const QUOTE_RE = /[“"]([^”"]{25,400})[”"]/g;

// ── DATE ANCHOR ──────────────────────────────────────────────────────────────────────────────────
// An explicit calendar date ("October 25, 2025", "August 14") in body/FAQ/takeaways must have its
// month+day pair present in the bundle. The writer may only use dates the source actually gave.
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
const DATE_RE = new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi");
export function datesAnchored(text, bundleNorm) {
  for (const m of String(text || "").matchAll(DATE_RE)) {
    const mon = m[1].toLowerCase(), day = String(Number(m[2]));
    const re = new RegExp(`\\b${mon}\\b[^a-z0-9]{0,4}${day}\\b`);
    if (!re.test(bundleNorm)) return { mon, day };
  }
  return null;
}

const cutSentences = (text, shouldCut) =>
  String(text || "").split(/\n/).map((line) => {
    if (/^\s*(#{1,6}\s|\|)/.test(line)) return line;                    // headings/tables pass
    if (/^\s*[-*]\s/.test(line)) return shouldCut(line) ? null : line;  // a bad list bullet is dropped whole
    return line.split(SENT_RE).filter((s) => !shouldCut(s)).join(" ");
  }).filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");

// Apply both anchors to the article's reader-facing text. Returns { article, cuts:[…] } — cut-only,
// never invents; skips entirely when the bundle is too thin to be ground truth.
export function anchorGuards(article, bundleText) {
  const cuts = [];
  const bn = " " + norm(bundleText) + " ";
  if (bn.length < 400) return { article, cuts };
  const badQuote = (s) => {
    for (const m of String(s).matchAll(QUOTE_RE)) if (!quoteAnchored(m[1], bn)) { cuts.push(`quote:"${m[1].slice(0, 50)}…"`); return true; }
    return false;
  };
  const badDate = (s) => {
    const d = datesAnchored(s, bn);
    if (d) cuts.push(`date:${d.mon}-${d.day}`);
    return !!d;
  };
  const out = { ...article };
  out.body = cutSentences(article.body, (s) => badQuote(s) || badDate(s));
  if (Array.isArray(article.keyTakeaways)) out.keyTakeaways = article.keyTakeaways.filter((b) => !badQuote(b) && !badDate(b));
  if (Array.isArray(article.faq)) out.faq = article.faq
    .map((f) => (f && f.a && (badQuote(f.a) || badDate(f.a)) ? { ...f, a: f.a.split(SENT_RE).filter((s) => !badQuote(s) && !badDate(s)).join(" ").trim() } : f))
    .filter((f) => f && f.q && f.a && f.a.length > 20);
  if (article.pullQuote?.text && !quoteAnchored(article.pullQuote.text, bn)) { out.pullQuote = undefined; cuts.push("pullQuote"); }
  return { article: out, cuts };
}

// ── SOURCES HYGIENE ─────────────────────────────────────────────────────────────────────────────
// The "## Sources" section may contain ONLY real external links. The 2026-07-17 audit found internal
// links wearing outlet names ("[Billboard](/music/clave-…)") — fabricated attribution. Internal or
// linkless bullets are dropped; an emptied section is removed.
export function cleanSourcesSection(body) {
  const parts = String(body || "").split(/\n(?=## Sources\b)/);
  if (parts.length < 2) return body;
  const [head, ...rest] = parts;
  const section = rest.join("\n");
  const lines = section.split("\n");
  const kept = [lines[0]]; // the "## Sources" heading
  for (const l of lines.slice(1)) {
    if (!/^\s*[-*]\s/.test(l)) { if (l.trim() === "") continue; kept.push(l); continue; } // prose after section ends
    if (/\]\(https?:\/\/[^)]{8,}\)/.test(l) && !/\]\(https?:\/\/(www\.)?(instagram|twitter|x)\.com\/?\)/i.test(l)) kept.push(l);
  }
  const bullets = kept.filter((l) => /^\s*[-*]\s/.test(l)).length;
  return bullets ? head + "\n" + kept.join("\n") : head.replace(/\s+$/, "") + "\n";
}

// ── PLACEHOLDER-URL SANITIZER ───────────────────────────────────────────────────────────────────
// A cited url that is just a bare homepage ("https://www.instagram.com/") is a placeholder, not a
// source — drop the field (recursively, any key named url/link/sourceUrl/href).
const BARE_URL = /^https?:\/\/[^/]+\/?$/i;
export function sanitizeBareUrls(v) {
  if (Array.isArray(v)) return v.map(sanitizeBareUrls);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (/^(url|link|sourceUrl|href)$/i.test(k) && typeof x === "string" && BARE_URL.test(x.trim())) continue;
      out[k] = sanitizeBareUrls(x);
    }
    return out;
  }
  return v;
}
