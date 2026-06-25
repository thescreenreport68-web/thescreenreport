import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import { getAuthor, getCategory } from "@/lib/site";
import type { Article } from "@/lib/articles";

type Variant = "hero" | "large" | "standard" | "compact" | "list";

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
      <article className="flex gap-4 border-b border-dotted border-slate py-4 last:border-0">
        <Link href={href} className="shrink-0">
          <PlaceholderImage
            slug={article.slug}
            category={article.category}
            title={article.title}
            src={article.image}
            alt={article.imageAlt}
            className="aspect-square w-24 sm:w-28"
          />
        </Link>
        <div>
          <Link href={`/${article.category}/`} className="kicker">
            {cat?.name}
          </Link>
          <h3 className="mt-1 font-body text-base font-normal leading-snug text-navy hover:text-breaking">
            <Link href={href}>{article.title}</Link>
          </h3>
          <p className="mt-1 meta-label">By {author?.name}</p>
        </div>
      </article>
    );
  }

  const sizeClass =
    variant === "hero"
      ? "text-2xl sm:text-[1.7rem]"
      : variant === "large"
        ? "text-xl sm:text-2xl"
        : "text-lg";
  return (
    <article className="group flex flex-col">
      <Link href={href}>
        <PlaceholderImage
          slug={article.slug}
          category={article.category}
          title={article.title}
          src={article.image}
          alt={article.imageAlt}
          className="aspect-video w-full"
        />
      </Link>
      <div className="mt-2.5">
        <Link href={`/${article.category}/`} className="kicker">
          {cat?.name}
        </Link>
        <h3
          className={`mt-1.5 font-body font-normal leading-[1.15] text-navy group-hover:text-breaking ${sizeClass}`}
        >
          <Link href={href}>{article.title}</Link>
        </h3>
        {variant !== "compact" && article.dek ? (
          <p className="mt-2 line-clamp-2 dek">{article.dek}</p>
        ) : null}
        <p className="mt-2 meta-label">By {author?.name}</p>
      </div>
    </article>
  );
}
