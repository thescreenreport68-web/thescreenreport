import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import type { Article } from "@/lib/articles";

// Inline contextual recirculation unit — recirculation drives ~41% of news pageviews,
// so we surface a "Read Next" story mid-article to lift pages/session + dwell time.
export default function ReadNext({ articles }: { articles?: Article[] }) {
  if (!articles?.length) return null;
  return (
    <aside className="not-prose my-9 border-y-2 border-ink py-4">
      <div className="kicker mb-3">Read Next</div>
      <div className="space-y-4">
        {articles.map((a) => (
          <Link
            key={a.slug}
            href={`/${a.category}/${a.slug}/`}
            className="group flex items-center gap-4"
          >
            <span className="shrink-0 overflow-hidden">
              <PlaceholderImage
                slug={a.slug}
                category={a.category}
                title={a.title}
                src={a.image}
                alt={a.imageAlt}
                width={a.imageWidth}
                height={a.imageHeight}
                className="aspect-[4/3] w-24 transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none sm:w-32"
              />
            </span>
            <h3 className="hed-m text-lg transition-colors duration-150 group-hover:text-red sm:text-xl">
              {a.title}
            </h3>
          </Link>
        ))}
      </div>
    </aside>
  );
}
