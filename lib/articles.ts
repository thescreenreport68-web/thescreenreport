import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export type Faq = { q: string; a: string };

export type Article = {
  title: string;
  slug: string;
  category: string;
  subcategory?: string;
  author: string;
  date: string; // ISO
  updated?: string;
  dek: string;
  metaTitle: string;
  metaDescription: string;
  tags: string[];
  targetKeyword?: string;
  imageAlt: string;
  imageCredit: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  faq: Faq[];
  keyTakeaways?: string[];
  about?: { name: string; type?: string; sameAs?: string }[];
  featured?: boolean;
  readingTime: number; // minutes
  body: string; // markdown
  // ---- per-niche structured fields (drive the niche UI modules) ----
  formatTag?: string; // review | list | explainer | profile | guide | news | interview | trailer | reaction | box-office | awards
  verdict?: string; // reviews: one-line bottom-line
  rating?: { score: number; max: number; label?: string }; // reviews
  prosCons?: { pros: string[]; cons: string[] }; // reviews
  infoCard?: {
    director?: string;
    cast?: string[];
    runtime?: string;
    releaseYear?: string;
    rated?: string;
    genre?: string;
    whereToWatch?: string;
  }; // reviews / film pieces
  entries?: { rank: number; title: string; year?: string; blurb: string }[]; // rankings
  tldr?: string; // explainers: the short answer
  spoiler?: boolean; // explainers: show spoiler banner
  factPanel?: {
    born?: string;
    knownFor?: string[];
    activeYears?: string;
    nationality?: string;
  }; // profiles
  filmography?: { year?: string; title: string; role?: string; type?: string }[]; // profiles
  whereToWatch?: { title: string; platform: string; type?: string; year?: string }[]; // guides
  // ---- batch-2 embed niches (trailer / interview / reaction) ----
  youtubeId?: string; // trailers + interviews: the official YouTube video id (embedded, never re-hosted)
  releaseInfo?: string; // trailers: e.g. "In theaters November 21, 2025"
  keyMoments?: string[]; // trailers: our described beats from the footage
  sourceOutlet?: string; // interviews: the outlet that published the original interview
  sourceUrl?: string; // interviews: deep link to that original interview
  pullQuotes?: string[]; // interviews: short verbatim quotes (<=40 words each)
  tweetIds?: string[]; // reactions: curated public X post ids (embedded via react-tweet)
  instagramUrls?: string[]; // reactions: curated public IG permalinks (facade embed)
  consensus?: string; // reactions: our one-box synthesis of the overall reaction
  // ---- celebrity / short news ----
  newsType?: string; // birthday | relationship | red-carpet | controversy | general
  pullQuote?: { text: string; attribution?: string }; // the quote that triggered the story
  // ---- box office ----
  boxOffice?: {
    domestic?: string;
    international?: string;
    worldwide?: string;
    budget?: string;
    openingWeekend?: string;
    theaters?: string;
  };
  records?: { claim: string; detail?: string }[]; // box-office records/firsts
  // ---- awards ----
  awardsType?: string; // winners-list | snubs | predictions | recap
  awardShow?: {
    show?: string; // e.g. "96th Academy Awards"
    edition?: string;
    dateISO?: string;
    venue?: string;
    host?: string;
  };
  awardCategories?: {
    categoryName: string;
    nominees: { name: string; title?: string; isWinner?: boolean }[];
  }[];
  awardRecords?: { claim: string; detail?: string }[];
};

const CONTENT_DIR = path.join(process.cwd(), "content", "articles");

function readingTimeFor(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

let cache: Article[] | null = null;

export function getAllArticles(): Article[] {
  if (cache) return cache;
  if (!fs.existsSync(CONTENT_DIR)) {
    cache = [];
    return cache;
  }
  const files = fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".md") || f.endsWith(".mdx"));

  const articles: Article[] = files.map((file) => {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
    const { data, content } = matter(raw);
    const slug = (data.slug as string) || file.replace(/\.mdx?$/, "");
    return {
      title: data.title,
      slug,
      category: data.category,
      subcategory: data.subcategory,
      author: data.author,
      date: data.date,
      updated: data.updated,
      dek: data.dek ?? "",
      metaTitle: data.metaTitle ?? data.title,
      metaDescription: data.metaDescription ?? data.dek ?? "",
      tags: data.tags ?? [],
      targetKeyword: data.targetKeyword,
      imageAlt: data.imageAlt ?? data.title,
      imageCredit: data.imageCredit ?? "The Screen Report",
      image: data.image,
      imageWidth: data.imageWidth,
      imageHeight: data.imageHeight,
      faq: data.faq ?? [],
      keyTakeaways: data.keyTakeaways ?? [],
      about: data.about ?? [],
      featured: data.featured ?? false,
      readingTime: readingTimeFor(content),
      body: content,
      formatTag: data.formatTag,
      verdict: data.verdict,
      rating: data.rating,
      prosCons: data.prosCons,
      infoCard: data.infoCard,
      entries: data.entries ?? [],
      tldr: data.tldr,
      spoiler: data.spoiler ?? false,
      factPanel: data.factPanel,
      filmography: data.filmography ?? [],
      whereToWatch: data.whereToWatch ?? [],
      youtubeId: data.youtubeId,
      releaseInfo: data.releaseInfo,
      keyMoments: data.keyMoments ?? [],
      sourceOutlet: data.sourceOutlet,
      sourceUrl: data.sourceUrl,
      pullQuotes: data.pullQuotes ?? [],
      tweetIds: data.tweetIds ?? [],
      instagramUrls: data.instagramUrls ?? [],
      consensus: data.consensus,
      newsType: data.newsType,
      pullQuote: data.pullQuote,
      boxOffice: data.boxOffice,
      records: data.records ?? [],
      awardsType: data.awardsType,
      awardShow: data.awardShow,
      awardCategories: data.awardCategories ?? [],
      awardRecords: data.awardRecords ?? [],
    };
  });

  articles.sort((a, b) => (a.date < b.date ? 1 : -1));
  cache = articles;
  return articles;
}

export function getArticle(category: string, slug: string): Article | undefined {
  return getAllArticles().find(
    (a) => a.slug === slug && a.category === category
  );
}

export function getArticleBySlug(slug: string): Article | undefined {
  return getAllArticles().find((a) => a.slug === slug);
}

export function getArticlesByCategory(category: string): Article[] {
  return getAllArticles().filter((a) => a.category === category);
}

export function getArticlesBySubcategory(
  category: string,
  subcategory: string
): Article[] {
  return getAllArticles().filter(
    (a) => a.category === category && a.subcategory === subcategory
  );
}

export function getArticlesByAuthor(author: string): Article[] {
  return getAllArticles().filter((a) => a.author === author);
}

export function getFeatured(): Article | undefined {
  const all = getAllArticles();
  return all.find((a) => a.featured) ?? all[0];
}

export function getRelated(article: Article, limit = 4): Article[] {
  const all = getAllArticles().filter((a) => a.slug !== article.slug);
  const sameCat = all.filter((a) => a.category === article.category);
  const rest = all.filter((a) => a.category !== article.category);
  return [...sameCat, ...rest].slice(0, limit);
}
