export const SITE = {
  name: "The Screen Report",
  shortName: "Screen Report",
  tagline: "Hollywood, decoded.",
  description:
    "The Screen Report covers Hollywood and English-language movies, TV and celebrity culture — fast, accurate, and ahead of the story.",
  url: "https://thescreenreport.com",
  locale: "en_US",
  twitter: "@thescreenreport",
  // Publisher logo for Article / NewsMediaOrganization structured data — Google's
  // Top Stories eligibility wants a valid publisher.logo. This is a dedicated
  // structured-data asset (public/logo.png); the on-site wordmark stays NATIVE TYPE
  // per project rules — we are not replacing the UI logo with an image.
  logoPath: "/logo.png",
  logoWidth: 600,
  logoHeight: 60,
};

export type Category = {
  slug: string;
  name: string;
  blurb: string;
};

// Categories that have content and appear in the primary nav.
export const CATEGORIES: Category[] = [
  {
    slug: "movies",
    name: "Movies",
    blurb:
      "Reviews, rankings, explainers and the latest on every English-language film that matters.",
  },
  {
    slug: "tv",
    name: "TV",
    blurb: "What to watch, recaps and the shows everyone's talking about.",
  },
  {
    slug: "streaming",
    name: "Streaming",
    blurb:
      "Where to watch it, what's new, and the best of Netflix, Max, Prime and more.",
  },
  {
    slug: "celebrity",
    name: "Celebrity",
    blurb: "The stars, their work and the culture around Hollywood's biggest names.",
  },
  {
    slug: "reviews",
    name: "Reviews",
    blurb: "Verdicts you can trust on the latest releases.",
  },
  {
    slug: "awards",
    name: "Awards",
    blurb: "Oscars, Emmys, Globes and more — winners, predictions and the race.",
  },
  {
    slug: "music",
    name: "Music",
    blurb:
      "Pop stars, the Grammys, soundtracks and the artists Hollywood can't stop talking about.",
  },
];

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

export type Author = {
  slug: string;
  name: string;
  role: string;
  bio: string;
  // "Person" for a named human; "Organization" for the editorial team byline.
  type?: "Person" | "Organization";
  // Real external profiles for E-E-A-T sameAs. Never fabricate (the Sports Illustrated trap).
  sameAs?: string[];
};

export const AUTHORS: Author[] = [
  {
    // Real human editor for the celebrity + music desks (E-E-A-T). Bio is honest: AI-assisted
    // research with human editorial review; rumor/gossip stories are clearly labeled and
    // monitored. No fabricated profiles.
    slug: "alicia-bernard",
    name: "Alicia Bernard",
    role: "Editor, Celebrity & Music",
    bio: "Alicia Bernard is a freelance entertainment editor for The Screen Report's celebrity and music coverage. Stories are produced with AI-assisted research and reviewed editorially; rumor and speculation are clearly labeled as unconfirmed and updated or removed as facts develop.",
    type: "Person",
  },
  {
    slug: "editorial-team",
    name: "The Screen Report Editorial Team",
    role: "Newsroom",
    bio: "The Screen Report's editorial team covers Hollywood and English-language film, TV and celebrity news. Our editors write, fact-check and review every story; articles are produced with AI-assisted research and edited by a human before publishing.",
    type: "Organization",
    sameAs: ["https://twitter.com/thescreenreport"],
  },
];

export function getAuthor(slug: string): Author | undefined {
  return AUTHORS.find((a) => a.slug === slug);
}

export type Subcategory = { slug: string; name: string };

// Subcategories per category — each is populated by real articles (frontmatter `subcategory`).
export const SUBCATEGORIES: Record<string, Subcategory[]> = {
  movies: [
    { slug: "news", name: "Movie News" },
    { slug: "rankings-lists", name: "Rankings & Lists" },
    { slug: "explainers", name: "Explainers" },
    { slug: "trailers", name: "Trailers" },
    { slug: "reactions", name: "Reactions" },
    { slug: "box-office", name: "Box Office" },
  ],
  tv: [
    { slug: "news", name: "TV News" },
    { slug: "rankings-lists", name: "Rankings & Lists" },
    { slug: "trailers", name: "Trailers" },
    { slug: "reactions", name: "Reactions" },
  ],
  streaming: [
    { slug: "best-of-streaming", name: "Best of Streaming" },
    { slug: "where-to-watch", name: "Where to Watch" },
  ],
  celebrity: [
    { slug: "news", name: "Celebrity News" },
    { slug: "profiles-careers", name: "Profiles & Careers" },
    { slug: "interviews", name: "Interviews" },
  ],
  reviews: [
    { slug: "movie-reviews", name: "Movie Reviews" },
    { slug: "tv-reviews", name: "TV Reviews" },
  ],
  awards: [
    { slug: "winners", name: "Winners" },
    { slug: "predictions", name: "Predictions" },
  ],
  music: [
    { slug: "news", name: "Music News" },
    { slug: "awards", name: "Music Awards" },
    { slug: "profiles-artists", name: "Artist Profiles" },
    { slug: "screen-music", name: "Music & Screen" },
  ],
};

