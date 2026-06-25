import Link from "next/link";
import SectionHeader from "./SectionHeader";
import { AUTHORS } from "@/lib/site";
import { getArticlesByAuthor } from "@/lib/articles";

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2);
}

// THR "Featured Voices": columnist headshot + their latest headline.
export default function FeaturedVoices() {
  const voices = AUTHORS.map((a) => ({
    author: a,
    article: getArticlesByAuthor(a.slug)[0],
  })).filter((v) => v.article);

  if (!voices.length) return null;

  return (
    <section>
      <SectionHeader title="Featured Voices" />
      <div className="grid gap-6 sm:grid-cols-3">
        {voices.map(({ author, article }) => (
          <div key={author.slug} className="flex gap-3 border-t border-navy/10 pt-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-navy font-display text-base font-semibold text-white">
              {initials(author.name)}
            </span>
            <div>
              <Link
                href={`/author/${author.slug}/`}
                className="font-sans text-[11px] font-bold uppercase tracking-wide text-gold-600"
              >
                {author.name}
              </Link>
              <h4 className="mt-1 font-body text-base font-normal leading-snug text-navy hover:text-breaking">
                <Link href={`/${article.category}/${article.slug}/`}>
                  {article.title}
                </Link>
              </h4>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
