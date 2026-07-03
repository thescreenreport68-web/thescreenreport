import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import SectionHeader from "./SectionHeader";
import { getAuthor } from "@/lib/site";
import type { Article } from "@/lib/articles";

function ReviewItem({ a }: { a: Article }) {
  const author = getAuthor(a.author);
  const href = `/${a.category}/${a.slug}/`;
  return (
    <article className="group flex gap-4 border-b border-dotted border-gray py-4 first:pt-0 last:border-0">
      <Link href={href} className="shrink-0 overflow-hidden">
        <PlaceholderImage
          slug={a.slug}
          category={a.category}
          title={a.title}
          src={a.image}
          alt={a.imageAlt}
          className="aspect-square w-24 transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none sm:w-28"
        />
      </Link>
      <div>
        <h4 className="hed-m transition-colors duration-150 group-hover:text-red">
          <Link href={href}>{a.title}</Link>
        </h4>
        <p className="byline mt-2">
          By <span className="text-ink">{author?.name}</span>
        </p>
      </div>
    </article>
  );
}

function ColumnHead({ label, href }: { label: string; href: string }) {
  return (
    <div className="mb-3 border-b border-hair pb-1.5">
      <Link
        href={href}
        className="font-sans text-[13px] font-bold uppercase tracking-[0.14em] text-red transition-colors duration-150 hover:text-red-dark"
      >
        {label}
      </Link>
    </div>
  );
}

export default function ReviewsSplit({
  movies,
  tv,
}: {
  movies: Article[];
  tv: Article[];
}) {
  if (!movies.length && !tv.length) return null;
  return (
    <section>
      <SectionHeader title="Reviews" tagline="Verdicts you can trust" href="/reviews/" />
      <div className="grid gap-10 md:grid-cols-2 md:gap-0 md:divide-x md:divide-hair">
        <div className="md:pr-8">
          <ColumnHead label="Movies" href="/reviews/movie-reviews/" />
          {movies.map((a) => (
            <ReviewItem key={a.slug} a={a} />
          ))}
        </div>
        <div className="md:pl-8">
          <ColumnHead label="TV" href="/reviews/tv-reviews/" />
          {tv.map((a) => (
            <ReviewItem key={a.slug} a={a} />
          ))}
        </div>
      </div>
    </section>
  );
}
