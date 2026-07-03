import type { Metadata } from "next";
import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import AdSlot from "@/components/AdSlot";
import SectionHeader from "@/components/SectionHeader";
import DottedList from "@/components/DottedList";
import LatestNews from "@/components/LatestNews";
import TwoColumnFeature from "@/components/TwoColumnFeature";
import ReviewsSplit from "@/components/ReviewsSplit";
import FeaturedVideos from "@/components/FeaturedVideos";
import WhereToWatch from "@/components/WhereToWatch";
import NewsletterBand from "@/components/NewsletterBand";
import PlaceholderImage from "@/components/PlaceholderImage";
import TrendingBadge from "@/components/TrendingBadge";
import { getAuthor, getCategory } from "@/lib/site";
import { formatRelative } from "@/lib/format";
import type { Article } from "@/lib/articles";
import { getAllArticles, getArticlesByCategory } from "@/lib/articles";
import { HOMEPAGE, pickHero, byHeat, pickDiverse, trendingRail } from "@/lib/homepage";

// A leaderboard ad between content sections (desktop) / rectangle (mobile).
function AdBreak() {
  return (
    <div className="my-12 flex justify-center lg:my-14">
      <AdSlot format="leaderboard" className="hidden md:flex" />
      <AdSlot format="rectangle" className="md:hidden" />
    </div>
  );
}

// A 2px ink rule between editorial sections (spec §A4) — the section grammar.
function SectionRule() {
  return <div className="my-12 border-t-2 border-ink lg:my-14" aria-hidden />;
}

export function generateMetadata(): Metadata {
  const all = getAllArticles();
  if (!all.length) return {};
  const heroImg = pickHero(all, Date.now())?.image;
  if (!heroImg) return {};
  return {
    openGraph: { images: [{ url: heroImg }] },
    twitter: { images: [heroImg] },
  };
}

