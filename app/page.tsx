import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import AdSlot from "@/components/AdSlot";
import SectionHeader from "@/components/SectionHeader";
import DottedList from "@/components/DottedList";
import LatestNews from "@/components/LatestNews";
import TwoColumnFeature from "@/components/TwoColumnFeature";
import ReviewsSplit from "@/components/ReviewsSplit";
import FeaturedVideos from "@/components/FeaturedVideos";
import FeaturedVoices from "@/components/FeaturedVoices";
import PodcastsBlock from "@/components/PodcastsBlock";
import WhereToWatch from "@/components/WhereToWatch";
import NewsletterBand from "@/components/NewsletterBand";
import PlaceholderImage from "@/components/PlaceholderImage";
import { getAuthor } from "@/lib/site";
import type { Article } from "@/lib/articles";
import {
  getAllArticles,
  getArticlesByCategory,
  getArticleBySlug,
} from "@/lib/articles";

const TV_REVIEW_SLUGS = ["the-bear-review", "shogun-review"];

// A leaderboard ad rendered between content sections (desktop) / rectangle (mobile).
function AdBreak() {
  return (
    <div className="my-10 flex justify-center">
      <AdSlot format="leaderboard" className="hidden md:flex" />
      <AdSlot format="rectangle" className="md:hidden" />
    </div>
  );
}

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
      const extra = pool.filter((a) => !seen.has(a.slug)).slice(0, n - fresh.length);
      return [...fresh, ...extra];
    }
    return fresh;
  };

  const latest = take(news, 7);
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

  return (
    <div className="container-wide py-8">
      {/* 1. Top Story + Latest News rail (rail has an in-feed 300x250 after item 3) */}
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <div className="relative">
            <Link href={`/${hero.category}/${hero.slug}/`}>
              <PlaceholderImage
                slug={hero.slug}
                category={hero.category}
                title={hero.title}
                src={hero.image}
                alt={hero.imageAlt}
                className="aspect-video w-full"
              />
            </Link>
            <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 border border-grey bg-white p-1">
              <span className="block border border-grey px-3 py-1.5 font-body text-[13px] uppercase tracking-[0.18em] text-navy">
                Top Story
              </span>
            </span>
          </div>
          <div className="mx-auto mt-7 max-w-3xl text-center">
            <h1 className="font-display text-4xl font-bold leading-[0.95] tracking-tight text-navy sm:text-5xl lg:text-[3.4rem]">
              <Link href={`/${hero.category}/${hero.slug}/`}>{hero.title}</Link>
            </h1>
            {hero.dek ? (
              <p className="mx-auto mt-4 max-w-2xl font-body text-[1.375rem] leading-[1.15] text-navy">
                {hero.dek}
              </p>
            ) : null}
            <p className="mt-4 meta-label">By {getAuthor(hero.author)?.name}</p>
          </div>
        </div>

        <aside>
          <LatestNews items={latest} />
        </aside>
      </section>

      <AdBreak />

      {/* 2. Branded two-column pair */}
      <TwoColumnFeature left={inTheaters} right={nowStreaming} />

      <AdBreak />

      {/* 3. What We're Watching */}
      <section>
        <SectionHeader title="What We're Watching" tagline="Spoilers ahead!" href="/tv/" />
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {whatWatching.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      </section>

      <AdBreak />

      {/* 4. Must Reads */}
      <section>
        <SectionHeader
          title="Must Reads"
          tagline="Buzzy interviews, features and hot takes"
          href="/celebrity/"
        />
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {mustReads.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      </section>

      <AdBreak />

      {/* 5. Featured Videos + Most Popular rail (rail has a 300x250) */}
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <FeaturedVideos />
        </div>
        <aside>
          <div className="mb-2 border-b border-hair pb-2">
            <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-navy sm:text-[1.8rem]">
              Most Popular
            </h2>
          </div>
          <DottedList items={mostPopular} numbered showKicker={false} />
          <div className="mt-6">
            <div className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate/60">
              Advertisement
            </div>
            <AdSlot format="rectangle" />
          </div>
        </aside>
      </section>

      <AdBreak />

      {/* 6. Reviews */}
      <section>
        <ReviewsSplit movies={movieReviews} tv={tvReviews} />
      </section>

      <AdBreak />

      {/* 7. Featured Voices */}
      <section>
        <FeaturedVoices />
      </section>

      <AdBreak />

      {/* 8. Where to Watch */}
      <section>
        <WhereToWatch />
      </section>

      <AdBreak />

      {/* 9. Podcasts */}
      <section>
        <PodcastsBlock />
      </section>

      <AdBreak />

      {/* 10. Celebrity */}
      <section>
        <SectionHeader
          title="Celebrity"
          tagline="The stars and the stories around them"
          href="/celebrity/"
        />
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {celebrityRow.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      </section>

      <div className="my-10 flex justify-center">
        <AdSlot format="billboard" />
      </div>

      <NewsletterBand />
    </div>
  );
}
