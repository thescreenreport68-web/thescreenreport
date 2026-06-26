import ArticleCard from "./ArticleCard";
import AdSlot from "./AdSlot";
import JsonLd from "./JsonLd";
import Breadcrumbs from "./Breadcrumbs";
import { getArticlesBySubcategory } from "@/lib/articles";
import { getCategory, SITE, type Subcategory } from "@/lib/site";

export default function SubcategoryArchive({
  category,
  sub,
}: {
  category: string;
  sub: Subcategory;
}) {
  const cat = getCategory(category);
  const articles = getArticlesBySubcategory(category, sub.slug);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${sub.name} — ${cat?.name}`,
    url: `${SITE.url}/${category}/${sub.slug}/`,
    isPartOf: { "@type": "WebSite", name: SITE.name, url: SITE.url },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: articles.map((a, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE.url}/${a.category}/${a.slug}/`,
        name: a.title,
      })),
    },
  };

  return (
    <div className="container-wide py-8">
      <JsonLd data={jsonLd} />
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { href: `/${category}/`, label: cat?.name ?? "" },
        ]}
      />
      <header className="mt-1 border-b-2 border-navy pb-4">
        <span className="kicker">{cat?.name}</span>
        <h1 className="mt-1 font-display text-4xl font-bold uppercase tracking-tight text-navy sm:text-5xl">
          {sub.name}
        </h1>
      </header>

      <div className="my-6 flex justify-center">
        <AdSlot format="leaderboard" className="hidden md:flex" />
        <AdSlot format="rectangle" className="md:hidden" />
      </div>

      {articles.length ? (
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((a) => (
            <ArticleCard key={a.slug} article={a} variant="standard" />
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-slate">
          More {sub.name} coverage is on the way.
        </p>
      )}
    </div>
  );
}
