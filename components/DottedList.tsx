import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import TrendingBadge from "./TrendingBadge";
import { getCategory } from "@/lib/site";
import { formatRelative } from "@/lib/format";
import type { Article } from "@/lib/articles";

// Stacked list over dotted separators. Numbered mode hangs display-face numerals
// in 30% ink with #1 in red (spec §C5/F7). On mobile every item carries a square
// thumbnail (plan §6); ≥lg the list goes text-only for rail density.
export default function DottedList({
  items,
  showKicker = true,
  numbered = false,
  showTime = false,
  mobileThumbs = true,
}: {
  items: Article[];
  showKicker?: boolean;
  numbered?: boolean;
  showTime?: boolean;
  mobileThumbs?: boolean;
}) {
  return (
    <ol className="divide-y divide-dotted divide-gray">
      {items.map((a, i) => {
        const cat = getCategory(a.category);
        return (
          <li key={a.slug} className="group flex gap-4 py-3.5 first:pt-0 last:pb-0">
            {numbered ? (
              <span
                aria-hidden
                className={`w-8 shrink-0 text-right font-display text-[2.25rem] font-bold leading-[0.8] ${
                  i === 0 ? "text-red" : "text-ink/30"
                }`}
              >
                {i + 1}
              </span>
            ) : null}
            {mobileThumbs ? (
              <Link
                href={`/${a.category}/${a.slug}/`}
                className="block shrink-0 self-start overflow-hidden lg:hidden"
              >
                <PlaceholderImage
                  slug={a.slug}
                  category={a.category}
                  title={a.title}
                  src={a.image}
                  alt={a.imageAlt}
                  className="aspect-square w-[72px] transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none"
                />
              </Link>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-baseline gap-2.5 empty:mb-0">
                <TrendingBadge article={a} />
                {showKicker ? (
                  <Link href={`/${a.category}/`} className="kicker">
                    {cat?.name}
                  </Link>
                ) : null}
                {showTime ? (
                  <time dateTime={a.date} className="meta-mono">
                    {formatRelative(a.date)}
                  </time>
                ) : null}
              </div>
              <h3 className="hed-s transition-colors duration-150 group-hover:text-red">
                <Link href={`/${a.category}/${a.slug}/`}>{a.title}</Link>
              </h3>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
