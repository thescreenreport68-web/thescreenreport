import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ArticleCard from "@/components/ArticleCard";
import AdSlot from "@/components/AdSlot";
import JsonLd from "@/components/JsonLd";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  ArchiveMasthead,
  RiverItem,
  RiverPagination,
  ARCHIVE_LEAD_COUNT,
  RIVER_PAGE_SIZE,
} from "@/components/ArchiveRiver";
import {
  CATEGORIES,
  getCategory,
  getSubcategoriesForCategory,
  SITE,
} from "@/lib/site";
import { getAllArticles, getArticlesByCategory } from "@/lib/articles";

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

  const lead = articles[0];
  const secondRow = articles.slice(1, ARCHIVE_LEAD_COUNT);
  const river = articles.slice(
    ARCHIVE_LEAD_COUNT,
    ARCHIVE_LEAD_COUNT + RIVER_PAGE_SIZE
  );
  const totalPages =
    1 +
    Math.max(
      0,
      Math.ceil(
        (articles.length - ARCHIVE_LEAD_COUNT - RIVER_PAGE_SIZE) /
          RIVER_PAGE_SIZE
      )
    );
  const mustReads = getAllArticles()
    .filter((a) => a.category !== cat.slug)
    .slice(0, 4);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${cat.name} — ${SITE.name}`,
    url: `${SITE.url}/${cat.slug}/`,
    isPartOf: { "@type": "WebSite", name: SITE.name, url: SITE.url },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: articles.slice(0, 30).map((a, i) => ({
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
      <ArchiveMasthead
        kicker="The Screen Report"
        title={cat.name}
        blurb={cat.blurb}
        subnav={subs.map((s) => ({ name: s.name, href: `/${cat.slug}/${s.slug}/` }))}
      />

      <div className="my-6 flex justify-center">
        <AdSlot format="leaderboard" className="hidden md:flex" />
        <AdSlot format="rectangle" className="md:hidden" />
      </div>

      {articles.length ? (
        <>
          {/* Lead package: newest story large + a stacked trio */}
          <section className="grid gap-x-8 gap-y-8 lg:grid-cols-2">
            {lead ? <ArticleCard article={lead} variant="hero" /> : null}
            {secondRow.length ? (
              <div className="lg:border-l lg:border-hair lg:pl-8">
                {secondRow.map((a) => (
                  <ArticleCard key={a.slug} article={a} variant="list" />
                ))}
              </div>
            ) : null}
          </section>

          {/* River + rail */}
          <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section>
              <div className="mb-2 border-b-2 border-ink pb-2">
                <h2 className="sect-head text-2xl lg:text-2xl">
                  Latest {cat.name}
                </h2>
              </div>
              <div className="pt-6">
                {river.map((a) => (
                  <RiverItem key={a.slug} article={a} />
                ))}
              </div>
              <RiverPagination
                basePath={`/${cat.slug}`}
                page={1}
                totalPages={totalPages}
              />
            </section>
            <aside className="hidden lg:block">
              <div className="space-y-7">
                <AdSlot format="halfpage" />
                <div className="border-t-2 border-ink">
                  <div className="border-b border-hair pb-2 pt-2.5">
                    <h2 className="sect-head text-2xl lg:text-2xl">Must Reads</h2>
                  </div>
                  <div>
                    {mustReads.map((a) => (
                      <ArticleCard key={a.slug} article={a} variant="list" />
                    ))}
                  </div>
                </div>
                <div className="sticky top-[76px]">
                  <AdSlot format="halfpage" />
                </div>
              </div>
            </aside>
          </div>
        </>
      ) : (
        <p className="dek py-16 text-center">
          More {cat.name} coverage is on the way.
        </p>
      )}
    </div>
  );
}
