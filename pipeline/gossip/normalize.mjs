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

// ── HTML ENTITY DECODING (2026-07-19) ──────────────────────────────────────────────────────────────
// `stripHtml` used to blank EVERY entity (`.replace(/&#?\w+;/g, " ")`), which silently destroyed source
// text before the writer ever saw it: "Rated R&amp;B" → "Rated R B", "Love &amp; Hip Hop" → "Love Hip
// Hop", "Beyonc&eacute;" → "Beyonc", and — worst — "I&rsquo;m" → "I m" and "&ldquo;…&rdquo;" → bare
// text, corrupting VERBATIM QUOTES at the source. The anchor system then reproduced the corruption
// faithfully. Decode properly instead.
const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D", sbquo: "\u201A", bdquo: "\u201E",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", bull: "\u2022", middot: "\u00B7", prime: "\u2032",
  deg: "\u00B0", trade: "\u2122", copy: "\u00A9", reg: "\u00AE", euro: "\u20AC", pound: "\u00A3", yen: "\u00A5",
  cent: "\u00A2", sect: "\u00A7", para: "\u00B6", dagger: "\u2020", laquo: "\u00AB", raquo: "\u00BB",
  aacute: "\u00E1", eacute: "\u00E9", iacute: "\u00ED", oacute: "\u00F3", uacute: "\u00FA", yacute: "\u00FD",
  Aacute: "\u00C1", Eacute: "\u00C9", Iacute: "\u00CD", Oacute: "\u00D3", Uacute: "\u00DA",
  agrave: "\u00E0", egrave: "\u00E8", igrave: "\u00EC", ograve: "\u00F2", ugrave: "\u00F9",
  Agrave: "\u00C0", Egrave: "\u00C8", Igrave: "\u00CC", Ograve: "\u00D2", Ugrave: "\u00D9",
  acirc: "\u00E2", ecirc: "\u00EA", icirc: "\u00EE", ocirc: "\u00F4", ucirc: "\u00FB",
  Acirc: "\u00C2", Ecirc: "\u00CA", Icirc: "\u00CE", Ocirc: "\u00D4", Ucirc: "\u00DB",
  auml: "\u00E4", euml: "\u00EB", iuml: "\u00EF", ouml: "\u00F6", uuml: "\u00FC", yuml: "\u00FF",
  Auml: "\u00C4", Euml: "\u00CB", Iuml: "\u00CF", Ouml: "\u00D6", Uuml: "\u00DC",
  atilde: "\u00E3", ntilde: "\u00F1", otilde: "\u00F5", Atilde: "\u00C3", Ntilde: "\u00D1", Otilde: "\u00D5",
  aring: "\u00E5", Aring: "\u00C5", aelig: "\u00E6", AElig: "\u00C6", ccedil: "\u00E7", Ccedil: "\u00C7",
  oslash: "\u00F8", Oslash: "\u00D8", szlig: "\u00DF", scaron: "\u0161", Scaron: "\u0160",
};
export function decodeEntities(s) {
  return String(s || "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return m;
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : m;
  });
}

// ── EVERGREEN / ROUNDUP SOURCE DETECTION (2026-07-19) ─────────────────────────────────────────────
// The worst article of the post-guard window (score 27) was written from a Us Weekly EVERGREEN page —
// "Jelly Roll's Family Guide: Meet His Two Children and Wife Bunnie Xo" — so a 2016 birth was published
// as a June 2026 event and the piece asserted "neither has commented" while the subject had discussed
// the settlement on her own podcast. A second article (68) was grounded on a "…more-top-stories"
// ROUNDUP page, whose thinness became a false "no further details" claim. Neither page type is a news
// report about the event; both must be refused as the PRIMARY grounding source for a news story.
const EVERGREEN_URL = /(family-guide|-guide[-/]|\/guide\/|meet-(his|her|their)-|everything-(you|we)-(need-to-)?know|everything-to-know|who-is-|complete-timeline|a-timeline|-timeline\/|relationship-timeline|dating-history|net-worth|best-\d|top-\d+-|\/list\/|listicle|photos?\/gallery|\/gallery\/|more-top-stories|top-stories|\/roundup|week-in-review|everything-that-happened)/i;
const EVERGREEN_TITLE = /^(a |the )?(complete |full |ultimate )?(guide|timeline|everything|who is|meet |inside the life|all about|a look back|the best|top \d+)/i;

/** Is this URL/title an evergreen explainer, listicle, gallery or multi-story roundup rather than a news report? */
export function isEvergreenSource({ url = "", title = "" } = {}) {
  if (EVERGREEN_URL.test(String(url))) return true;
  if (EVERGREEN_TITLE.test(String(title).trim())) return true;
  if (/:\s*(meet|everything|a guide|the guide)\b/i.test(String(title))) return true;
  return false;
}
