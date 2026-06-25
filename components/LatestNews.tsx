import Link from "next/link";
import AdSlot from "./AdSlot";
import { getCategory } from "@/lib/site";
import { formatTime } from "@/lib/format";
import type { Article } from "@/lib/articles";

// The Hollywood Reporter "LATEST NEWS" rail: red category label + bold timestamp,
// a substantial serif headline, dotted dividers, and an ad interleaved after a few items.
export default function LatestNews({ items }: { items: Article[] }) {
  return (
    <div>
      <div className="mb-3 border-b border-navy/15 pb-2">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-navy">
          Latest News
        </h2>
      </div>
      <ol>
        {items.map((a, i) => {
          const cat = getCategory(a.category);
          return (
            <li key={a.slug}>
              <article className="border-b border-dotted border-navy/30 py-4 first:pt-1">
                <div className="mb-1.5 flex items-center gap-2.5">
                  <span className="font-sans text-[11px] font-bold uppercase tracking-[0.08em] text-breaking">
                    {cat?.name} News
                  </span>
                  <span className="font-sans text-[11px] font-bold uppercase tracking-[0.04em] text-navy">
                    {formatTime(a.date)}
                  </span>
                </div>
                <h3 className="font-body text-[1.05rem] font-normal leading-[1.35] text-navy hover:text-navy/70">
                  <Link href={`/${a.category}/${a.slug}/`}>{a.title}</Link>
                </h3>
              </article>
              {i === 2 ? (
                <div className="border-b border-dotted border-navy/30 py-5">
                  <div className="mb-2 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-navy/40">
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
