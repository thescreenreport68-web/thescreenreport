import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import { getCategory } from "@/lib/site";
import { formatRelative } from "@/lib/format";
import type { Article } from "@/lib/articles";

export default function FeatureLead({
  article,
  size = "md",
}: {
  article: Article;
  size?: "md" | "lg";
}) {
  const href = `/${article.category}/${article.slug}/`;
  const cat = getCategory(article.category);
  return (
    <article className="group">
      <Link href={href} className="block overflow-hidden">
        <PlaceholderImage
          slug={article.slug}
          category={article.category}
          title={article.title}
          src={article.image}
          alt={article.imageAlt}
          className="aspect-video w-full transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none"
        />
      </Link>
      <div className="mt-3">
        <div className="flex items-baseline gap-2.5">
          <Link href={`/${article.category}/`} className="kicker">
            {cat?.name}
          </Link>
          <time dateTime={article.date} className="meta-mono">
            {formatRelative(article.date)}
          </time>
        </div>
        <h3
          className={`mt-2 transition-colors duration-150 group-hover:text-red ${
            size === "lg" ? "hed-l sm:text-[28px]" : "hed-l"
          }`}
        >
          <Link href={href}>{article.title}</Link>
        </h3>
        {article.dek ? (
          <p className="dek mt-2 line-clamp-2 text-base leading-snug">{article.dek}</p>
        ) : null}
      </div>
    </article>
  );
}
