import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import TrendingBadge from "./TrendingBadge";
import { getAuthor, getCategory } from "@/lib/site";
import { formatRelative } from "@/lib/format";
import type { Article } from "@/lib/articles";

export const RIVER_PAGE_SIZE = 12;

// Page 1 of a category archive shows the lead package (1 + 3) before the river.
export const ARCHIVE_LEAD_COUNT = 4;

// One river row (spec §E): 16:9 thumb left, meta row → display headline →
// clamped dek → byline, over dotted separators.
export function RiverItem({ article }: { article: Article }) {
  const href = `/${article.category}/${article.slug}/`;
  const cat = getCategory(article.category);
  const author = getAuthor(article.author);
  return (
    <article className="group grid gap-4 border-b border-dotted border-gray py-6 first:pt-0 md:grid-cols-[13rem_1fr] md:gap-5 xl:grid-cols-[18rem_1fr]">
      <Link href={href} className="block self-start overflow-hidden">
        <PlaceholderImage
          slug={article.slug}
          category={article.category}
          title={article.title}
          src={article.image}
          alt={article.imageAlt}
          className="aspect-video w-full transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none"
        />
      </Link>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2.5">
          <TrendingBadge article={article} />
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
          <p className="mt-2 line-clamp-3 font-sans text-[15px] leading-normal text-slate">
            {article.dek}
          </p>
        ) : null}
        <p className="byline mt-2.5">
          By <span className="text-ink">{author?.name}</span>
        </p>
      </div>
    </article>
  );
}

// Archive masthead: uppercase display H1 + optional blurb + scrollable subnav strip.
export function ArchiveMasthead({
  kicker,
  title,
  blurb,
  subnav,
  active,
}: {
  kicker?: string;
  title: string;
  blurb?: string;
  subnav?: { name: string; href: string }[];
  active?: string;
}) {
  return (
    <header className="border-b border-gray">
      {kicker ? <span className="kicker">{kicker}</span> : null}
      <h1 className="mt-1 font-display text-[30px] font-bold uppercase leading-none tracking-tight text-ink sm:text-[44px] xl:text-[50px]">
        {title}
      </h1>
      {blurb ? <p className="dek mt-3 max-w-2xl text-base">{blurb}</p> : null}
      {subnav?.length ? (
        <nav
          aria-label={`${title} sections`}
          className="mt-5 overflow-x-auto whitespace-nowrap pb-3"
        >
          <div className="flex gap-6">
            {subnav.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className={`nav-link ${
                  active === s.href ? "text-red" : "text-slate"
                }`}
              >
                {s.name}
              </Link>
            ))}
          </div>
        </nav>
      ) : (
        <div className="pb-4" />
      )}
    </header>
  );
}

// Static pagination controls: mono page indicator + the one solid-red button.
export function RiverPagination({
  basePath,
  page,
  totalPages,
}: {
  basePath: string; // e.g. "/movies" — page 1 lives at basePath, page n at basePath/page/n/
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  const hrefFor = (n: number) => (n <= 1 ? `${basePath}/` : `${basePath}/page/${n}/`);
  const next = page < totalPages ? page + 1 : null;
  return (
    <nav aria-label="Pagination" className="mt-10 text-center">
      {next ? (
        <Link
          href={hrefFor(next)}
          className="btn-label inline-block w-full bg-red py-3.5 text-paper transition-colors duration-150 hover:bg-red-dark md:w-[300px]"
        >
          More Stories
        </Link>
      ) : null}
      <div className="meta-mono mt-4 flex items-center justify-center gap-4">
        {page > 1 ? (
          <Link
            href={hrefFor(page - 1)}
            className="transition-colors duration-150 hover:text-red"
          >
            ‹ Newer
          </Link>
        ) : null}
        <span className="text-ink">
          Page {page} of {totalPages}
        </span>
        {next ? (
          <Link
            href={hrefFor(next)}
            className="transition-colors duration-150 hover:text-red"
          >
            Older ›
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
