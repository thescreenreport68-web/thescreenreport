// SHARED SEO-title finisher (owner 2026-07-14) — inside + gossip route metaTitle through this so they
// match the news/boxoffice lanes' behavior exactly. The reader-facing display `title` is NEVER touched.
// RULE: metaTitle is a 45–55-character SEARCH title (owner: min 45, max 55 — never too short, never over),
// brand-free (the site <title> template adds the brand). Build from BOTH the model's metaTitle and the
// full headline, prefer whichever already lands in [45,55], else the longest available, then hard-cap 55
// at a word boundary. Never pads (won't invent text) — the min-45 is met by falling back to the headline.
export const stripBrand = (s) =>
  String(s || "").replace(/\s*[|—–\-]\s*The Screen Report\s*$/i, "").replace(/\s+/g, " ").trim();

const clampWords = (s, max) => {
  s = String(s || "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max), at = cut.lastIndexOf(" ");
  return (at > max * 0.4 ? cut.slice(0, at) : cut).replace(/[\s,;:–—\-]+$/, "");
};

// metaTitle from the model's metaTitle + the display title (fallback), targeting [min,max].
export const seoTitle = (metaTitle, title, { min = 45, max = 55 } = {}) => {
  const clampMax = (s) => { s = stripBrand(s); return s.length <= max ? s : clampWords(s.replace(/\s*\([^)]*\)\s*$/, "").trim() || s, max); };
  const mtModel = clampMax(metaTitle);
  const mtTitle = clampMax(stripBrand(title).replace(/\s*\(\d{4}\)\s*$/, "")); // headline, brand + trailing year stripped
  let out;
  if (mtModel.length >= min && mtModel.length <= max) out = mtModel;            // model nailed the range
  else if (mtTitle.length >= min && mtTitle.length <= max) out = mtTitle;       // else the headline (fixes a too-short model metaTitle, no invented text)
  else out = [mtModel, mtTitle].filter(Boolean).sort((a, b) => b.length - a.length)[0] || stripBrand(title); // else the longest (closest to the 45 floor)
  return out.length > max ? clampWords(out, max) : out;                          // final hard cap
};
