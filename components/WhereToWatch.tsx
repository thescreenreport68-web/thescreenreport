import Link from "next/link";
import SectionHeader from "./SectionHeader";
import PlaceholderImage from "./PlaceholderImage";
import type { Article } from "@/lib/articles";

// "Where to Watch" — fed by real watch-guide articles (formatTag guide/watchguide).
// A ceremonial band framed by 2px ink rules; self-hides when no guides exist.
export default function WhereToWatch({ items }: { items: Article[] }) {
  if (!items.length) return null;
  return (
    <section className="border-y-2 border-ink py-8">
      <SectionHeader
        title="Where to Watch"
        tagline="Stream it tonight"
        href="/streaming/where-to-watch/"
      />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {items.slice(0, 4).map((a) => (
          <article key={a.slug} className="group">
            <Link
              href={`/${a.category}/${a.slug}/`}
              className="block overflow-hidden"
            >
              <PlaceholderImage
                slug={a.slug}
                category={a.category}
                title={a.title}
                src={a.image}
                alt={a.imageAlt}
                className="aspect-video w-full transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none"
              />
            </Link>
            <h3 className="hed-m mt-2.5 transition-colors duration-150 group-hover:text-red">
              <Link href={`/${a.category}/${a.slug}/`}>{a.title}</Link>
            </h3>
            {a.whereToWatch?.[0]?.platform ? (
              <p className="kicker mt-2">
                {a.whereToWatch[0].type === "rent" ? "Rent on" : "Stream on"}{" "}
                {a.whereToWatch[0].platform}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
