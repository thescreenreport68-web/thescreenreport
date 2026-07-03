import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  ArchiveMasthead,
  RiverItem,
  RiverPagination,
  RIVER_PAGE_SIZE,
} from "@/components/ArchiveRiver";
import { CATEGORIES } from "@/lib/site";
import { getAllArticles } from "@/lib/articles";

export const metadata: Metadata = {
  title: "Latest News",
  description:
    "The latest Hollywood film, TV, streaming and celebrity news from The Screen Report — every story, newest first.",
  alternates: { canonical: "/news/" },
};

export default function NewsPage() {
  const articles = getAllArticles(); // already sorted newest-first
  const river = articles.slice(0, RIVER_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(articles.length / RIVER_PAGE_SIZE));

  return (
    <div className="container-wide py-8">
      <Breadcrumbs items={[{ href: "/", label: "Home" }]} />
      <ArchiveMasthead
        kicker="The Screen Report"
        title="Latest News"
        blurb="Every story, newest first — film, TV, streaming and celebrity."
        subnav={CATEGORIES.map((c) => ({ name: c.name, href: `/${c.slug}/` }))}
      />

      <div className="my-6 flex justify-center">
        <AdSlot format="leaderboard" className="hidden md:flex" />
        <AdSlot format="rectangle" className="md:hidden" />
      </div>

      <div className="mx-auto max-w-4xl">
        {river.map((a) => (
          <RiverItem key={a.slug} article={a} />
        ))}
        <RiverPagination basePath="/news" page={1} totalPages={totalPages} />
      </div>
    </div>
  );
}
