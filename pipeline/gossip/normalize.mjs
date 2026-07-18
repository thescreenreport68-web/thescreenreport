// GOSSIP — ENTITY/TEXT NORMALIZATION (2026-07-18 audit fix A). One canonical fold used by every slug,
// dedup key, and entity comparison in the lane. The old per-file `replace(/[^a-z0-9]+/g,"-")` turned
// "Beyoncé" into "beyonc", "Marcello Hernández" into "marcello-hern-ndez" and "husband's" into
// "husband-s" — which shipped misspelled public URLs, split the SAME person into different dedup
// buckets (two Hernández-at-the-ESPYs articles 4h apart were never compared), let accent variants
// evade the entity-day cap, and made internal links unable to match. Fix FORWARD only: published
// URLs are never renamed.

// Transliterate to plain ASCII: NFKD decomposition strips accents; ligatures and a few specials mapped.
const SPECIALS = { "ß": "ss", "æ": "ae", "Æ": "AE", "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "þ": "th", "Þ": "TH", "ł": "l", "Ł": "L", "œ": "oe", "Œ": "OE" };

export function foldText(s) {
  return String(s || "")
    .replace(/[ßæÆøØđĐþÞłŁœŒ]/g, (c) => SPECIALS[c] || c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")   // combining marks (the accents)
    .replace(/[’'`´‘]/g, "");           // apostrophes vanish (husband's → husbands), never become dashes
}

// Canonical slug: fold FIRST, then dash the leftovers.
export function slugify(s, max = 75) {
  return foldText(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

// Canonical entity key for comparisons: folded, lowercased, single-spaced.
export function entityKey(s) {
  return foldText(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Do two entity name lists share a person? (both sides folded — "Hernández" matches "Hernandez")
export function shareEntityFold(a = [], b = []) {
  const bk = b.map(entityKey).filter(Boolean);
  return a.map(entityKey).filter(Boolean).some((e) => bk.includes(e));
}
