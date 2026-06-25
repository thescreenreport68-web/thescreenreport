import Link from "next/link";
import { getCategory } from "@/lib/site";
import { formatTime } from "@/lib/format";
import type { Article } from "@/lib/articles";

// THR-style stacked list: red category kicker + grey timestamp, standard-serif
// headline, 1px dotted #5A5A5A dividers, optional red ranking numerals.
export default function DottedList({
  items,
  showKicker = true,
  numbered = false,
  showTime = false,
}: {
  items: Article[];
  showKicker?: boolean;
  numbered?: boolean;
  showTime?: boolean;
}) {
  return (
    <ol className="divide-y divide-dotted divide-slate">
      {items.map((a, i) => {
        const cat = getCategory(a.category);
        return (
          <li key={a.slug} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            {numbered ? (
              <span className="font-display text-2xl font-bold leading-none text-breaking">
                {i + 1}
              </span>
            ) : null}
            <div>
              {showKicker || showTime ? (
                <div className="mb-1 flex items-center gap-2">
                  {showKicker ? (
                    <span className="font-sans text-[11px] font-bold uppercase tracking-[0.04em] text-breaking">
                      {cat?.name} News
                    </span>
                  ) : null}
                  {showTime ? (
                    <span className="font-sans text-[11px] font-bold uppercase tracking-[0.04em] text-slate">
                      {formatTime(a.date)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <h3 className="font-body text-[1.05rem] font-normal leading-[1.2] text-navy hover:text-breaking">
                <Link href={`/${a.category}/${a.slug}/`}>{a.title}</Link>
              </h3>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
