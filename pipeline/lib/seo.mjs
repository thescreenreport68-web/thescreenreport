// SEO title/description/keyword helpers for the publishing pipelines. The reader-facing `title` is
// NEVER shortened — these only shape the stored metaTitle/metaDescription/targetKeyword frontmatter
// (which the site's <head>/OG/JSON-LD read). metaTitle rule (owner): ≤55 chars, no brand suffix,
// START with the celebrity's NAME (highest search-volume term) then the hook.
// 🔁 MUST stay in sync with lib/site.ts (seoTitle / clampMeta / seoKeywords), the render-time mirror
//    that is the source of truth for what actually ships. A test guards this file: pipeline/gossip/test/seo-title-test.mjs

const BRAND_SUFFIX_RE = /\s*[—|–-]\s*(?:The Screen Report|Screen Report)\s*$/i;
const FILLER_LEAD_RE =
  /^(?:inside|meet|watch|see|look|exclusive|report|revealed|pics?|photos?|video|why|how|what|when|where|the truth about|is|are|did|does)\b[:\s]+/i;

function leadNameOf(base, { primaryEntity = "", tags = [], about = [] } = {}) {
  // 0) the pipeline usually KNOWS the subject (topic.primaryEntity) — prefer it when it's in the title
  if (primaryEntity && base.toLowerCase().includes(String(primaryEntity).toLowerCase())) return primaryEntity;
  // 1) a Person named in `about` present in the title
  const person = (about || []).find(
    (e) => e && e.name && (e.type === "Person" || !e.type) && base.toLowerCase().includes(e.name.toLowerCase())
  );
  if (person) return person.name;
  // 2) the first multi-word proper-name tag present in the title
  const nameTag = (tags || []).find((t) => /^[A-Z][a-zà-ÿ]/u.test(t) && /\s/.test(t) && base.includes(t));
  if (nameTag) return nameTag;
  // 3) a name-like span (2+ capitalized words) from the title itself
  const m = base.match(/[A-ZÀ-Þ][a-zà-ÿA-Z.'’-]+(?:\s+[A-ZÀ-Þ][a-zà-ÿA-Z.'’-]+)+/u);
  return m ? m[0] : "";
}

const FUNCTION_WORDS = new Set(
  "a an the of to in on at for with and or amid after before while when as about into over from by per via vs is are was were his her their its that who whom whose & de la le da".split(" ")
);
const endsFunc = (s) => {
  const w = String(s).toLowerCase().replace(/[^a-z0-9'’&]+$/u, "").split(/\s+/).pop() || "";
  return FUNCTION_WORDS.has(w);
};
const cleanEnds = (s) => String(s || "").replace(/^[\s—–\-|:,]+/u, "").replace(/[\s—–\-|:,]+$/u, "").trim();

// Choose the best SEO title: land in [SEO_MIN,SEO_MAX] chars, prefer a content-word ending, prefer
// the "&" compression, never reorder (leading NAME stays first). MIN=45 floor, MAX=55 ceiling.
const SEO_MIN = 45;
const SEO_MAX = 55;
function bestTitle(base) {
  const start = cleanEnds(base);
  if (!start) return "";
  const variants = [{ s: start, comp: false }];
  const compressed = cleanEnds(start.replace(/ and /g, " & "));
  if (compressed !== start) variants.push({ s: compressed, comp: true });

  let best = "", bestScore = -1;
  for (const { s, comp } of variants) {
    let acc = "";
    for (const w of s.split(/\s+/)) {
      acc = acc ? `${acc} ${w}` : w;
      if (acc.length > SEO_MAX) break;
      const cand = cleanEnds(acc);
      const L = cand.length;
      if (!L) continue;
      const score = (L >= SEO_MIN ? 1000 : 0) + (endsFunc(cand) ? 0 : 300) + L + (comp ? 3 : 0);
      if (score > bestScore) { bestScore = score; best = cand; }
    }
  }
  return best || cleanEnds(start.slice(0, SEO_MAX));
}

/** Name-first, 45–55-char, brand-free SEO title derived from the full title. */
export function seoMetaTitle({ title, metaTitle, primaryEntity = "", tags = [], about = [] } = {}) {
  const full = String(title || "").trim();
  if (!full) return "";
  let base =
    metaTitle && metaTitle !== full && metaTitle.length <= SEO_MAX && metaTitle.length >= SEO_MIN ? metaTitle : full;
  base = base.replace(BRAND_SUFFIX_RE, "").trim();

  const lead = leadNameOf(base, { primaryEntity, tags, about });
  if (lead) {
    const idx = base.toLowerCase().indexOf(lead.toLowerCase());
    const before = base.slice(0, idx);
    // Reslice to the NAME only past a recognized filler lead-in, never a meaningful clause or a pair's 2nd name.
    const secondOfPair = /(?:\band\b|&|,|\bwith\b)\s*$/i.test(before);
    // both guards: prefix SHORT (≤16, just a lead-in) AND a recognized filler — a 40-char clause that
    // merely starts with "What"/"How" stays.
    if (idx > 0 && !secondOfPair && before.length <= 16 && FILLER_LEAD_RE.test(before)) base = base.slice(idx).trim();
  } else {
    base = base.replace(FILLER_LEAD_RE, "").trim();
  }
  base = base.replace(/^[\s—–\-|:,]+/u, "").trim();
  let out = bestTitle(base);
  if (!out) out = bestTitle(full.replace(BRAND_SUFFIX_RE, ""));
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Meta description clamped to ≤160 chars at a word boundary. */
export function clampDesc(s, max = 160) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  if (sp > 40) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:—–-]+$/u, "").trim() + "…";
}

/** The single strongest search phrase for the article (stored as targetKeyword). */
export function targetKeywordFor({ primaryEntity = "", tags = [] } = {}) {
  const pe = String(primaryEntity || "").trim();
  if (pe) return pe;
  const t = (tags || []).map((x) => String(x || "").trim()).filter(Boolean);
  return t[0] || "";
}
