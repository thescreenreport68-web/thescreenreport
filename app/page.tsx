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

  // Distribute articles across sections, preferring fresh ones, reusing only if needed.
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

  const threeCards = take(news, 3);
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
    <div className="container-wide py-6">
      {/* Top Story — full-width hero */}
      <section>
        <div className="mb-3 inline-block border border-navy px-3 py-1 font-sans text-[11px] font-bold uppercase tracking-[0.18em] text-navy">
          Top Story
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Link href={`/${hero.category}/${hero.slug}/`}>
            <PlaceholderImage
              slug={hero.slug}
              category={hero.category}
              title={hero.title}
              className="aspect-[16/10] w-full rounded ring-1 ring-navy/10"
            />
          </Link>
          <div>
            <span className="kicker">{heroCat?.name}</span>
            <h2 className="mt-1.5 font-display text-3xl font-semibold leading-[1.05] tracking-tight text-navy sm:text-4xl lg:text-[3rem]">
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
      </section>

      {/* 3-card row under hero */}
      <section className="mt-10 grid gap-8 border-t border-navy/10 pt-8 sm:grid-cols-3">
        {threeCards.map((a) => (
          <ArticleCard key={a.slug} article={a} variant="standard" />
        ))}
      </section>

      <div className="my-12 hidden md:block">
        <AdSlot format="leaderboard" />
      </div>

      {/* Branded two-column pair */}
      <TwoColumnFeature left={inTheaters} right={nowStreaming} />

      {/* What We're Watching */}
      <section className="mt-14">
        <SectionHeader title="What We're Watching" tagline="Spoilers ahead!" href="/tv/" />
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {whatWatching.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      </section>

      {/* Must Reads */}
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

      <div className="my-12 hidden md:block">
        <AdSlot format="leaderboard" />
      </div>

      {/* Featured Videos + Most Popular rail */}
      <section className="grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FeaturedVideos />
        </div>
        <aside className="lg:col-span-1">
          <div className="relative mb-4 border-b border-navy/15 pb-2.5">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-navy">
              Most Popular
            </h2>
            <span className="absolute -bottom-px left-0 h-0.5 w-12 bg-gold" />
          </div>
          <DottedList items={mostPopular} numbered showKicker={false} />
          <div className="mt-6">
            <AdSlot format="rectangle" />
          </div>
        </aside>
      </section>

      {/* Reviews split */}
      <section className="mt-14">
        <ReviewsSplit movies={movieReviews} tv={tvReviews} />
      </section>

      {/* Featured Voices */}
      <section className="mt-14">
        <FeaturedVoices />
      </section>

      {/* Where to Watch */}
      <section className="mt-14">
        <WhereToWatch />
      </section>

      {/* Podcasts */}
      <section className="mt-14">
        <PodcastsBlock />
      </section>

      {/* Celebrity */}
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

      <NewsletterBand />
    </div>
  );
}
