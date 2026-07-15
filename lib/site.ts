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
