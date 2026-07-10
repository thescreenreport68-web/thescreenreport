import type { Metadata } from "next";
import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import AdSlot from "@/components/AdSlot";
import SectionHeader from "@/components/SectionHeader";
import DottedList from "@/components/DottedList";
import LatestNews from "@/components/LatestNews";
import TwoColumnFeature from "@/components/TwoColumnFeature";
import FeaturedVideos from "@/components/FeaturedVideos";
import NewsletterBand from "@/components/NewsletterBand";
import PlaceholderImage from "@/components/PlaceholderImage";
import TrendingBadge from "@/components/TrendingBadge";
import { getAuthor, getCategory } from "@/lib/site";
import { formatRelative } from "@/lib/format";
import type { Article } from "@/lib/articles";
import { getAllArticles, getArticlesByCategory } from "@/lib/articles";
import { HOMEPAGE, pickHero, byHeat, pickDiverse, trendingRail } from "@/lib/homepage";

// The homepage is two lanes by design (owner 2026-07-04): ~60% latest & trending
// NEWS (movies-led) and ~40% celebrity GOSSIP. News sections draw ONLY from the
// news categories below (so celebrity can never leak into a news slot), and the
// gossip zone draws ONLY from celebrity. Streaming / Reviews / Awards are held OUT
// of the homepage until an automation feeds them (they stay in the top nav).
const HOMEPAGE_NEWS_CATEGORIES = ["movies", "tv", "music"];
function newsPool(all: Article[]): Article[] {
  return all.filter((a) => HOMEPAGE_NEWS_CATEGORIES.includes(a.category));
}

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
  // Self-referencing canonical for the homepage. OG/Twitter images intentionally
  // inherit the stable branded /og.png from the root layout — a hotlinked hero
  // image can hotlink-block or 404, breaking every social share of the homepage.
  return { alternates: { canonical: "/" } };
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
  // ---- the two lanes ----
  const news = newsPool(all); // movies + tv + music (60% zone)
  const gossip = getArticlesByCategory("celebrity"); // celebrity (40% zone)
  const movies = getArticlesByCategory("movies");
  const tv = getArticlesByCategory("tv");
  const music = getArticlesByCategory("music");
  const theatrical = movies.filter(
    (a) => a.subcategory !== "box-office" && a.formatTag !== "box-office"
  );
  const boxOfficePool = movies.filter(
    (a) => a.subcategory === "box-office" || a.formatTag === "box-office"
  );
  const trailers = news.filter((a) => a.formatTag === "trailer");

  // ---- slot assembly: heat-ranked pulls, deduped by slug AND event across the
  // whole page via `used`. Every pool is category-pure, so backfill can never
  // mislabel a card (a news slot only ever borrows another news story). ----
  const hero = pickHero(news.length ? news : all, now);
  const heroCat = getCategory(hero.category);
  const heroAuthor = getAuthor(hero.author);

  const used = { slugs: new Set<string>([hero.slug]), events: new Set<string>() };
  if (hero.eventSlug) used.events.add(hero.eventSlug);
  // Backfill guard: pickDiverse never repeats, so thin pools may under-fill. The
  // backfill pool matches the section's own category so labels stay honest.
  const fill = (
    picked: Article[],
    pool: Article[],
    n: number,
    u: { slugs: Set<string>; events: Set<string> } = used
  ): Article[] => {
    if (picked.length >= n) return picked;
    const have = new Set(picked.map((a) => a.slug));
    const extra = pool
      .filter((a) => !have.has(a.slug) && !u.slugs.has(a.slug))
      .slice(0, n - picked.length);
    extra.forEach((a) => u.slugs.add(a.slug));
    return [...picked, ...extra];
  };

  // Sub-leads: next-hottest news with art, max 2 per category.
  const subLeads = fill(
    pickDiverse(byHeat(news.filter((a) => a.image), now, HOMEPAGE.GRAVITY_HOT), 3, used, 2),
    news.filter((a) => a.image),
    3
  );
  // Latest rail: chronology within news, capped so no single category monopolizes.
  // "Latest" rail = the freshest stories across EVERY category (incl. celebrity),
  // newest-first, capped 4/category — so whatever the automation drops (news OR
  // gossip) surfaces at the top immediately, not only in its zone further down.
  const latest = fill(pickDiverse(all, 12, used, 4), all, 12);

  // In Theaters (movies, non-box-office) + Box Office (movies box-office) — the
  // movies-first two-column block that replaces the stale "Now Streaming".
  const inTheaters = {
    title: "In Theaters",
    tagline: "The films everyone's talking about",
    href: "/movies/",
    lead: fill(pickDiverse(byHeat(theatrical, now, HOMEPAGE.GRAVITY_BALANCED), 1, used), theatrical, 1)[0],
    rest: fill(pickDiverse(byHeat(theatrical, now, HOMEPAGE.GRAVITY_BALANCED), 3, used), theatrical, 3),
  };
  const boxOffice = {
    title: "Box Office",
    tagline: "Who's winning the weekend",
    href: "/movies/box-office/",
    lead: fill(pickDiverse(byHeat(boxOfficePool, now, HOMEPAGE.GRAVITY_BALANCED), 1, used), boxOfficePool, 1)[0],
    rest: fill(pickDiverse(byHeat(boxOfficePool, now, HOMEPAGE.GRAVITY_BALANCED), 3, used), boxOfficePool, 3),
  };
  const hasBoxOffice = !!boxOffice.lead;

  // What We're Watching — TV only (no streaming/celebrity bleed).
  const whatWatching = fill(
    pickDiverse(byHeat(tv, now, HOMEPAGE.GRAVITY_BALANCED), 4, used),
    tv,
    4
  );

  // Trending rail: ranked news, deduped vs the hero package (may repeat a Latest
  // item — rank-order vs time-order are different claims), excluded from grids below.
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

  // Music strip (high-interest swap-in).
  const musicRow = fill(
    pickDiverse(byHeat(music, now, HOMEPAGE.GRAVITY_BALANCED), 4, used),
    music,
    4
  );

  // ---- GOSSIP ZONE (~40%): its own dedup space (disjoint from news). eventSlug
  // dedup collapses single-event floods (e.g. one wedding card, not twenty). ----
  const gUsed = { slugs: new Set<string>(), events: new Set<string>() };
  const gossipLead = pickDiverse(
    byHeat(gossip.filter((a) => a.image), now, HOMEPAGE.GRAVITY_HOT),
    1,
    gUsed
  )[0];
  const gossipSide = fill(
    pickDiverse(byHeat(gossip, now, HOMEPAGE.GRAVITY_BALANCED), 4, gUsed),
    gossip,
    4,
    gUsed
  );
  const gossipGrid = fill(
    pickDiverse(byHeat(gossip, now, HOMEPAGE.GRAVITY_BALANCED), 4, gUsed),
    gossip,
    4,
    gUsed
  );

  return (
    <div className="container-wide py-8">
      {/* ===================== NEWS ZONE (~60%) ===================== */}
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
                <TrendingBadge article={hero} />
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

      {/* 2. Movies-first two-column: In Theaters + Box Office */}
      {hasBoxOffice ? (
        <TwoColumnFeature left={inTheaters} right={boxOffice} />
      ) : (
        <section>
          <SectionHeader
            title="In Theaters"
            tagline="The films everyone's talking about"
            href="/movies/"
          />
          <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {[inTheaters.lead, ...inTheaters.rest].filter(Boolean).map((a) => (
              <ArticleCard key={a!.slug} article={a!} variant="standard" />
            ))}
          </div>
        </section>
      )}

      <SectionRule />

      {/* 3. What We're Watching (TV) */}
      {whatWatching.length ? (
        <section>
          <SectionHeader title="What We're Watching" tagline="Spoilers ahead!" href="/tv/" />
          <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {whatWatching.map((a) => (
              <ArticleCard key={a.slug} article={a} variant="standard" />
            ))}
          </div>
        </section>
      ) : null}

      <AdBreak />

      {/* 4. Latest Trailers + Trending News rail */}
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
        <div>
          <FeaturedVideos items={trailers} />
        </div>
        <aside>
          <div className="border-t-2 border-ink">
            <div className="flex items-baseline gap-2.5 border-b border-hair pb-2 pt-2.5">
              <h2 className="sect-head text-2xl lg:text-2xl">
                {rail.mode === "trending"
                  ? "Trending Now"
                  : rail.mode === "popular"
                    ? "Most Popular"
                    : "More Top Stories"}
              </h2>
              {rail.mode === "trending" ? <span className="dot-live" aria-hidden /> : null}
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

      {/* 5. Music */}
      {musicRow.length ? (
        <>
          <SectionRule />
          <section>
            <SectionHeader
              title="Music"
              tagline="Pop stars, soundtracks and the Grammys"
              href="/music/"
            />
            <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {musicRow.map((a) => (
                <ArticleCard key={a.slug} article={a} variant="standard" />
              ))}
            </div>
          </section>
        </>
      ) : null}

      <AdBreak />

      {/* ===================== GOSSIP ZONE (~40%) ===================== */}
      {gossipLead ? (
        <section>
          <SectionHeader
            title="Celebrity"
            tagline="The stars, the drama, the buzz"
            href="/celebrity/"
          />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-10">
            <ArticleCard article={gossipLead} variant="large" />
            {gossipSide.length ? (
              <div className="border-t-2 border-ink pt-4 lg:border-l lg:border-t-0 lg:border-hair lg:pl-8 lg:pt-0">
                <DottedList items={gossipSide} showKicker={false} showTime />
              </div>
            ) : null}
          </div>
          {gossipGrid.length ? (
            <div className="mt-10 grid gap-x-5 gap-y-8 border-t border-dotted border-gray pt-8 sm:grid-cols-2 lg:grid-cols-4">
              {gossipGrid.map((a) => (
                <ArticleCard key={a.slug} article={a} variant="standard" />
              ))}
            </div>
          ) : null}
          <Link
            href="/celebrity/"
            className="btn-label mt-8 block w-full border border-red py-3 text-center text-red transition-colors duration-150 hover:bg-red hover:text-paper md:mx-auto md:w-[300px]"
          >
            More Celebrity +
          </Link>
        </section>
      ) : null}

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
