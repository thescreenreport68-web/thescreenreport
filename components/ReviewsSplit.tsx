import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import SectionHeader from "./SectionHeader";
import { getAuthor } from "@/lib/site";
import type { Article } from "@/lib/articles";

function ReviewItem({ a }: { a: Article }) {
  const author = getAuthor(a.author);
  const href = `/${a.category}/${a.slug}/`;
  return (
    <article className="flex gap-4 border-b border-dotted border-navy/30 py-4 first:pt-0 last:border-0">
      <Link href={href} className="shrink-0">
        <PlaceholderImage
          slug={a.slug}
          category={a.category}
          title={a.title}
          className="aspect-[4/3] w-24 rounded ring-1 ring-navy/10 sm:w-28"
        />
      </Link>
      <div>
        <h4 className="font-display text-lg font-semibold leading-snug text-navy hover:text-navy/70">
          <Link href={href}>{a.title}</Link>
        </h4>
        <p className="mt-1 font-sans text-[11px] font-semibold uppercase tracking-wide text-faint">
          By {author?.name}
        </p>
      </div>
    </article>
  );
}

function ColumnHead({ label }: { label: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between border-b border-navy/10 pb-1">
      <h3 className="font-sans text-sm font-bold uppercase tracking-[0.14em] text-breaking">
        {label}
      </h3>
      <Link
        href="/reviews/"
        className="font-sans text-[11px] font-bold uppercase tracking-wide text-faint hover:text-navy"
      >
        See all
      </Link>
    </div>
  );
}

// THR "Reviews" block: split into Movies / TV columns with red sub-labels.
export default function ReviewsSplit({
  movies,
  tv,
}: {
  movies: Article[];
  tv: Article[];
}) {
  return (
    <section>
      <SectionHeader title="Reviews" tagline="Verdicts you can trust" href="/reviews/" />
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <ColumnHead label="Movies" />
          {movies.map((a) => (
            <ReviewItem key={a.slug} a={a} />
          ))}
        </div>
        <div>
          <ColumnHead label="TV" />
          {tv.map((a) => (
            <ReviewItem key={a.slug} a={a} />
          ))}
        </div>
      </div>
    </section>
  );
}
