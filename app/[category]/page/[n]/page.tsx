import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ArticleCard from "@/components/ArticleCard";
import AdSlot from "@/components/AdSlot";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  ArchiveMasthead,
  RiverItem,
  RiverPagination,
  ARCHIVE_LEAD_COUNT,
  RIVER_PAGE_SIZE,
} from "@/components/ArchiveRiver";
import { CATEGORIES, getCategory, getSubcategoriesForCategory } from "@/lib/site";
import { getAllArticles, getArticlesByCategory } from "@/lib/articles";

export const dynamicParams = false;

// Older pages of a category archive: /movies/page/2/ … (page 1 is /movies/).
// Static pagination keeps archives crawlable at 100+ stories/day.
function pageCountFor(category: string): number {
  const total = getArticlesByCategory(category).length;
  return (
    1 +
    Math.max(
      0,
      Math.ceil((total - ARCHIVE_LEAD_COUNT - RIVER_PAGE_SIZE) / RIVER_PAGE_SIZE)
    )
  );
}

export function generateStaticParams() {
  return CATEGORIES.flatMap((c) => {
    const pages = pageCountFor(c.slug);
    return Array.from({ length: Math.max(0, pages - 1) }, (_, i) => ({
      category: c.slug,
      n: String(i + 2),
    }));
  });
}

export function generateMetadata({
  params,
}: {
  params: { category: string; n: string };
}): Metadata {
  const cat = getCategory(params.category);
  if (!cat) return {};
  return {
    title: `${cat.name} News — Page ${params.n}`,
    description: cat.blurb,
    alternates: { canonical: `/${cat.slug}/page/${params.n}/` },
  };
}

export default function CategoryArchivePage({
  params,
}: {
  params: { category: string; n: string };
}) {
  const cat = getCategory(params.category);
  const page = Number(params.n);
  if (!cat || !Number.isInteger(page) || page < 2) notFound();

  const articles = getArticlesByCategory(cat.slug);
  const totalPages = pageCountFor(cat.slug);
  if (page > totalPages) notFound();

  const start = ARCHIVE_LEAD_COUNT + (page - 2 + 1) * RIVER_PAGE_SIZE;
  const river = articles.slice(start, start + RIVER_PAGE_SIZE);
  const subs = getSubcategoriesForCategory(cat.slug);
  const mustReads = getAllArticles()
    .filter((a) => a.category !== cat.slug)
    .slice(0, 4);

  return (
    <div className="container-wide py-8">
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { href: `/${cat.slug}/`, label: cat.name },
        ]}
      />
      <ArchiveMasthead
        kicker="The Screen Report"
        title={cat.name}
        subnav={subs.map((s) => ({ name: s.name, href: `/${cat.slug}/${s.slug}/` }))}
      />

      <div className="my-6 flex justify-center">
        <AdSlot format="leaderboard" className="hidden md:flex" />
        <AdSlot format="rectangle" className="md:hidden" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section>
          <div className="mb-2 flex items-baseline justify-between border-b-2 border-ink pb-2">
            <h2 className="sect-head text-2xl lg:text-2xl">Latest {cat.name}</h2>
            <span className="meta-mono">Page {page}</span>
          </div>
          <div className="pt-6">
            {river.map((a) => (
              <RiverItem key={a.slug} article={a} />
            ))}
          </div>
          <RiverPagination
            basePath={`/${cat.slug}`}
            page={page}
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
    </div>
  );
}
