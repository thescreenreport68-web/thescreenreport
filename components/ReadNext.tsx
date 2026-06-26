import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import type { Article } from "@/lib/articles";

// Inline contextual recirculation unit — recirculation drives ~41% of news pageviews,
// so we surface a "Read Next" story mid-article to lift pages/session + dwell time.
export default function ReadNext({ articles }: { articles?: Article[] }) {
  if (!articles?.length) return null;
  return (
    <aside className="not-prose my-9 border-y-2 border-navy py-4">
      <div className="mb-3 font-sans text-xs font-bold uppercase tracking-[0.14em] text-breaking">
        Read Next
      </div>
      <div className="space-y-4">
        {articles.map((a) => (
          <Link
            key={a.slug}
            href={`/${a.category}/${a.slug}/`}
            className="group flex items-center gap-4"
          >
            <PlaceholderImage
              slug={a.slug}
              category={a.category}
              title={a.title}
              src={a.image}
              alt={a.imageAlt}
              width={a.imageWidth}
              height={a.imageHeight}
              className="aspect-[4/3] w-24 shrink-0 sm:w-32"
            />
            <h3 className="font-body text-lg font-normal leading-snug text-navy group-hover:text-breaking sm:text-xl">
              {a.title}
            </h3>
          </Link>
        ))}
      </div>
    </aside>
  );
}
