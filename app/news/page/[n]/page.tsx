import { notFound } from "next/navigation";
import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  ArchiveMasthead,
  RiverItem,
  RiverAd,
  RIVER_AD_AFTER,
  RiverPagination,
  RIVER_PAGE_SIZE,
} from "@/components/ArchiveRiver";
import { CATEGORIES } from "@/lib/site";
import { getAllArticles } from "@/lib/articles";

export const dynamicParams = false;

function pageCount(): number {
  return Math.max(1, Math.ceil(getAllArticles().length / RIVER_PAGE_SIZE));
}

export function generateStaticParams() {
  return Array.from({ length: Math.max(0, pageCount() - 1) }, (_, i) => ({
    n: String(i + 2),
  }));
}

export function generateMetadata({
  params,
}: {
  params: { n: string };
}): Metadata {
  return {
    title: `Latest News — Page ${params.n}`,
    description:
      "The latest Hollywood film, TV, streaming and celebrity news from The Screen Report — every story, newest first.",
    alternates: { canonical: `/news/page/${params.n}/` },
  };
}

export default function NewsArchivePage({ params }: { params: { n: string } }) {
  const page = Number(params.n);
  const totalPages = pageCount();
  if (!Number.isInteger(page) || page < 2 || page > totalPages) notFound();

  const articles = getAllArticles();
  const river = articles.slice((page - 1) * RIVER_PAGE_SIZE, page * RIVER_PAGE_SIZE);

  return (
    <div className="container-wide py-8">
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { href: "/news/", label: "Latest News" },
        ]}
      />
      <ArchiveMasthead
        kicker="The Screen Report"
        title="Latest News"
        subnav={CATEGORIES.map((c) => ({ name: c.name, href: `/${c.slug}/` }))}
      />

      <div className="my-6 flex justify-center">
        <AdSlot format="leaderboard" className="hidden md:flex" />
        <AdSlot format="rectangle" className="md:hidden" />
      </div>

      <div className="mx-auto max-w-4xl">
        <div className="mb-2 flex items-baseline justify-between border-b-2 border-ink pb-2">
          <h2 className="sect-head text-2xl lg:text-2xl">All Stories</h2>
          <span className="meta-mono">Page {page}</span>
        </div>
        <div className="pt-6">
          {river.map((a, i) => (
            <div key={a.slug}>
              <RiverItem article={a} />
              {i === RIVER_AD_AFTER - 1 ? <RiverAd /> : null}
            </div>
          ))}
        </div>
        <RiverPagination basePath="/news" page={page} totalPages={totalPages} />
      </div>
    </div>
  );
}