export function getSubcategoriesForCategory(category: string): Subcategory[] {
  return SUBCATEGORIES[category] ?? [];
}

export function getSubcategory(
  category: string,
  slug: string
): Subcategory | undefined {
  return (SUBCATEGORIES[category] ?? []).find((s) => s.slug === slug);
}

// Primary nav — every link resolves to a real page (category or subcategory archive).
export type NavItem = {
  label: string;
  href: string;
  subs: { name: string; href: string }[];
};

const subNav = (cat: string) =>
  getSubcategoriesForCategory(cat).map((s) => ({
    name: s.name,
    href: `/${cat}/${s.slug}/`,
  }));

export const NAV: NavItem[] = [
  {
    label: "News",
    href: "/news/",
    subs: [
      { name: "Film", href: "/movies/" },
      { name: "TV", href: "/tv/" },
      { name: "Streaming", href: "/streaming/" },
      { name: "Celebrity", href: "/celebrity/" },
    ],
  },
  { label: "Film", href: "/movies/", subs: subNav("movies") },
  { label: "TV", href: "/tv/", subs: subNav("tv") },
  { label: "Streaming", href: "/streaming/", subs: subNav("streaming") },
  { label: "Celebrity", href: "/celebrity/", subs: subNav("celebrity") },
  { label: "Reviews", href: "/reviews/", subs: subNav("reviews") },
  { label: "Awards", href: "/awards/", subs: subNav("awards") },
  { label: "Music", href: "/music/", subs: subNav("music") },
];

// ─────────────────────────────────────────────────────────────────────────────
// SEO helpers — applied at RENDER to EVERY article (all lanes, existing + future).
// The reader-facing `title` (the <h1> + JSON-LD headline) is NEVER shortened; these
// only shape the <title>/OG/Twitter tags, <meta name="keywords">, and JSON-LD.
// metaTitle rule (owner): 45–55 chars (45 is a firm floor — don't make it too small; 55 ceiling),
// no brand suffix, START with the celebrity's NAME (highest search-volume term) then the hook.
// Keep in sync with pipeline/lib/seo.mjs.

const BRAND_SUFFIX_RE = /\s*[—|–-]\s*(?:The Screen Report|Screen Report)\s*$/i;
// Headline lead-ins that aren't the subject — dropped so the NAME leads. Only used as a
// fallback when no proper name is detected (name-reslice handles the common case).
const FILLER_LEAD_RE =
  /^(?:inside|meet|watch|see|look|exclusive|report|revealed|pics?|photos?|video|why|how|what|when|where|the truth about|is|are|did|does)\b[:\s]+/i;

type SeoArticleLike = {
  title: string;
  metaTitle?: string;
  tags?: string[];
  about?: { name: string; type?: string }[];
};

function leadNameOf(base: string, article: SeoArticleLike): string {
  // 1) a Person named in `about` that appears in the title (inside/news lanes)
  const person = (article.about ?? []).find(
    (e) => e?.name && (e.type === "Person" || !e.type) && base.toLowerCase().includes(e.name.toLowerCase())
  );
  if (person) return person.name;
  // 2) the first tag that is a multi-word proper name present in the title (gossip: tags[0] = primaryEntity)
  const nameTag = (article.tags ?? []).find(
    (t) => /^[A-Z][a-zà-ÿ]/u.test(t) && /\s/.test(t) && base.includes(t)
  );
  if (nameTag) return nameTag;
  // 3) a name-like span (2+ capitalized words) from the title itself
  const m = base.match(/[A-ZÀ-Þ][a-zà-ÿA-Z.'’-]+(?:\s+[A-ZÀ-Þ][a-zà-ÿA-Z.'’-]+)+/u);
  return m ? m[0] : "";
}

