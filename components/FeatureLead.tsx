import Link from "next/link";
import PlaceholderImage from "./PlaceholderImage";
import { getCategory } from "@/lib/site";
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
        <span className="kicker">{cat?.name}</span>
        <h3
          className={`mt-1.5 font-body font-normal leading-[1.15] text-navy group-hover:text-breaking ${
            size === "lg" ? "text-2xl sm:text-[1.7rem]" : "text-xl sm:text-[1.4rem]"
          }`}
        >
          <Link href={href}>{article.title}</Link>
        </h3>
        {article.dek ? (
          <p className="mt-2 line-clamp-2 dek">{article.dek}</p>
        ) : null}
      </div>
    </article>
  );
}
