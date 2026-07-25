// SHARED TEXT + DATE HELPERS — ONE definition each, for the whole lane.
//
// WHY THIS FILE EXISTS. The same four helpers were re-implemented across the lane: the LA-day formatter
// in 5 places, the sentence splitter across 4 files (9 uses), slugify across 4 files (9 uses), the word
// count in 4 places. That is not just duplication — it is the direct cause of this lane's most expensive
// bug class: two copies of one rule drifting apart. The word floor lived in both qa.mjs and assemble.mjs
// and disagreed by 53 words, holding good articles for months; the sentence splitter in one file split
// newlines while another did not, which made a figure-bearing heading uncuttable and shipped a phantom
// claim. A rule that exists once cannot disagree with itself.
//
// Every helper here is deterministic and dependency-free.

// ── LA day ────────────────────────────────────────────────────────────────────────────────────────
// The lane's editorial day is Los Angeles, because that is the day the box-office chart belongs to.
// Everything that buckets "today" — materiality, spend, attempts, failures, caches, audits — uses this.
export const laDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d instanceof Date ? d : new Date(d));

// ── slug ──────────────────────────────────────────────────────────────────────────────────────────
// 80-char cap with a clean break at the last hyphen (a mid-word cut reads broken and, when a slug is
// later parsed for a figure, silently loses the "-million" suffix a parser depends on).
export const slugify = (s, { max = 80 } = {}) => {
  const full = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (full.length <= max) return full;
  const cut = full.slice(0, max);
  return cut.includes("-") ? cut.replace(/-[^-]*$/, "") : cut;
};

// ── sentences ─────────────────────────────────────────────────────────────────────────────────────
// Split on newlines FIRST so a markdown heading is an atomic unit: a figure inside a heading must be
// cuttable on its own rather than glued to the following sentence (that exact bug shipped a phantom
// "## A Record-Shattering Run to $1 Billion" that no cut pass could remove). Abbreviations that end in
// a period are protected so "No. 1" / "U.S." / "Mr." do not fracture a sentence mid-clause.
const ABBR = /\b(?:No|Vol|Inc|Ltd|Co|Mr|Mrs|Ms|Dr|Jr|Sr|St|vs|etc|U\.S|U\.K)\.$/i;
export function splitSentences(text) {
  const out = [];
  for (const line of String(text || "").split(/\n+/)) {
    let buf = "";
    for (const piece of line.split(/(?<=[.!?])\s+/)) {
      buf = buf ? `${buf} ${piece}` : piece;
      if (ABBR.test(buf.trim())) continue; // an abbreviation is not a sentence end
      out.push(buf.trim());
      buf = "";
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.filter(Boolean);
}

// ── words ─────────────────────────────────────────────────────────────────────────────────────────
// The lane's ONE word count. Every floor (writer target, QA floor, assemble's final scaffold gate)
// must measure identically or they disagree about the same article — which is exactly what happened.
export const wordCount = (text) => String(text || "").split(/\s+/).filter(Boolean).length;
