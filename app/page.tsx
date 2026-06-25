import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import AdSlot from "@/components/AdSlot";
import SectionHeading from "@/components/SectionHeading";
import NewsletterBand from "@/components/NewsletterBand";
import {
  getAllArticles,
  getArticlesByCategory,
  getFeatured,
} from "@/lib/articles";
import { CATEGORIES } from "@/lib/site";

export default function HomePage() {
  const all = getAllArticles();
  const featured = getFeatured();
  const trending = all.slice(0, 5);
  const secondary = all.filter((a) => a.slug !== featured?.slug).slice(0, 4);

  if (!all.length) {
    return (
      <div className="container-wide py-20 text-center text-navy/60">
        <h1 className="font-serif text-3xl font-bold text-navy">
          The Screen Report
        </h1>
        <p className="mt-3">Stories are on the way.</p>
      </div>
    );
  }

  return (
    <div className="container-wide py-6">
      <div className="mb-8 hidden md:block">
        <AdSlot format="billboard" />
      </div>

      {/* Hero + Trending rail */}
      <section className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {featured ? <ArticleCard article={featured} variant="hero" /> : null}
        </div>
        <aside className="lg:col-span-1">
          <div className="section-heading">
            <h2>Trending Now</h2>
          </div>
          <ol className="space-y-4">
            {trending.map((a, i) => (
              <li
                key={a.slug}
                className="flex gap-3 border-b border-navy/10 pb-4 last:border-0"
              >
                <span className="font-serif text-2xl font-bold leading-none text-gold">
                  {i + 1}
                </span>
                <h3 className="font-serif text-base font-semibold leading-snug text-navy hover:underline">
                  <Link href={`/${a.category}/${a.slug}/`}>{a.title}</Link>
                </h3>
              </li>
            ))}
          </ol>
          <div className="mt-6">
            <AdSlot format="rectangle" />
          </div>
        </aside>
      </section>

      {/* Latest */}
      <section className="mt-12">
        <SectionHeading title="Latest Stories" />
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {secondary.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      </section>

      <div className="my-10 hidden md:block">
        <AdSlot format="leaderboard" />
      </div>

      {/* Category rivers */}
      {CATEGORIES.map((cat) => {
        const items = getArticlesByCategory(cat.slug).slice(0, 4);
        if (!items.length) return null;
        return (
          <section key={cat.slug} className="mt-12">
            <SectionHeading title={cat.name} href={`/${cat.slug}/`} />
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {items.map((a) => (
                <ArticleCard key={a.slug} article={a} variant="standard" />
              ))}
            </div>
          </section>
        );
      })}

      <NewsletterBand />
    </div>
  );
}
