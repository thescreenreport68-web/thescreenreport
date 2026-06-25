import Link from "next/link";
import { getCategory } from "@/lib/site";
import type { Article } from "@/lib/articles";

// THR-style stacked headline list with dotted dividers, red category kickers,
// and optional ranking numerals (for "Most Popular").
export default function DottedList({
  items,
  showKicker = true,
  numbered = false,
}: {
  items: Article[];
  showKicker?: boolean;
  numbered?: boolean;
}) {
  return (
    <ol className="divide-y divide-dotted divide-navy/30">
      {items.map((a, i) => {
        const cat = getCategory(a.category);
        return (
          <li key={a.slug} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            {numbered ? (
              <span className="font-display text-xl font-semibold leading-none text-gold">
                {i + 1}
              </span>
            ) : null}
            <div>
              {showKicker ? (
                <span className="font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-breaking">
                  {cat?.name}
                </span>
              ) : null}
              <h3 className="font-display text-base font-semibold leading-snug text-navy hover:text-navy/70">
                <Link href={`/${a.category}/${a.slug}/`}>{a.title}</Link>
              </h3>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
