import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Breadcrumbs from "@/components/Breadcrumbs";
import Byline from "@/components/Byline";
import PlaceholderImage from "@/components/PlaceholderImage";
import ArticleBody from "@/components/ArticleBody";
import Faq from "@/components/Faq";
import AuthorBox from "@/components/AuthorBox";
import AdSlot from "@/components/AdSlot";
import ArticleCard from "@/components/ArticleCard";
import JsonLd from "@/components/JsonLd";
import { getAllArticles, getArticle, getRelated } from "@/lib/articles";
import { getAuthor, getCategory, SITE } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllArticles().map((a) => ({ category: a.category, slug: a.slug }));
}

export function generateMetadata({
  params,
}: {
  params: { category: string; slug: string };
}): Metadata {
  const article = getArticle(params.category, params.slug);
  if (!article) return {};
  return {
    title: article.metaTitle,
    description: article.metaDescription,
    alternates: { canonical: `/${article.category}/${article.slug}/` },
    openGraph: {
      title: article.metaTitle,
      description: article.metaDescription,
      type: "article",
      url: `/${article.category}/${article.slug}/`,
    },
  };
}

export default function ArticlePage({
  params,
}: {
  params: { category: string; slug: string };
}) {
  const article = getArticle(params.category, params.slug);
  if (!article) notFound();
  const cat = getCategory(article.category);
  const author = getAuthor(article.author);
  const related = getRelated(article, 4);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: article.title,
      description: article.metaDescription,
      datePublished: article.date,
      dateModified: article.updated ?? article.date,
      author: author
        ? {
            "@type": "Person",
            name: author.name,
            url: `${SITE.url}/author/${author.slug}/`,
          }
        : undefined,
      publisher: {
        "@type": "Organization",
        name: SITE.name,
        url: SITE.url,
      },
      mainEntityOfPage: `${SITE.url}/${article.category}/${article.slug}/`,
      articleSection: cat?.name,
      keywords: article.tags.join(", "),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE.url}/` },
        {
          "@type": "ListItem",
          position: 2,
          name: cat?.name,
          item: `${SITE.url}/${article.category}/`,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: article.title,
          item: `${SITE.url}/${article.category}/${article.slug}/`,
        },
      ],
    },
    article.faq?.length
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: article.faq.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }
      : null,
  ].filter(Boolean) as object[];

  return (
    <div className="container-wide py-6">
      <JsonLd data={jsonLd} />

      <div className="mb-6 hidden md:block">
        <AdSlot format="leaderboard" />
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <article className="min-w-0">
          <Breadcrumbs
            items={[
              { href: "/", label: "Home" },
              { href: `/${article.category}/`, label: cat?.name ?? "" },
              { label: article.title },
            ]}
          />

          <p className="mt-4 kicker">{cat?.name}</p>
          <h1 className="mt-2.5 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-navy sm:text-5xl lg:text-[3.25rem]">
            {article.title}
          </h1>
          {article.dek ? <p className="mt-5 dek">{article.dek}</p> : null}

          <div className="mt-5 border-y border-navy/10 py-4">
            <Byline
              author={article.author}
              date={article.date}
              updated={article.updated}
              readingTime={article.readingTime}
            />
          </div>

          <figure className="mt-6">
            <PlaceholderImage
              slug={article.slug}
              category={article.category}
              title={article.title}
              className="aspect-[16/9] w-full rounded-lg"
            />
            <figcaption className="mt-2 text-xs text-navy/40">
              {article.imageAlt} · {article.imageCredit}
            </figcaption>
          </figure>

          <div className="mt-8">
            <ArticleBody body={article.body} />
          </div>

          <Faq items={article.faq} />
          <AuthorBox author={article.author} />
        </article>

        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-6">
            <AdSlot format="halfpage" />
            <div>
              <div className="section-heading">
                <h2>More to read</h2>
              </div>
              <div className="space-y-1">
                {related.map((a) => (
                  <ArticleCard key={a.slug} article={a} variant="list" />
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>

      <section className="mt-14">
        <div className="section-heading">
          <h2>Related Stories</h2>
        </div>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {related.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      </section>

      <div className="my-10 hidden md:block">
        <AdSlot format="billboard" />
      </div>
    </div>
  );
}
