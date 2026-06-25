import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ArticleCard from "@/components/ArticleCard";
import AdSlot from "@/components/AdSlot";
import { CATEGORIES, getCategory } from "@/lib/site";
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
  return { title: `${cat.name} News`, description: cat.blurb };
}

export default function CategoryPage({
  params,
}: {
  params: { category: string };
}) {
  const cat = getCategory(params.category);
  if (!cat) notFound();
  const articles = getArticlesByCategory(cat.slug);

  return (
    <div className="container-wide py-8">
      <header className="border-b-2 border-navy pb-4">
        <h1 className="font-serif text-4xl font-bold text-navy">{cat.name}</h1>
        <p className="mt-2 max-w-2xl text-navy/60">{cat.blurb}</p>
      </header>

      <div className="my-6 hidden md:block">
        <AdSlot format="leaderboard" />
      </div>

      {articles.length ? (
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-navy/50">
          More {cat.name} coverage is on the way.
        </p>
      )}
    </div>
  );
}
