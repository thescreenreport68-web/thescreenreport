import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import SectionHeader from "./SectionHeader";
import { formatRelative } from "@/lib/format";
import type { Article } from "@/lib/articles";

function Play({ large = false }: { large?: boolean }) {
  const size = large ? "h-14 w-14" : "h-8 w-8";
  return (
    <span
      aria-hidden
      className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-paper/90 bg-ink/40 ${size}`}
    >
      <span
        className={`ml-0.5 border-y-transparent border-l-white ${
          large ? "border-y-[8px] border-l-[13px]" : "border-y-[5px] border-l-[8px]"
        }`}
        style={{ borderStyle: "solid", borderRightWidth: 0 }}
      />
    </span>
  );
}

// "Latest Trailers" — fed by real trailer articles (they embed the official
// YouTube video). Self-hides below 2 items; no fake content (spec §C4).
export default function FeaturedVideos({ items }: { items: Article[] }) {
  if (items.length < 2) return null;
  const [lead, ...rest] = items.slice(0, 5);
  return (
    <section>
      <SectionHeader title="Latest Trailers" href="/movies/trailers/" />
      <div className="grid gap-6 lg:grid-cols-3">
        <article className="group lg:col-span-2">
          <Link
            href={`/${lead.category}/${lead.slug}/`}
            className="block overflow-hidden"
          >
            <div className="relative">
              <PlaceholderImage
                slug={lead.slug}
                category={lead.category}
                title={lead.title}
                src={lead.image}
                alt={lead.imageAlt}
                className="aspect-video w-full transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none"
              />
              <Play large />
            </div>
          </Link>
          <div className="mt-3 flex items-baseline gap-2.5">
            <span className="kicker">Trailer</span>
            <time dateTime={lead.date} className="meta-mono">
              {formatRelative(lead.date)}
            </time>
          </div>
          <h3 className="hed-l mt-2 transition-colors duration-150 group-hover:text-red">
            <Link href={`/${lead.category}/${lead.slug}/`}>{lead.title}</Link>
          </h3>
        </article>
        <div className="divide-y divide-dotted divide-gray">
          {rest.map((v) => (
            <article key={v.slug} className="group flex gap-3 py-3 first:pt-0 last:pb-0">
              <Link
                href={`/${v.category}/${v.slug}/`}
                className="relative shrink-0 overflow-hidden"
              >
                <PlaceholderImage
                  slug={v.slug}
                  category={v.category}
                  title={v.title}
                  src={v.image}
                  alt={v.imageAlt}
                  className="aspect-video w-28 transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none"
                />
                <Play />
              </Link>
              <h4 className="hed-s transition-colors duration-150 group-hover:text-red">
                <Link href={`/${v.category}/${v.slug}/`}>{v.title}</Link>
              </h4>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
