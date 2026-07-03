// GOSSIP — SPECIFICS GUARD (deterministic). Owner rule: "names and numbers must not be misplaced." quoteGuard
// covers quotes; this covers the OTHER checkable specifics that were sailing through the fail-open LLM verify:
//   • NUMBERS — every significant number in the body ($ amount, %, a 4-digit year, a 3+-digit count) must appear
//     in the bundle. A number that isn't = an invented/misplaced figure (the wrong year, a made-up dollar amount).
//   • OUTLET ATTRIBUTION — when the body credits a KNOWN outlet ("according to Variety", "People reported"), that
//     outlet must actually be in the bundle. Catches "credited the wrong outlet" (a misplaced source name).
// Model-independent + deterministic: it flags the specifics for the writer to correct, every time.
import { OUTLET_TIER } from "./policy.mjs";

const strip = (h) => (h || "").replace(/<[^>]+>/g, " ");
const digitsOnly = (s) => String(s || "").replace(/[,\s]/g, "");

// The significant, invention-prone numbers (skip trivial 1-2 digit counts, which are usually structural/derivable).
export function extractNumbers(text) {
  const out = new Set();
  const t = strip(text);
  // $12 million / $26M / $2 billion → normalize to magnitude + a scale letter
  for (const m of t.matchAll(/\$\s?([\d.,]+)\s?(million|billion|thousand|m|bn|b|k)?\b/gi))
    out.add("$" + digitsOnly(m[1]).replace(/\.0+$/, "") + (m[2] ? m[2][0].toLowerCase() : ""));
  // percentages
  for (const m of t.matchAll(/([\d.,]+)\s?%/g)) out.add(digitsOnly(m[1]) + "%");
  // 4-digit years (a wrong year is the classic "misplaced number", e.g. Oct 2024 vs 2025)
  for (const m of t.matchAll(/\b(?:19|20)\d{2}\b/g)) out.add("y" + m[0]);
  // standalone 3+-digit counts (a made-up guest count / stat) — years already captured above
  for (const m of t.matchAll(/\b\d[\d,]{2,}\b/g)) { const d = digitsOnly(m[0]); if (!/^(?:19|20)\d{2}$/.test(d)) out.add(d); }
  return out;
}

// KNOWN outlets the article might (wrongly) credit. Compared against the bundle's outlets + text.
const KNOWN_OUTLETS = Object.keys(OUTLET_TIER);
function outletAttributions(body) {
  const t = strip(body);
  const named = new Set();
  // "according to X", "X reported/reports/reported that", "per X", "X confirmed", "told X". The trigger is
  // case-insensitive (may start a sentence) but the outlet NAME must be Capitalized — so we spell both cases of
  // the trigger explicitly rather than using /i (which would also lowercase the [A-Z] name class).
  for (const m of t.matchAll(/\b(?:[Aa]ccording to|[Pp]er|[Rr]eported by|[Tt]old|[Vv]ia)\s+([A-Z][A-Za-z!.' ]{2,24})/g)) named.add(m[1].trim().replace(/[.,]$/, ""));
  for (const m of t.matchAll(/\b([A-Z][A-Za-z!.' ]{2,24}?)\s+(?:reported|reports|confirmed|revealed|broke the news)/g)) named.add(m[1].trim());
  return [...named];
}

export function checkSpecifics(article, bundle) {
  const hay = strip((bundle?.sources || []).map((s) => s.text).join("  "));
  if (!hay.trim()) return { ok: true, badNumbers: [], badOutlets: [] };
  const bundleNums = extractNumbers(hay);
  const badNumbers = [...extractNumbers(article.body || "")].filter((n) => !bundleNums.has(n));

  // Outlet attribution: only judge KNOWN outlets (avoids flagging a celeb's name as an outlet). A known outlet is
  // "misplaced" if it's neither in the bundle's source outlets nor mentioned anywhere in the bundle text.
  const sourceOutlets = new Set((bundle?.sources || []).map((s) => (s.outlet || "").toLowerCase()).concat((bundle?.corroboratingOutlets || []).map((o) => (o.outlet || "").toLowerCase())));
  const hayLc = hay.toLowerCase();
  const badOutlets = outletAttributions(article.body || "")
    .filter((name) => KNOWN_OUTLETS.some((k) => k.toLowerCase() === name.toLowerCase())) // only known outlets
    .filter((name) => !sourceOutlets.has(name.toLowerCase()) && !hayLc.includes(name.toLowerCase()));

  return { ok: badNumbers.length === 0 && badOutlets.length === 0, badNumbers: [...new Set(badNumbers)], badOutlets: [...new Set(badOutlets)] };
}
