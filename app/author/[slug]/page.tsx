import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ArticleCard from "@/components/ArticleCard";
import { AUTHORS, getAuthor } from "@/lib/site";
import { getArticlesByAuthor } from "@/lib/articles";

export const dynamicParams = false;

export function generateStaticParams() {
  return AUTHORS.map((a) => ({ slug: a.slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const a = getAuthor(params.slug);
  if (!a) return {};
  return { title: `${a.name}, ${a.role}`, description: a.bio };
}

export default function AuthorPage({ params }: { params: { slug: string } }) {
  const a = getAuthor(params.slug);
  if (!a) notFound();
  const articles = getArticlesByAuthor(a.slug);
  const initials = a.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  return (
    <div className="container-wide py-10">
      <header className="flex items-center gap-5 border-b border-navy/10 pb-8">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-navy font-serif text-2xl font-bold text-white">
          {initials}
        </span>
        <div>
          <h1 className="font-serif text-3xl font-bold text-navy">{a.name}</h1>
          <div className="text-sm font-semibold uppercase tracking-wide text-gold-600">
            {a.role}
          </div>
          <p className="mt-2 max-w-2xl text-navy/70">{a.bio}</p>
        </div>
      </header>

      <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((art) => (
          <ArticleCard key={art.slug} article={art} variant="standard" />
        ))}
      </div>
    </div>
  );
}
