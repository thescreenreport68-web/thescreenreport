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
  // Real external profiles (X, LinkedIn, Muck Rack, etc.) for Person-schema E-E-A-T.
  // Left empty until real profiles exist — never fabricate (the Sports Illustrated trap).
  sameAs?: string[];
};

export const AUTHORS: Author[] = [
  {
    slug: "jordan-hale",
    name: "Jordan Hale",
    role: "Senior Film Writer",
    bio: "Jordan Hale covers movies, directors and the awards race for The Screen Report, with a focus on how big films get made and why they connect.",
  },
  {
    slug: "maya-okafor",
    name: "Maya Okafor",
    role: "TV & Streaming Editor",
    bio: "Maya Okafor leads The Screen Report's television and streaming coverage, tracking what's worth your time across every major platform.",
  },
  {
    slug: "daniel-reyes",
    name: "Daniel Reyes",
    role: "Celebrity & Culture Writer",
    bio: "Daniel Reyes writes about Hollywood's biggest stars and the culture around them for The Screen Report.",
  },
];

export function getAuthor(slug: string): Author | undefined {
  return AUTHORS.find((a) => a.slug === slug);
}

export const NAV = CATEGORIES.filter((c) =>
  ["movies", "tv", "streaming", "celebrity"].includes(c.slug)
);
