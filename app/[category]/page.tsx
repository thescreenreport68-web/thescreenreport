import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import AdSlot from "@/components/AdSlot";
import JsonLd from "@/components/JsonLd";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  CATEGORIES,
  getCategory,
  getSubcategoriesForCategory,
  SITE,
} from "@/lib/site";
import { getArticlesByCategory } from "@/lib/articles";

export const dynamicParams = false;

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.slug }));
}

export function generateMetadata({
  params,
}: {
  params: { category: string };
}): Metadata {
  const cat = getCategory(params.category);
  if (!cat) return {};
  return {
    title: `${cat.name} News`,
    description: cat.blurb,
    alternates: { canonical: `/${cat.slug}/` },
  };
}

export default function CategoryPage({
  params,
}: {
  params: { category: string };
}) {
  const cat = getCategory(params.category);
  if (!cat) notFound();
  const articles = getArticlesByCategory(cat.slug);
  const subs = getSubcategoriesForCategory(cat.slug);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${cat.name} — ${SITE.name}`,
    url: `${SITE.url}/${cat.slug}/`,
    isPartOf: { "@type": "WebSite", name: SITE.name, url: SITE.url },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: articles.map((a, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE.url}/${a.category}/${a.slug}/`,
        name: a.title,
      })),
    },
  };

  return (
    <div className="container-wide py-8">
      <JsonLd data={jsonLd} />
      <Breadcrumbs items={[{ href: "/", label: "Home" }]} />
      <header className="mt-1 border-b-2 border-navy pb-4">
        <span className="kicker">The Screen Report</span>
        <h1 className="mt-1 font-display text-4xl font-bold uppercase tracking-tight text-navy sm:text-5xl">
          {cat.name}
        </h1>
        <p className="mt-2 max-w-2xl dek">{cat.blurb}</p>
        {subs.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {subs.map((s) => (
              <Link
                key={s.slug}
                href={`/${cat.slug}/${s.slug}/`}
                className="border border-hair px-3 py-1.5 font-sans text-[11px] font-bold uppercase tracking-[0.08em] text-navy hover:border-breaking hover:text-breaking"
              >
                {s.name}
              </Link>
            ))}
          </div>
        ) : null}
      </header>

      <div className="my-6 flex justify-center">
        <AdSlot format="leaderboard" className="hidden md:flex" />
        <AdSlot format="rectangle" className="md:hidden" />
      </div>

      {articles.length ? (
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-slate">
          More {cat.name} coverage is on the way.
        </p>
      )}
    </div>
  );
}
