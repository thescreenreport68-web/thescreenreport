// GOSSIP — QUALITY GATE (Stage 6b). A LEAN readability/quality check that runs ALONGSIDE the legal gate, so a
// legally-safe piece is still a real, tight article (not thin, padded, or AI-slop). Deliberately light — gossip
// is short-form; the heavy news rubric would wrongly block it. Returns { pass, issues[] }.

const BANNED = /\b(delve|tapestry|testament|underscore|in the world of|at the end of the day|needless to say|buckle up|it'?s worth noting)\b/gi;

// ── RECOVERY-MODE SUBSTANCE GATE (owner-approved 2026-07-24, Option A) ────────────────────────────
// Google crawl-parked the site on 2026-07-15 after a churn wave. While it decides whether to trust us
// again, a thin single-source piece costs more than it earns. So we JUDGE THE FINISHED ARTICLE and
// refuse to publish it if it is thin — we do NOT hand the writer a word target.
//
// 🔴 WHY IT IS SHAPED THIS WAY (owner rule, locked): a floor given to the WRITER is a fabrication
// forcing-function — demanding more words than the sources support is exactly what makes it pad and
// invent (news lane D1). The writer's target still derives ONLY from how much verified material the
// bundle holds. This gate never speaks to the writer; it is a publish/no-publish verdict at the end.
//
// Consequence the owner accepted explicitly: this REDUCES output. Plenty of real gossip breaks with a
// single outlet, and those are now held. Fewer, more substantial pieces is the intended trade.
export const SUBSTANCE_MIN_WORDS = Number(process.env.GOSSIP_MIN_WORDS ?? 250);

export function substanceCheck(article, bundle, { minWords = SUBSTANCE_MIN_WORDS } = {}) {
  const body = String(article?.body || "");
  const words = body.replace(/[#*_>`\[\]()]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  const reasons = [];

  if (words < minWords) reasons.push(`${words}w < ${minWords}w substance floor`);

  // "Single-source" means one distinct OUTLET actually reported it — corroborating outlets count even
  // when we never extracted their body, because that is still independent confirmation.
  const seed = (bundle?.sources || []).filter((x) => x && !x.corroborating);
  const outlets = new Set([
    ...seed.map((x) => String(x.outlet || "").trim().toLowerCase()).filter(Boolean),
    ...(bundle?.corroboratingOutlets || []).map((x) => String(x?.outlet || x?.domain || "").trim().toLowerCase()).filter(Boolean),
  ]);
  if (outlets.size < 2) reasons.push(`single-source (${outlets.size} outlet)`);

  // Real substance = at least one verbatim quote OR a concrete number/date the reader can anchor on.
  const hasQuote = /["\u201C][^"\u201D\n]{15,}["\u201D]/.test(body);
  const hasSpecific = /\b(19|20)\d{2}\b|\$\s?\d|\b\d{1,3}(,\d{3})+\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/.test(body);
  if (!hasQuote && !hasSpecific) reasons.push("no verbatim quote and no concrete date/number");

  return { pass: reasons.length === 0, reasons, words, outlets: outlets.size, hasQuote, hasSpecific };
}

export function qualityCheck(article) {
  const issues = [];
  const body = article.body || "";
  const words = body.replace(/[#*_>`\[\]()]/g, " ").trim().split(/\s+/).filter(Boolean).length;

  if (!article.title || article.title.length < 15) issues.push("title missing or too short (<15 chars)");
  // Threshold matches the writer's bundle-derived word target (wordRangeFor) — a fixed floor past the
  // verified material forces fabrication (the news lane's D1 lesson; final fixed-target removed 2026-07-18).
  if (words < 170) issues.push(`body ${words}w too thin — develop the story using MORE of the bundle's verified specifics (never pad)`);
  if (words > 750) issues.push(`body ${words}w > 750 (gossip should stay tight)`);
  // TRUNCATED write: an unclosed markdown bold (odd ** count, e.g. a cut-off "**What We Know vs.") OR a body that
  // ends without terminal punctuation — a cut-off generation. "truncated" triggers a full regenerate in run.mjs.
  const openBold = (body.match(/\*\*/g) || []).length % 2 !== 0;
  const openQuote = (body.match(/"/g) || []).length % 2 !== 0; // an UNCLOSED straight quote = an orphan quote fragment
  const tail = body.replace(/[#*_>`~\s]+$/g, "");
  if (openBold || openQuote || (tail.length > 60 && !/[.!?"'”’)\]]$/.test(tail))) issues.push("body appears TRUNCATED — it ends mid-sentence or has an unclosed quote; regenerate the complete article");
  if (words > 120 && !/\n\s*\n/.test(body)) issues.push("one undivided block of text (needs paragraph breaks)");
  const banned = (body.match(BANNED) || []).length;
  if (banned >= 3) issues.push(`${banned} generic AI-tell phrases (delve/tapestry/…) — rewrite naturally`);
  if (!article.dek || article.dek.length < 10) issues.push("missing dek/standfirst");

  return { pass: issues.length === 0, issues, words };
}
