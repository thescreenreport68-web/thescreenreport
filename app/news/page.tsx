import type { Metadata } from "next";
import ArticleCard from "@/components/ArticleCard";
import AdSlot from "@/components/AdSlot";
import { getAllArticles } from "@/lib/articles";

export const metadata: Metadata = {
  title: "Latest News",
  description:
    "The latest Hollywood film, TV, streaming and celebrity news from The Screen Report — every story, newest first.",
  alternates: { canonical: "/news/" },
};

export default function NewsPage() {
  const articles = getAllArticles(); // already sorted newest-first

  return (
    <div className="container-wide py-8">
      <header className="border-b-2 border-navy pb-4">
        <span className="kicker">The Screen Report</span>
        <h1 className="mt-1 font-display text-4xl font-bold uppercase tracking-tight text-navy sm:text-5xl">
          Latest News
        </h1>
        <p className="mt-2 max-w-2xl dek">
          Every story, newest first — film, TV, streaming and celebrity.
        </p>
      </header>

      <div className="my-6 flex justify-center">
        <AdSlot format="leaderboard" className="hidden md:flex" />
        <AdSlot format="rectangle" className="md:hidden" />
      </div>

      <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((a) => (
          <ArticleCard key={a.slug} article={a} variant="standard" />
        ))}
      </div>
    </div>
  );
}
