import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import AdSlot from "@/components/AdSlot";
import SectionHeader from "@/components/SectionHeader";
import DottedList from "@/components/DottedList";
import TwoColumnFeature from "@/components/TwoColumnFeature";
import ReviewsSplit from "@/components/ReviewsSplit";
import FeaturedVideos from "@/components/FeaturedVideos";
import FeaturedVoices from "@/components/FeaturedVoices";
import PodcastsBlock from "@/components/PodcastsBlock";
import WhereToWatch from "@/components/WhereToWatch";
import NewsletterBand from "@/components/NewsletterBand";
import PlaceholderImage from "@/components/PlaceholderImage";
import { getCategory, getAuthor } from "@/lib/site";
import { formatDate } from "@/lib/format";
import type { Article } from "@/lib/articles";
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

  const news = all.filter((a) => a.category !== "reviews");
  const movies = getArticlesByCategory("movies");
  const tv = getArticlesByCategory("tv");
  const streaming = getArticlesByCategory("streaming");
  const celebrity = getArticlesByCategory("celebrity");
  const reviews = getArticlesByCategory("reviews");
  const tvReviews = reviews.filter((a) => TV_REVIEW_SLUGS.includes(a.slug));
  const movieReviews = reviews.filter((a) => !TV_REVIEW_SLUGS.includes(a.slug));

  const hero = getArticleBySlug("mcu-movies-in-order") ?? movies[0] ?? all[0];

  const used = new Set<string>([hero.slug]);
  const take = (pool: Article[], n: number): Article[] => {
    const fresh = pool.filter((a) => !used.has(a.slug)).slice(0, n);
    fresh.forEach((a) => used.add(a.slug));
    if (fresh.length < n) {
      const seen = new Set(fresh.map((a) => a.slug));
      const extra = pool
        .filter((a) => !seen.has(a.slug))
        .slice(0, n - fresh.length);
      return [...fresh, ...extra];
    }
    return fresh;
  };

  const latest = take(news, 6);
  const inTheaters = {
    title: "In Theaters",
    tagline: "The films everyone's talking about",
    href: "/movies/",
    lead: take(movies, 1)[0] ?? movies[0],
    rest: take(movies, 3),
  };
  const nowStreaming = {
    title: "Now Streaming",
    tagline: "What to watch this week",
    href: "/streaming/",
    lead: take([...streaming, ...tv], 1)[0] ?? streaming[0],
    rest: take([...streaming, ...tv, ...movies], 3),
  };
  const whatWatching = take([...tv, ...streaming, ...news], 4);
  const mustReads = take([...celebrity, ...news], 4);
  const celebrityRow = take([...celebrity, ...news], 4);
  const mostPopular = all.slice(0, 6);
  const heroCat = getCategory(hero.category);

  return (
    <div className="container-wide py-8">
      {/* 1. Top Story + Latest rail */}
      <section className="grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="relative">
            <Link href={`/${hero.category}/${hero.slug}/`}>
              <PlaceholderImage
                slug={hero.slug}
                category={hero.category}
                title={hero.title}
                className="aspect-[16/10] w-full ring-1 ring-navy/10"
              />
            </Link>
            <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 border border-navy bg-white px-4 py-1.5 font-sans text-[11px] font-bold uppercase tracking-[0.2em] text-navy">
              Top Story
            </span>
          </div>
          <div className="mx-auto mt-7 max-w-3xl text-center">
            <h1 className="font-display text-4xl font-bold leading-[1.03] tracking-tight text-navy sm:text-5xl lg:text-[3.4rem]">
              <Link href={`/${hero.category}/${hero.slug}/`}>{hero.title}</Link>
            </h1>
            {hero.dek ? (
              <p className="mx-auto mt-4 max-w-2xl font-dek text-xl italic leading-snug text-navy/70">
                {hero.dek}
              </p>
            ) : null}
            <p className="mt-4 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
              By {getAuthor(hero.author)?.name}
            </p>
          </div>
        </div>

        <aside className="lg:col-span-1">
          <div className="mb-4 border-b-2 border-navy pb-2">
            <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-navy">
              Latest News
            </h2>
          </div>
          <DottedList items={latest} showKicker showTime />
          <div className="mt-6">
            <AdSlot format="rectangle" />
          </div>
        </aside>
      </section>

      <div className="my-12 hidden md:block">
        <AdSlot format="leaderboard" />
      </div>

      {/* 2. Branded two-column pair */}
      <TwoColumnFeature left={inTheaters} right={nowStreaming} />

      <div className="my-12 hidden md:block">
        <AdSlot format="leaderboard" />
      </div>

      {/* 3. What We're Watching */}
      <section>
        <SectionHeader title="What We're Watching" tagline="Spoilers ahead!" href="/tv/" />
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {whatWatching.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      </section>

      {/* 4. Must Reads */}
      <section className="mt-14">
        <SectionHeader
          title="Must Reads"
          tagline="Buzzy interviews, features and hot takes"
          href="/celebrity/"
        />
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {mustReads.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      </section>

      {/* 5. Featured Videos */}
      <section className="mt-14">
        <FeaturedVideos />
      </section>

      <div className="my-12 hidden md:block">
        <AdSlot format="leaderboard" />
      </div>

      {/* 6. Reviews + Most Popular rail */}
      <section className="grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ReviewsSplit movies={movieReviews} tv={tvReviews} />
        </div>
        <aside className="lg:col-span-1">
          <div className="relative mb-4 border-b border-navy/15 pb-2.5">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-navy">
              Most Popular
            </h2>
            <span className="absolute -bottom-px left-0 h-0.5 w-12 bg-gold" />
          </div>
          <DottedList items={mostPopular} numbered showKicker={false} />
        </aside>
      </section>

      {/* 7. Featured Voices */}
      <section className="mt-14">
        <FeaturedVoices />
      </section>

      {/* 8. Where to Watch */}
      <section className="mt-14">
        <WhereToWatch />
      </section>

      {/* 9. Podcasts */}
      <section className="mt-14">
        <PodcastsBlock />
      </section>

      {/* 10. Celebrity */}
      <section className="mt-14">
        <SectionHeader
          title="Celebrity"
          tagline="The stars and the stories around them"
          href="/celebrity/"
        />
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {celebrityRow.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      </section>

      <div className="my-12 hidden md:block">
        <AdSlot format="billboard" />
      </div>

      <NewsletterBand />
    </div>
  );
}
