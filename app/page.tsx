import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import AdSlot from "@/components/AdSlot";
import SectionHeader from "@/components/SectionHeader";
import DottedList from "@/components/DottedList";
import TwoColumnFeature from "@/components/TwoColumnFeature";
import ReviewsSplit from "@/components/ReviewsSplit";
import NewsletterBand from "@/components/NewsletterBand";
import PlaceholderImage from "@/components/PlaceholderImage";
import { getCategory, getAuthor } from "@/lib/site";
import { formatDate } from "@/lib/format";
import {
  getAllArticles,
  getArticlesByCategory,
  getArticleBySlug,
} from "@/lib/articles";

const TV_REVIEW_SLUGS = ["the-bear-review", "shogun-review"];

export default function HomePage() {
  const all = getAllArticles();
  if (!all.length) {
    return (
      <div className="container-wide py-20 text-center text-navy/60">
        <h1 className="font-display text-3xl font-semibold text-navy">
          The Screen Report
        </h1>
        <p className="mt-3">Stories are on the way.</p>
      </div>
    );
  }

  const movies = getArticlesByCategory("movies");
  const streaming = getArticlesByCategory("streaming");
  const tv = getArticlesByCategory("tv");
  const celebrity = getArticlesByCategory("celebrity");
  const reviews = getArticlesByCategory("reviews");
  const tvReviews = reviews.filter((a) => TV_REVIEW_SLUGS.includes(a.slug));
  const movieReviews = reviews.filter((a) => !TV_REVIEW_SLUGS.includes(a.slug));

  const hero = getArticleBySlug("mcu-movies-in-order") ?? movies[0] ?? all[0];
  const latest = all.filter((a) => a.slug !== hero.slug).slice(0, 5);

  const moviesPool = movies.filter((a) => a.slug !== hero.slug);
  const inTheaters = {
    title: "In Theaters",
    tagline: "The films everyone's talking about",
    href: "/movies/",
    lead: moviesPool[0] ?? movies[0],
    rest: moviesPool.slice(1, 4),
  };
  const nowStreaming = {
    title: "Now Streaming",
    tagline: "What to watch this week",
    href: "/streaming/",
    lead: streaming[0],
    rest: [...streaming.slice(1), ...tv].slice(0, 3),
  };

  const latestRow = [...celebrity, ...tv, ...movies]
    .filter((a, i, arr) => arr.findIndex((x) => x.slug === a.slug) === i)
    .slice(0, 4);
  const heroCat = getCategory(hero.category);

  return (
    <div className="container-wide py-6">
      <div className="mb-8 hidden md:block">
        <AdSlot format="billboard" />
      </div>

      {/* Top Story + Latest rail */}
      <section className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 inline-block border border-navy px-3 py-1 font-sans text-[11px] font-bold uppercase tracking-[0.18em] text-navy">
            Top Story
          </div>
          <Link href={`/${hero.category}/${hero.slug}/`}>
            <PlaceholderImage
              slug={hero.slug}
              category={hero.category}
              title={hero.title}
              className="aspect-[16/9] w-full rounded ring-1 ring-navy/10"
            />
          </Link>
          <div className="mt-4">
            <span className="kicker">{heroCat?.name}</span>
            <h2 className="mt-1.5 font-display text-3xl font-semibold leading-[1.06] tracking-tight text-navy sm:text-[2.6rem]">
              <Link href={`/${hero.category}/${hero.slug}/`}>{hero.title}</Link>
            </h2>
            {hero.dek ? (
              <p className="mt-3 font-dek text-xl italic text-navy/70">{hero.dek}</p>
            ) : null}
            <p className="mt-3 font-sans text-xs uppercase tracking-wide text-faint">
              By {getAuthor(hero.author)?.name} · {formatDate(hero.date)}
            </p>
          </div>
        </div>

        <aside className="lg:col-span-1">
          <div className="relative mb-4 border-b border-navy/15 pb-2.5">
            <h2 className="font-display text-xl font-semibold text-navy">Latest</h2>
            <span className="absolute -bottom-px left-0 h-0.5 w-12 bg-gold" />
          </div>
          <DottedList items={latest} showKicker />
          <div className="mt-6">
            <AdSlot format="rectangle" />
          </div>
        </aside>
      </section>

      <div className="my-12 hidden md:block">
        <AdSlot format="leaderboard" />
      </div>

      {/* Two-column branded block (Heat Vision / Live Feed style) */}
      <TwoColumnFeature left={inTheaters} right={nowStreaming} />

      <div className="my-12 hidden md:block">
        <AdSlot format="leaderboard" />
      </div>

      {/* Reviews split */}
      <ReviewsSplit movies={movieReviews} tv={tvReviews} />

      {/* Latest Stories row */}
      <section className="mt-12">
        <SectionHeader
          title="Latest Stories"
          tagline="Across movies, TV and celebrity"
        />
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {latestRow.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      </section>

      <NewsletterBand />
    </div>
  );
}
