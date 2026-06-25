import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import SectionHeader from "./SectionHeader";
import { getAuthor } from "@/lib/site";
import type { Article } from "@/lib/articles";

function ReviewItem({ a }: { a: Article }) {
  const author = getAuthor(a.author);
  const href = `/${a.category}/${a.slug}/`;
  return (
    <article className="flex gap-4 border-b border-dotted border-slate py-4 first:pt-0 last:border-0">
      <Link href={href} className="shrink-0">
        <PlaceholderImage
          slug={a.slug}
          category={a.category}
          title={a.title}
          src={a.image}
          alt={a.imageAlt}
          className="aspect-square w-24 sm:w-28"
        />
      </Link>
      <div>
        <h4 className="font-body text-lg font-normal leading-[1.2] text-navy hover:text-breaking">
          <Link href={href}>{a.title}</Link>
        </h4>
        <p className="mt-1 meta-label">By {author?.name}</p>
      </div>
    </article>
  );
}

function ColumnHead({ label }: { label: string }) {
  return (
    <div className="mb-2 border-b border-hair pb-1">
      <h3 className="font-sans text-sm font-bold uppercase tracking-[0.04em] text-breaking">
        {label}
      </h3>
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
