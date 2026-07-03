import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import JsonLd from "@/components/JsonLd";
import { AUTHORS, getAuthor, SITE } from "@/lib/site";
import { getArticlesByAuthor } from "@/lib/articles";

export const dynamicParams = false;

export function generateStaticParams() {
  return AUTHORS.map((a) => ({ slug: a.slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const a = getAuthor(params.slug);
  if (!a) return {};
  return { title: `${a.name}, ${a.role}`, description: a.bio };
}

export default function AuthorPage({ params }: { params: { slug: string } }) {
  const a = getAuthor(params.slug);
  if (!a) notFound();
  const articles = getArticlesByAuthor(a.slug);

  const personLd = {
    "@context": "https://schema.org",
    "@type": a.type ?? "Person",
    name: a.name,
    description: a.bio,
    url: `${SITE.url}/author/${a.slug}/`,
    knowsAbout: ["Film", "Television", "Streaming", "Hollywood", "Celebrity"],
    ...(a.type === "Organization"
      ? { parentOrganization: { "@type": "Organization", name: SITE.name, url: SITE.url } }
      : {
          jobTitle: a.role,
          worksFor: { "@type": "Organization", name: SITE.name, url: SITE.url },
        }),
    ...(a.sameAs?.length ? { sameAs: a.sameAs } : {}),
  };

  return (
    <div className="container-wide py-10">
      <JsonLd data={personLd} />
      <header className="border-b border-gray pb-6">
        <span className="kicker">{a.role}</span>
        <h1 className="mt-2 font-display text-[30px] font-bold uppercase leading-none tracking-tight text-ink sm:text-[44px]">
          {a.name}
        </h1>
        <p className="dek mt-3 max-w-2xl text-base">{a.bio}</p>
        <p className="byline mt-4">
          <Link
            href="/editorial-standards/"
            className="transition-colors duration-150 hover:text-red"
          >
            Editorial Standards
          </Link>
          <span className="mx-2 text-gray" aria-hidden>
            /
          </span>
          <Link
            href="/corrections/"
            className="transition-colors duration-150 hover:text-red"
          >
            Corrections
          </Link>
        </p>
      </header>

      <div className="mt-8 grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((art) => (
          <ArticleCard key={art.slug} article={art} variant="standard" />
        ))}
      </div>
    </div>
  );
}
