// GOSSIP — QUALITY GATE (Stage 6b). A LEAN readability/quality check that runs ALONGSIDE the legal gate, so a
// legally-safe piece is still a real, tight article (not thin, padded, or AI-slop). Deliberately light — gossip
// is short-form; the heavy news rubric would wrongly block it. Returns { pass, issues[] }.

const BANNED = /\b(delve|tapestry|testament|underscore|in the world of|at the end of the day|needless to say|buckle up|it'?s worth noting)\b/gi;

export function qualityCheck(article) {
  const issues = [];
  const body = article.body || "";
  const words = body.replace(/[#*_>`\[\]()]/g, " ").trim().split(/\s+/).filter(Boolean).length;

  if (!article.title || article.title.length < 15) issues.push("title missing or too short (<15 chars)");
  if (words < 280) issues.push(`body ${words}w too thin — expand to 450+ words with more verified specifics + context`);
  if (words > 750) issues.push(`body ${words}w > 750 (gossip should stay tight)`);
  if (words > 120 && !/\n\s*\n/.test(body)) issues.push("one undivided block of text (needs paragraph breaks)");
  const banned = (body.match(BANNED) || []).length;
  if (banned >= 3) issues.push(`${banned} generic AI-tell phrases (delve/tapestry/…) — rewrite naturally`);
  if (!article.dek || article.dek.length < 10) issues.push("missing dek/standfirst");

  return { pass: issues.length === 0, issues, words };
}
