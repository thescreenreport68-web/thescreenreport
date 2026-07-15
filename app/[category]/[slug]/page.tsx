import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Breadcrumbs from "@/components/Breadcrumbs";
import Byline from "@/components/Byline";
import PlaceholderImage from "@/components/PlaceholderImage";
import ArticleBody from "@/components/ArticleBody";
import KeyTakeaways from "@/components/KeyTakeaways";
import { NicheTop, NicheBottom } from "@/components/NicheModules";
import { CategoryKicker } from "@/components/CategoryUI";
import Faq from "@/components/Faq";
import AuthorBox from "@/components/AuthorBox";
import NewsletterBand from "@/components/NewsletterBand";
import AdSlot from "@/components/AdSlot";
import ArticleCard from "@/components/ArticleCard";
import JsonLd from "@/components/JsonLd";
import ReadingProgress from "@/components/ReadingProgress";
import TrendingBadge from "@/components/TrendingBadge";
import CommentsMount from "@/components/CommentsMount";
import SubcategoryArchive from "@/components/SubcategoryArchive";
import { getAllArticles, getArticle, getRelated } from "@/lib/articles";
import { formatDate } from "@/lib/format";
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
  // SEO <title>: Google truncates past ~60 chars, and the root layout template
  // appends " — The Screen Report" (20 chars). Only let that brand suffix through
  // when metaTitle is short enough to keep the whole tag ≤60; otherwise emit the
  // metaTitle ALONE (absolute) so the headline is never cut off by the brand.
  // This touches ONLY the hidden <title>/browser-tab/Google blue-link — the on-page
  // <h1> readers see stays `article.title` (full, expressive, UNCHANGED).
  const titleTag =
    article.metaTitle.length + 20 <= 60
      ? article.metaTitle
      : { absolute: article.metaTitle };
  return {
    title: titleTag,
    description: article.metaDescription,
    alternates: { canonical: `/${article.category}/${article.slug}/` },
    // Recheck corrections / the inside parent-retraction cascade write robots: "noindex".
    ...(article.robots === "noindex" ? { robots: { index: false, follow: false } } : {}),
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
            url: article.image.startsWith("http") ? article.image : `${SITE.url}${article.image}`,
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
      // Allowlist — inside articles carry Person/Organization about entries; anything else stays Movie.
      "@type": ["Person", "Organization", "TVSeries", "Movie"].includes(e.type ?? "") ? e.type : "Movie",
      name: e.name,
      ...(e.sameAs ? { sameAs: e.sameAs } : {}),
    })),
    // Awards ceremony: supplementary Event schema (NewsArticle stays primary; no offers/ticketing).
    article.awardShow?.show
      ? {
          "@context": "https://schema.org",
          "@type": "Event",
          name: article.awardShow.show,
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          ...(article.awardShow.dateISO ? { startDate: article.awardShow.dateISO } : {}),
          ...(article.awardShow.venue
            ? { location: { "@type": "Place", name: article.awardShow.venue } }
            : {}),
        }
      : null,
    // Reviews: a Review object with the rating (rich-result eligible; NewsArticle stays primary).
    (article.formatTag === "review" || article.formatTag === "recap") && article.rating?.score
      ? {
          "@context": "https://schema.org",
          "@type": "Review",
          itemReviewed: {
            "@type": article.about?.[0]?.type === "TVSeries" ? "TVSeries" : "Movie",
            name: article.about?.[0]?.name || article.title,
          },
          reviewRating: {
            "@type": "Rating",
            ratingValue: article.rating.score,
            bestRating: article.rating.max ?? 10,
            worstRating: 1,
          },
          author: { "@type": "Organization", name: SITE.name },
          ...(article.verdict ? { reviewBody: article.verdict } : {}),
        }
      : null,
    // Music tour dates → MusicEvent per stop (embed-only, no ticketing/offers).
    ...(article.formatTag === "music-news" && article.tourDates?.length
      ? article.tourDates
          .filter((d) => d.city || d.venue)
          .map((d) => ({
            "@context": "https://schema.org",
            "@type": "MusicEvent",
            name: `${article.release?.title || article.title}${d.city ? ` — ${d.city}` : ""}`,
            ...(d.date ? { startDate: d.date } : {}),
            ...(d.venue
              ? { location: { "@type": "Place", name: d.venue, ...(d.city ? { address: d.city } : {}) } }
              : {}),
          }))
      : []),
  ].filter(Boolean) as object[];

  const isNewsForm = article.formatTag === "news";

  return (
    <div className="container-wide py-6">
      <ReadingProgress />
      <JsonLd data={jsonLd} />

      {/* Top billboard */}
      <div data-pagefind-ignore className="mb-6 flex justify-center">
        <AdSlot format="billboard" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <article className="min-w-0" data-pagefind-body>
          {/* Folio line (spec §D1): breadcrumb left, date + reading time right */}
          <div data-pagefind-ignore className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-hair pb-2">
            <Breadcrumbs
              items={[
                { href: "/", label: "Home" },
                { href: `/${article.category}/`, label: cat?.name ?? "" },
              ]}
            />
            <div className="meta-mono hidden items-baseline gap-2 sm:flex">
              <time dateTime={article.date}>{formatDate(article.date)}</time>
              {article.readingTime ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{article.readingTime} min read</span>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex items-baseline gap-2.5">
            <TrendingBadge article={article} />
            <CategoryKicker
              href={`/${article.category}/`}
              categoryName={
                isNewsForm && article.newsType && article.newsType !== "general"
                  ? article.newsType.replace(/-/g, " ")
                  : (cat?.name ?? "")
              }
              subName={
                !isNewsForm && article.subcategory
                  ? article.subcategory.replace(/-/g, " ")
                  : undefined
              }
            />
          </div>
          <h1 className="hed-xl mt-3">{article.title}</h1>
          {article.dek ? (
            <p className="dek mt-4 text-xl leading-[1.4]">{article.dek}</p>
          ) : null}

          <div data-pagefind-ignore className="mt-5">
            <Byline
              author={article.author}
              date={article.date}
              updated={article.updated}
              url={`/${article.category}/${article.slug}/`}
              title={article.title}
              readingTime={article.readingTime}
            />
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
            {article.imageCredit ? (
              <figcaption className="mt-1.5 text-right">
                <cite className="meta-mono not-italic text-gray">
                  {article.imageCredit}
                </cite>
              </figcaption>
            ) : null}
          </figure>

          <div className="mx-auto max-w-prose">
            <NicheTop article={article} />

            <KeyTakeaways items={article.keyTakeaways} />
          </div>

          <ArticleBody
            body={article.body}
            related={related}
            dropCap={!isNewsForm}
          />

          <div className="mx-auto max-w-prose">
            <NicheBottom article={article} />

            <Faq items={article.faq} />
            <AuthorBox author={article.author} />
          </div>

          <NewsletterBand />

          <div className="mx-auto max-w-prose" data-pagefind-ignore>
            <CommentsMount slug={article.slug} />
          </div>

          {/* End-of-article recirculation */}
          <section data-pagefind-ignore className="mt-12">
            <div className="mb-6 border-b-2 border-ink pb-2">
              <h2 className="sect-head">More from The Screen Report</h2>
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

        {/* Right rail (THR pattern): 300x600 → Must Reads → the LAST ad wrapped
            sticky so it rides the frame for the entire remaining read. The
            wrapper is h-full (the grid stretches the aside to the article's
            height) — without that the sticky has no travel room and never
            sticks. */}
        <aside className="hidden lg:block">
          <div className="flex h-full flex-col gap-7">
            <AdSlot format="halfpage" />
            <div className="border-t-2 border-ink">
              <div className="border-b border-hair pb-2 pt-2.5">
                <h2 className="sect-head text-2xl lg:text-2xl">Must Reads</h2>
              </div>
              <div>
                {related.map((a) => (
                  <ArticleCard key={a.slug} article={a} variant="list" />
                ))}
              </div>
            </div>
            <div className="sticky top-[68px]">
              <AdSlot format="halfpage" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
