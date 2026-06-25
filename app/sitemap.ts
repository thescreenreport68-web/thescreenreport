import type { MetadataRoute } from "next";
import { getAllArticles } from "@/lib/articles";
import { CATEGORIES, AUTHORS, SITE } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE.url;
  const now = new Date();

  const staticPages = [
    "",
    "about",
    "editorial-standards",
    "corrections",
    "ethics",
    "contact",
    "privacy",
    "dmca",
  ].map((p) => ({ url: `${base}/${p ? p + "/" : ""}`, lastModified: now }));

  const cats = CATEGORIES.map((c) => ({
    url: `${base}/${c.slug}/`,
    lastModified: now,
  }));

  const authors = AUTHORS.map((a) => ({
    url: `${base}/author/${a.slug}/`,
    lastModified: now,
  }));

  const articles = getAllArticles().map((a) => ({
    url: `${base}/${a.category}/${a.slug}/`,
    lastModified: new Date(a.updated ?? a.date),
  }));

  return [...staticPages, ...cats, ...authors, ...articles];
}
