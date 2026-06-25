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
      <article className="flex gap-4 border-b border-hair py-4 last:border-0">
        <Link href={href} className="shrink-0">
          <PlaceholderImage
            slug={article.slug}
            category={article.category}
            title={article.title}
            className="aspect-video w-28 rounded sm:w-32"
          />
        </Link>
        <div>
          <Link href={`/${article.category}/`} className="kicker">
            {cat?.name}
          </Link>
          <h3 className="mt-1 font-display text-base font-semibold leading-snug text-navy hover:text-navy/70 sm:text-lg">
            <Link href={href}>{article.title}</Link>
          </h3>
          <p className="mt-1 font-sans text-xs text-faint">
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
          className={`${heroish ? "aspect-[16/9]" : "aspect-[16/10]"} w-full rounded`}
        />
      </Link>
      <div className="mt-3.5">
        <Link href={`/${article.category}/`} className="kicker">
          {cat?.name}
        </Link>
        <h3
          className={`mt-1.5 font-display font-semibold leading-[1.12] tracking-tight text-navy group-hover:text-navy/70 ${
            variant === "hero"
              ? "text-3xl sm:text-[2.5rem]"
              : variant === "large"
                ? "text-2xl"
                : "text-xl"
          }`}
        >
          <Link href={href}>{article.title}</Link>
        </h3>
        {variant !== "compact" && article.dek ? (
          <p className="mt-2 line-clamp-2 font-dek text-[1.02rem] italic leading-snug text-navy/65">
            {article.dek}
          </p>
        ) : null}
        <p className="mt-2.5 font-sans text-xs text-faint">
          {author?.name} · {formatDate(article.date)} · {article.readingTime} min read
        </p>
      </div>
    </article>
  );
}
