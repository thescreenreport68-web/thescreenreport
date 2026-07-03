import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import TrendingBadge from "./TrendingBadge";
import { getAuthor, getCategory } from "@/lib/site";
import { formatRelative } from "@/lib/format";
import type { Article } from "@/lib/articles";

type Variant = "hero" | "large" | "standard" | "compact" | "list";

// One card grammar (spec §C3/F1): image → kicker + mono timestamp → headline →
// dek → byline. Whole-card hover: headline warms to red, image scales 1.02.
export default function ArticleCard({
  article,
  variant = "standard",
}: {
  article: Article;
  variant?: Variant;
}) {
  const href = `/${article.category}/${article.slug}/`;
  const author = getAuthor(article.author);
  const cat = getCategory(article.category);

  if (variant === "list") {
    return (
      <article className="group flex gap-4 border-b border-dotted border-gray py-4 last:border-0">
        <Link href={href} className="shrink-0 overflow-hidden">
          <PlaceholderImage
            slug={article.slug}
            category={article.category}
            title={article.title}
            src={article.image}
            alt={article.imageAlt}
            className="aspect-square w-24 transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none sm:w-28"
          />
        </Link>
        <div>
          <div className="flex items-baseline gap-2.5">
            <TrendingBadge article={article} />
            <Link href={`/${article.category}/`} className="kicker">
              {cat?.name}
            </Link>
            <time dateTime={article.date} className="meta-mono">
              {formatRelative(article.date)}
            </time>
          </div>
          <h3 className="hed-s mt-1.5 transition-colors duration-150 group-hover:text-red">
            <Link href={href}>{article.title}</Link>
          </h3>
        </div>
      </article>
    );
  }

  const hedClass =
    variant === "hero"
      ? "hed-l sm:text-[28px]"
      : variant === "large"
        ? "hed-l"
        : "hed-m";
  return (
    <article className="group flex flex-col">
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
          <TrendingBadge article={article} />
          <Link href={`/${article.category}/`} className="kicker">
            {cat?.name}
          </Link>
          <time dateTime={article.date} className="meta-mono">
            {formatRelative(article.date)}
          </time>
        </div>
        <h3
          className={`${hedClass} mt-2 transition-colors duration-150 group-hover:text-red`}
        >
          <Link href={href}>{article.title}</Link>
        </h3>
        {variant !== "compact" && article.dek ? (
          <p className="dek mt-2 line-clamp-2 text-base leading-snug">{article.dek}</p>
        ) : null}
        <p className="byline mt-2">
          By <span className="text-ink">{author?.name}</span>
        </p>
      </div>
    </article>
  );
}
