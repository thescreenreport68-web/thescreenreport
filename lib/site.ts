export const SITE = {
  name: "The Screen Report",
  shortName: "Screen Report",
  tagline: "Hollywood, decoded.",
  description:
    "The Screen Report covers Hollywood and English-language movies, TV and celebrity culture — fast, accurate, and ahead of the story.",
  url: "https://thescreenreport.com",
  locale: "en_US",
  twitter: "@thescreenreport",
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

export const NAV = CATEGORIES.filter((c) =>
  ["movies", "tv", "streaming", "celebrity"].includes(c.slug)
);
