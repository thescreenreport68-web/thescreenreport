import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import { getCategory } from "@/lib/site";
import type { Article } from "@/lib/articles";

// A lead story for a branded block: framed image + kicker + serif headline + dek.
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
      <Link href={href}>
        <PlaceholderImage
          slug={article.slug}
          category={article.category}
          title={article.title}
          className="aspect-[16/10] w-full rounded ring-1 ring-navy/10"
        />
      </Link>
      <div className="mt-3">
        <span className="kicker">{cat?.name}</span>
        <h3
          className={`mt-1.5 font-display font-semibold leading-[1.1] tracking-tight text-navy group-hover:text-navy/70 ${
            size === "lg" ? "text-2xl sm:text-[1.9rem]" : "text-xl sm:text-2xl"
          }`}
        >
          <Link href={href}>{article.title}</Link>
        </h3>
        {article.dek ? (
          <p className="mt-2 line-clamp-2 font-dek text-[1.02rem] italic leading-snug text-navy/65">
            {article.dek}
          </p>
        ) : null}
      </div>
    </article>
  );
}
