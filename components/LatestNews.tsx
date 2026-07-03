import Link from "next/link";
import AdSlot from "./AdSlot";
import PlaceholderImage from "./PlaceholderImage";
import TrendingBadge from "./TrendingBadge";
import { getCategory } from "@/lib/site";
import { formatRelative } from "@/lib/format";
import type { Article } from "@/lib/articles";

// "LATEST NEWS" rail (spec §C1): 2px ink rule + condensed-display title; items
// carry a square thumbnail on mobile (plan §6) and go text-only ≥lg where the
// rail narrows to 332px beside the hero; kicker + mono relative time; dotted
// separators; a 300x250 after item 3; the red-inversion MORE NEWS button.
export default function LatestNews({ items }: { items: Article[] }) {
  return (
    <div className="border-t-2 border-ink">
      <div className="border-b border-hair pb-2 pt-2.5">
        <h2 className="sect-head text-2xl lg:text-2xl">Latest News</h2>
      </div>
      <ol>
        {items.map((a, i) => {
          const cat = getCategory(a.category);
          return (
            <li key={a.slug}>
              <article className="group flex gap-3.5 border-b border-dotted border-gray py-3">
                <Link
                  href={`/${a.category}/${a.slug}/`}
                  className="block shrink-0 overflow-hidden lg:hidden"
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
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2.5">
                    <TrendingBadge article={a} />
                    <Link href={`/${a.category}/`} className="kicker">
                      {cat?.name}
                    </Link>
                    <time dateTime={a.date} className="meta-mono">
                      {formatRelative(a.date)}
                    </time>
                  </div>
                  <h3 className="hed-s mt-1.5 transition-colors duration-150 group-hover:text-red">
                    <Link href={`/${a.category}/${a.slug}/`}>{a.title}</Link>
                  </h3>
                </div>
              </article>
              {i === 2 ? (
                <div className="border-b border-dotted border-gray py-5">
                  <AdSlot format="rectangle" />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <Link
        href="/news/"
        className="btn-label mt-5 block w-full border border-red py-3 text-center text-red transition-colors duration-150 hover:bg-red hover:text-paper"
      >
        More News +
      </Link>
    </div>
  );
}
