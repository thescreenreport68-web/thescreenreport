import Link from "next/link";
import AdSlot from "./AdSlot";
import { getCategory } from "@/lib/site";
import { formatTime } from "@/lib/format";
import type { Article } from "@/lib/articles";

// THR "LATEST NEWS" rail: condensed-display uppercase title; each item = red
// category label + grey timestamp, standard-serif headline, 1px dotted #5A5A5A
// dividers, with a 300x250 ad after the 3rd item.
export default function LatestNews({ items }: { items: Article[] }) {
  return (
    <div>
      <div className="mb-2 border-b border-hair pb-2">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-navy sm:text-[1.8rem]">
          Latest News
        </h2>
      </div>
      <ol>
        {items.map((a, i) => {
          const cat = getCategory(a.category);
          return (
            <li key={a.slug}>
              <article className="border-b border-dotted border-slate py-3.5 first:pt-2">
                <div className="mb-1 flex items-center gap-2.5">
                  <span className="font-sans text-[11px] font-bold uppercase tracking-[0.04em] text-breaking">
                    {cat?.name} News
                  </span>
                  <span className="font-sans text-[11px] font-bold uppercase tracking-[0.04em] text-slate">
                    {formatTime(a.date)}
                  </span>
                </div>
                <h3 className="font-body text-[1.05rem] font-normal leading-[1.2] text-navy hover:text-breaking">
                  <Link href={`/${a.category}/${a.slug}/`}>{a.title}</Link>
                </h3>
              </article>
              {i === 2 ? (
                <div className="border-b border-dotted border-slate py-5">
                  <div className="mb-2 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate/60">
                    Advertisement
                  </div>
                  <AdSlot format="rectangle" />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
