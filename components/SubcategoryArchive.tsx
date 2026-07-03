import AdSlot from "./AdSlot";
import JsonLd from "./JsonLd";
import Breadcrumbs from "./Breadcrumbs";
import { ArchiveMasthead, RiverItem } from "./ArchiveRiver";
import { getArticlesBySubcategory } from "@/lib/articles";
import {
  getCategory,
  getSubcategoriesForCategory,
  SITE,
  type Subcategory,
} from "@/lib/site";

export default function SubcategoryArchive({
  category,
  sub,
}: {
  category: string;
  sub: Subcategory;
}) {
  const cat = getCategory(category);
  const articles = getArticlesBySubcategory(category, sub.slug);
  const subs = getSubcategoriesForCategory(category);

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
      <ArchiveMasthead
        kicker={cat?.name}
        title={sub.name}
        subnav={subs.map((s) => ({
          name: s.name,
          href: `/${category}/${s.slug}/`,
        }))}
        active={`/${category}/${sub.slug}/`}
      />

      <div className="my-6 flex justify-center">
        <AdSlot format="leaderboard" className="hidden md:flex" />
        <AdSlot format="rectangle" className="md:hidden" />
      </div>

      {articles.length ? (
        <div className="mx-auto max-w-4xl">
          {articles.map((a) => (
            <RiverItem key={a.slug} article={a} />
          ))}
        </div>
      ) : (
        <p className="dek py-16 text-center">
          More {sub.name} coverage is on the way.
        </p>
      )}
    </div>
  );
}