export default function HomePage() {
  const all = getAllArticles();
  if (!all.length) {
    return (
      <div className="container-wide py-20 text-center">
        <h1 className="hed-xl">The Screen Report</h1>
        <p className="dek mt-3">Stories are on the way.</p>
      </div>
    );
  }

  const now = Date.now();
  const news = all.filter((a) => a.category !== "reviews");
  const movies = getArticlesByCategory("movies");
  const tv = getArticlesByCategory("tv");
  const streaming = getArticlesByCategory("streaming");
  const celebrity = getArticlesByCategory("celebrity");
  const reviews = getArticlesByCategory("reviews");
  const tvReviews = reviews.filter((a) => a.subcategory === "tv-reviews").slice(0, 3);
  const movieReviews = reviews
    .filter((a) => a.subcategory !== "tv-reviews")
    .slice(0, 3);
  const trailers = all.filter((a) => a.formatTag === "trailer");
  const watchGuides = all.filter(
    (a) => a.formatTag === "guide" || a.formatTag === "watchguide"
  );

  // ---- slot assembly (HOMEPAGE_PROGRAMMING_PLAN.md §5): heat-ranked pulls,
  // deduped by slug AND event across the whole page ----
  const hero = pickHero(all, now);
  const heroCat = getCategory(hero.category);
  const heroAuthor = getAuthor(hero.author);
  const heroBadged = hero;

  const used = { slugs: new Set<string>([hero.slug]), events: new Set<string>() };
  if (hero.eventSlug) used.events.add(hero.eventSlug);
  // Backfill guard: pickDiverse never repeats, so thin pools may under-fill.
  const fill = (picked: Article[], pool: Article[], n: number): Article[] => {
    if (picked.length >= n) return picked;
    const have = new Set(picked.map((a) => a.slug));
    const extra = pool.filter((a) => !have.has(a.slug) && !used.slugs.has(a.slug)).slice(0, n - picked.length);
    extra.forEach((a) => used.slugs.add(a.slug));
    return [...picked, ...extra];
  };

  // Sub-leads: next-hottest with art, max 2 per category (>=2 distinct categories).
  const subLeads = fill(
    pickDiverse(byHeat(news.filter((a) => a.image), now, HOMEPAGE.GRAVITY_HOT), 3, used, 2),
    news.filter((a) => a.image),
    3
  );
  // Latest rail: pure chronology — the freshness signal.
  const latest = fill(pickDiverse(news, 12, used), news, 12);
  // Trending rail: ranked, deduped only against the hero package — it MAY repeat
  // a Latest-rail item (time-order vs rank-order are different claims), but its
  // picks are excluded from the card grids below.
  const railUsed = {
    slugs: new Set<string>([hero.slug, ...subLeads.map((a) => a.slug)]),
    events: new Set<string>(
      [hero, ...subLeads].flatMap((a) => (a.eventSlug ? [a.eventSlug] : []))
    ),
  };
  const rail = trendingRail(news, now, railUsed);
  rail.items.forEach((a) => {
    used.slugs.add(a.slug);
    if (a.eventSlug) used.events.add(a.eventSlug);
  });
  const inTheaters = {
    title: "In Theaters",
    tagline: "The films everyone's talking about",
    href: "/movies/",
    lead: fill(pickDiverse(byHeat(movies, now, HOMEPAGE.GRAVITY_BALANCED), 1, used), movies, 1)[0],
    rest: fill(pickDiverse(byHeat(movies, now, HOMEPAGE.GRAVITY_BALANCED), 3, used), movies, 3),
  };
  const streamPool = [...streaming, ...tv];
  const nowStreaming = {
    title: "Now Streaming",
    tagline: "What to watch this week",
    href: "/streaming/",
    lead: fill(pickDiverse(byHeat(streamPool, now, HOMEPAGE.GRAVITY_BALANCED), 1, used), streamPool, 1)[0],
    rest: fill(
      pickDiverse(byHeat([...streamPool, ...movies], now, HOMEPAGE.GRAVITY_BALANCED), 3, used),
      [...streamPool, ...movies],
      3
    ),
  };
  const whatWatching = fill(
    pickDiverse(byHeat([...tv, ...streaming], now, HOMEPAGE.GRAVITY_SLOW), 4, used, 2),
    [...tv, ...streaming, ...news],
    4
  );
  const mustReads = fill(
    pickDiverse(byHeat(news, now, HOMEPAGE.GRAVITY_BALANCED), 4, used, 2),
    [...celebrity, ...news],
    4
  );
  const celebrityRow = fill(
    pickDiverse(byHeat(celebrity, now, HOMEPAGE.GRAVITY_BALANCED), 4, used),
    [...celebrity, ...news],
    4
  );


  return (
    <div className="container-wide py-8">
      {/* 1. Lead package + Latest News rail */}
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_332px] lg:gap-8">
        <div>
          {/* Lead story — boxed rubric pulled over the image top edge (spec §C1) */}
          <article className="group">
            <div className="flex justify-center">
              <span className="kicker relative z-10 -mb-3 border border-ink bg-paper px-3 pb-1 pt-1.5 text-ink">
                Top Story
              </span>
            </div>
            <Link
              href={`/${hero.category}/${hero.slug}/`}
              className="block overflow-hidden"
            >
              <PlaceholderImage
                slug={hero.slug}
                category={hero.category}
                title={hero.title}
                src={hero.image}
                alt={hero.imageAlt}
                eager
                className="aspect-video w-full transition-transform duration-200 group-hover:scale-[1.01] motion-reduce:transform-none"
              />
            </Link>
            <div className="mx-auto mt-6 max-w-3xl text-center sm:px-8">
              <div className="flex items-baseline justify-center gap-2.5">
                <TrendingBadge article={heroBadged} />
                <Link href={`/${hero.category}/`} className="kicker">
                  {heroCat?.name}
                </Link>
                <time dateTime={hero.date} className="meta-mono">
                  {formatRelative(hero.date)}
                </time>
              </div>
              <h1 className="hed-xl mt-3 xl:text-[48px] xl:leading-[0.98] transition-colors duration-150 group-hover:text-red">
                <Link href={`/${hero.category}/${hero.slug}/`}>{hero.title}</Link>
              </h1>
              {hero.dek ? (
                <p className="dek mx-auto mt-4 max-w-[640px] text-xl leading-[1.4]">
                  {hero.dek}
                </p>
              ) : null}
              <p className="byline mt-4">
                By <span className="text-ink">{heroAuthor?.name}</span>
              </p>
            </div>
          </article>

          {/* Sub-lead row */}
          <div className="mt-8 grid gap-x-5 gap-y-8 border-t border-dotted border-gray pt-8 sm:grid-cols-2 lg:grid-cols-4">
            {subLeads[0] ? (
              <ArticleCard article={subLeads[0]} variant="compact" />
            ) : null}
            {subLeads[1] ? (
              <div className="sm:col-span-2">
                <MattedCard article={subLeads[1]} />
              </div>
            ) : null}
            {subLeads[2] ? (
              <ArticleCard article={subLeads[2]} variant="compact" />
            ) : null}
          </div>
        </div>

        <aside>
          <LatestNews items={latest} />
        </aside>
      </section>

      <AdBreak />

      {/* 2. Branded two-column pair */}
      <TwoColumnFeature left={inTheaters} right={nowStreaming} />

      <SectionRule />

      {/* 3. What We're Watching */}
      <section>
        <SectionHeader title="What We're Watching" tagline="Spoilers ahead!" href="/tv/" />
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {whatWatching.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      </section>

      <SectionRule />

      {/* 4. Must Reads */}
      <section>
        <SectionHeader
          title="Must Reads"
          tagline="Buzzy features and the stories behind the stories"
          href="/celebrity/"
        />
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {mustReads.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      </section>

      <AdBreak />

      {/* 5. Latest Trailers + More Top Stories rail */}
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
        <div>
          <FeaturedVideos items={trailers} />
        </div>
        <aside>
          <div className="border-t-2 border-ink">
            <div className="flex items-baseline gap-2.5 border-b border-hair pb-2 pt-2.5">
              <h2 className="sect-head text-2xl lg:text-2xl">
                {rail.isTrending ? "Trending Now" : "More Top Stories"}
              </h2>
              {rail.isTrending ? <span className="dot-live" aria-hidden /> : null}
            </div>
            <div className="pt-3">
              <DottedList items={rail.items} numbered showKicker={false} showTime />
            </div>
          </div>
          <div className="mt-7">
            <AdSlot format="rectangle" />
          </div>
        </aside>
      </section>

      <SectionRule />

      {/* 6. Reviews */}
      <ReviewsSplit movies={movieReviews} tv={tvReviews} />

      <SectionRule />

      {/* 7. Where to Watch */}
      <WhereToWatch items={watchGuides} />

      <SectionRule />

      {/* 8. Celebrity */}
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

      <div className="my-12 flex justify-center lg:my-14">
        <AdSlot format="billboard" />
      </div>

      <NewsletterBand />
    </div>
  );
}

// The matted feature frame — image double-matted inside a 1px ink border (spec §C1).
function MattedCard({ article }: { article: Article }) {
  const href = `/${article.category}/${article.slug}/`;
  const cat = getCategory(article.category);
  return (
    <article className="group">
      <Link href={href} className="block border border-ink p-1">
        <div className="overflow-hidden">
          <PlaceholderImage
            slug={article.slug}
            category={article.category}
            title={article.title}
            src={article.image}
            alt={article.imageAlt}
            className="aspect-video w-full transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none"
          />
        </div>
      </Link>
      <div className="mt-3 text-center">
        <div className="flex items-baseline justify-center gap-2.5">
          <Link href={`/${article.category}/`} className="kicker">
            {cat?.name}
          </Link>
          <time dateTime={article.date} className="meta-mono">
            {formatRelative(article.date)}
          </time>
        </div>
        <h3 className="hed-l mt-2 transition-colors duration-150 group-hover:text-red">
          <Link href={href}>{article.title}</Link>
        </h3>
        {article.dek ? (
          <p className="dek mx-auto mt-2 line-clamp-2 max-w-md text-base leading-snug">
            {article.dek}
          </p>
        ) : null}
      </div>
    </article>
  );
}
