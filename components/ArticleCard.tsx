import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import { formatDate } from "@/lib/format";
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
      <article className="flex gap-4 border-b border-navy/10 py-4 last:border-0">
        <Link href={href} className="shrink-0">
          <PlaceholderImage
            slug={article.slug}
            category={article.category}
            title={article.title}
            className="aspect-video w-28 rounded sm:w-36"
          />
        </Link>
        <div>
          <Link
            href={`/${article.category}/`}
            className="text-[11px] font-bold uppercase tracking-wider text-gold-600"
          >
            {cat?.name}
          </Link>
          <h3 className="mt-1 font-serif text-base font-semibold leading-snug text-navy hover:underline sm:text-lg">
            <Link href={href}>{article.title}</Link>
          </h3>
          <p className="mt-1 text-xs text-navy/50">
            {author?.name} · {formatDate(article.date)}
          </p>
        </div>
      </article>
    );
  }

  const heroish = variant === "hero" || variant === "large";
  return (
    <article className="group flex flex-col">
      <Link href={href}>
        <PlaceholderImage
          slug={article.slug}
          category={article.category}
          title={article.title}
          showTitle={variant === "hero"}
          className={`${heroish ? "aspect-[16/9]" : "aspect-[16/10]"} w-full rounded`}
        />
      </Link>
      <div className="mt-3">
        <Link
          href={`/${article.category}/`}
          className="text-[11px] font-bold uppercase tracking-wider text-gold-600"
        >
          {cat?.name}
        </Link>
        <h3
          className={`mt-1 font-serif font-semibold leading-tight text-navy group-hover:underline ${
            variant === "hero"
              ? "text-2xl sm:text-3xl"
              : variant === "large"
                ? "text-xl sm:text-2xl"
                : "text-lg"
          }`}
        >
          <Link href={href}>{article.title}</Link>
        </h3>
        {variant !== "compact" && article.dek ? (
          <p className="mt-2 line-clamp-2 text-sm text-navy/60">{article.dek}</p>
        ) : null}
        <p className="mt-2 text-xs text-navy/50">
          {author?.name} · {formatDate(article.date)} · {article.readingTime} min read
        </p>
      </div>
    </article>
  );
}