// Function/connector words we don't want a title to END on (a cut clause shouldn't dangle on "Amid"/"of"/"&").
const FUNCTION_WORDS = new Set(
  "a an the of to in on at for with and or amid after before while when as about into over from by per via vs is are was were his her their its that who whom whose & de la le da".split(" ")
);
const endsFunc = (s: string): boolean => {
  const w = (s.toLowerCase().replace(/[^a-z0-9'’&]+$/u, "").split(/\s+/).pop() || "");
  return FUNCTION_WORDS.has(w);
};
const cleanEnds = (s: string): string =>
  s.replace(/^[\s—–\-|:,]+/u, "").replace(/[\s—–\-|:,]+$/u, "").trim();

// Choose the best SEO title from a name-first `base`: land in [MIN,MAX] chars, prefer a clean
// (content-word) ending, and prefer the "&" compression stylistically. Never reorders the words,
// so the leading NAME stays first. MIN=45 floor (owner: don't make it too small); MAX=55 ceiling.
const SEO_MIN = 45;
const SEO_MAX = 55;
function bestTitle(base: string): string {
  const start = cleanEnds(base);
  if (!start) return "";
  const variants: { s: string; comp: boolean }[] = [{ s: start, comp: false }];
  const compressed = cleanEnds(start.replace(/ and /g, " & "));
  if (compressed !== start) variants.push({ s: compressed, comp: true });

  let best = "";
  let bestScore = -1;
  for (const { s, comp } of variants) {
    const words = s.split(/\s+/);
    let acc = "";
    for (const w of words) {
      acc = acc ? `${acc} ${w}` : w;
      if (acc.length > SEO_MAX) break; // every longer prefix is also too long
      const cand = cleanEnds(acc);
      const L = cand.length;
      if (!L) continue;
      // in-band (≥MIN) dominates; then a content-word ending; then length; small nudge for "&".
      const score = (L >= SEO_MIN ? 1000 : 0) + (endsFunc(cand) ? 0 : 300) + L + (comp ? 3 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
  }
  // fallback (source shorter than MIN, or nothing scored): longest ≤MAX we can take
  return best || cleanEnds(start.slice(0, SEO_MAX));
}

/** Name-first, 45–55-char, brand-free SEO title. Never mutates the reader-facing `title`. */
export function seoTitle(article: SeoArticleLike): string {
  const title = (article.title ?? "").trim();
  if (!title) return SITE.name;
  // honor an already-good hand-written metaTitle; otherwise derive from the full title
  let base =
    article.metaTitle && article.metaTitle !== title && article.metaTitle.length <= SEO_MAX && article.metaTitle.length >= SEO_MIN
      ? article.metaTitle
      : title;
  base = base.replace(BRAND_SUFFIX_RE, "").trim();

  const lead = leadNameOf(base, article);
  if (lead) {
    const idx = base.toLowerCase().indexOf(lead.toLowerCase());
    const before = base.slice(0, idx);
    // Put the NAME first ONLY when the text before it is a recognized filler lead-in ("Inside"/"Why"/
    // "Here's Why"…) — never a meaningful clause ("The 30 Best", "Mira Sorvino Announces") and never
    // the 2nd name of a pair ("Justin and Hailey Bieber" keeps Justin).
    const secondOfPair = /(?:\band\b|&|,|\bwith\b)\s*$/i.test(before);
    // both guards: the prefix is SHORT (≤16, so it's just a lead-in) AND is a recognized filler —
    // "What Was Adam Sandler's Advice for …" starts with "What" but is a 40-char clause, so it stays.
    if (idx > 0 && !secondOfPair && before.length <= 16 && FILLER_LEAD_RE.test(before)) base = base.slice(idx).trim();
  } else {
    base = base.replace(FILLER_LEAD_RE, "").trim();
  }
  base = base.replace(/^[\s—–\-|:,]+/u, "").trim();
  let out = bestTitle(base); // handles and↔& + fits the 45–55 band, name stays first
  if (!out) out = bestTitle(title.replace(BRAND_SUFFIX_RE, ""));
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Meta description clamped to ≤160 chars at a word boundary (search engines truncate past that). */
export function clampMeta(s: string | undefined, max = 160): string {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  if (sp > 40) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:—–-]+$/u, "").trim() + "…";
}

/** De-duped keyword list for <meta name="keywords"> + JSON-LD (targetKeyword → tags → entities → category). */
export function seoKeywords(article: {
  tags?: string[];
  targetKeyword?: string;
  about?: { name: string }[];
  category?: string;
}): string[] {
  const catName = article.category ? getCategory(article.category)?.name : "";
  const raw = [
    article.targetKeyword ?? "",
    ...(article.tags ?? []),
    ...((article.about ?? []).map((e) => e?.name ?? "")),
    catName ?? "",
  ]
    .map((k) => String(k || "").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw) {
    const key = k.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(k);
    }
  }
  return out.slice(0, 12);
}
