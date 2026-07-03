import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import { getAllArticles } from "@/lib/articles";

export default function NotFound() {
  const latest = getAllArticles().slice(0, 3);
  return (
    <div className="container-wide py-16">
      <div className="text-center">
        <p className="font-display text-[96px] font-bold leading-none text-ink">
          404
        </p>
        <h1 className="hed-l mt-3">This story doesn&apos;t exist.</h1>
        <p className="dek mx-auto mt-2 max-w-md text-base">
          The page you&apos;re looking for may have moved or was never published.
        </p>
        <Link
          href="/"
          className="btn-label mt-6 inline-block bg-red px-6 py-3.5 text-paper transition-colors duration-150 hover:bg-red-dark"
        >
          Back to the Front Page
        </Link>
      </div>

      {latest.length ? (
        <section className="mt-16">
          <div className="mb-6 border-b-2 border-ink pb-2">
            <h2 className="sect-head">The Latest</h2>
          </div>
          <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {latest.map((a) => (
              <ArticleCard key={a.slug} article={a} variant="standard" />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
