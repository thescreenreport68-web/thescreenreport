import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Breadcrumbs from "@/components/Breadcrumbs";
import Byline from "@/components/Byline";
import PlaceholderImage from "@/components/PlaceholderImage";
import ArticleBody from "@/components/ArticleBody";
import KeyTakeaways from "@/components/KeyTakeaways";
import Faq from "@/components/Faq";
import AuthorBox from "@/components/AuthorBox";
import NewsletterBand from "@/components/NewsletterBand";
import AdSlot from "@/components/AdSlot";
import ArticleCard from "@/components/ArticleCard";
import JsonLd from "@/components/JsonLd";
import SubcategoryArchive from "@/components/SubcategoryArchive";
import { getAllArticles, getArticle, getRelated } from "@/lib/articles";
import {
  getAuthor,
  getCategory,
  getSubcategory,
  getSubcategoriesForCategory,
  CATEGORIES,
  SITE,
} from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  const articleParams = getAllArticles().map((a) => ({
    category: a.category,
    slug: a.slug,
  }));
  const subParams = CATEGORIES.flatMap((c) =>
    getSubcategoriesForCategory(c.slug).map((s) => ({
      category: c.slug,
      slug: s.slug,
    }))
  );
  return [...articleParams, ...subParams];
}

export function generateMetadata({
  params,
}: {
  params: { category: string; slug: string };
}): Metadata {
  const sub = getSubcategory(params.category, params.slug);
  if (sub) {
    const cat = getCategory(params.category);
    return {
      title: `${sub.name} — ${cat?.name}`,
      description: `${sub.name} from The Screen Report's ${cat?.name} coverage — ${cat?.blurb ?? ""}`,
      alternates: { canonical: `/${params.category}/${sub.slug}/` },
    };
  }
  const article = getArticle(params.category, params.slug);
  if (!article) return {};
  const ogImages = article.image
    ? [
        {
          url: article.image,
          width: article.imageWidth,
          height: article.imageHeight,
          alt: article.imageAlt,
        },
      ]
    : undefined;
  return {
    title: article.metaTitle,
    description: article.metaDescription,
    alternates: { canonical: `/${article.category}/${article.slug}/` },
    openGraph: {
      title: article.metaTitle,
      description: article.metaDescription,
      type: "article",
      url: `/${article.category}/${article.slug}/`,
      images: ogImages,
    },
    twitter: {
      card: "summary_large_image",
      title: article.metaTitle,
      description: article.metaDescription,
      images: article.image ? [article.image] : undefined,
    },
  };
}

export default function ArticlePage({
  params,
}: {
  params: { category: string; slug: string };
}) {
  const sub = getSubcategory(params.category, params.slug);
  if (sub) {
    return <SubcategoryArchive category={params.category} sub={sub} />;
  }
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
      image: article.image
        ? {
            "@type": "ImageObject",
            url: `${SITE.url}${article.image}`,
            width: article.imageWidth,
            height: article.imageHeight,
          }
        : undefined,
      datePublished: article.date,
      dateModified: article.updated ?? article.date,
      author: author
        ? {
            "@type": author.type ?? "Person",
            name: author.name,
            url: `${SITE.url}/author/${author.slug}/`,
            ...(author.sameAs?.length ? { sameAs: author.sameAs } : {}),
          }
        : undefined,
      publisher: { "@type": "Organization", name: SITE.name, url: SITE.url },
      mainEntityOfPage: `${SITE.url}/${article.category}/${article.slug}/`,
      articleSection: cat?.name,
      keywords: article.tags.join(", "),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE.url}/` },
        { "@type": "ListItem", position: 2, name: cat?.name, item: `${SITE.url}/${article.category}/` },
        { "@type": "ListItem", position: 3, name: article.title, item: `${SITE.url}/${article.category}/${article.slug}/` },
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
    ...(article.about ?? []).map((e) => ({
      "@context": "https://schema.org",
      "@type": e.type === "TVSeries" ? "TVSeries" : "Movie",
      name: e.name,
      ...(e.sameAs ? { sameAs: e.sameAs } : {}),
    })),
  ].filter(Boolean) as object[];

  return (
    <div className="container-wide py-6">
      <JsonLd data={jsonLd} />

      {/* Top billboard */}
      <div className="mb-6 flex justify-center">
        <AdSlot format="billboard" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <article className="min-w-0">
          <Breadcrumbs
            items={[
              { href: "/", label: "Home" },
              { href: `/${article.category}/`, label: cat?.name ?? "" },
            ]}
          />
          <h1 className="mt-1 font-display text-4xl font-bold leading-[0.95] tracking-tight text-navy sm:text-5xl lg:text-[3.4rem] xl:text-[4rem]">
            {article.title}
          </h1>
          {article.dek ? (
            <p className="mt-3 font-body text-2xl leading-snug text-navy">{article.dek}</p>
          ) : null}

          <div className="mt-4">
            <Byline author={article.author} date={article.date} updated={article.updated} />
          </div>

          <figure className="my-6">
            <PlaceholderImage
              slug={article.slug}
              category={article.category}
              title={article.title}
              src={article.image}
              alt={article.imageAlt}
              eager
              width={article.imageWidth}
              height={article.imageHeight}
              className="aspect-video w-full"
            />
            <figcaption className="mt-2 leading-snug">
              <span className="font-body text-base text-navy">{article.imageAlt}</span>{" "}
              <cite className="font-sans text-xs not-italic uppercase tracking-[0.04em] text-slate">
                {article.imageCredit}
              </cite>
            </figcaption>
          </figure>

          <KeyTakeaways items={article.keyTakeaways} />

          <ArticleBody body={article.body} related={related} />

          <Faq items={article.faq} />
          <AuthorBox author={article.author} />
          <NewsletterBand />

          {/* End-of-article recirculation */}
          <section className="mt-12">
            <div className="mb-5 border-b border-hair pb-2">
              <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-navy sm:text-[1.8rem]">
                Related Stories
              </h2>
            </div>
            <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((a) => (
                <ArticleCard key={a.slug} article={a} variant="standard" />
              ))}
            </div>
          </section>

          <div className="my-10 flex justify-center">
            <AdSlot format="billboard" />
          </div>
        </article>

        {/* Right rail: 300x600 + More to Read + sticky 300x600 */}
        <aside className="hidden lg:block">
          <div className="space-y-7">
            <div>
              <div className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate/60">
                Advertisement
              </div>
              <AdSlot format="halfpage" />
            </div>
            <div>
              <div className="mb-2 border-b border-hair pb-2">
                <h2 className="font-display text-xl font-bold uppercase tracking-tight text-navy">
                  More to Read
                </h2>
              </div>
              <div>
                {related.map((a) => (
                  <ArticleCard key={a.slug} article={a} variant="list" />
                ))}
              </div>
            </div>
            <div className="sticky top-24">
              <div className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate/60">
                Advertisement
              </div>
              <AdSlot format="halfpage" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
