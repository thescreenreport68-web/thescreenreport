import type { Article } from "@/lib/articles";

/* ------------------------------------------------------------------------------------------------
 * BOX-OFFICE lane modules.
 *
 * Owned by the box-office automation, mirroring how the inside lane owns InsideModules.tsx. Keeping
 * the lane's rendering here means adopting a site-wide treatment never requires editing a shared file
 * that every other lane also renders through — which is the discipline that has kept cross-lane
 * breakage out of this repo.
 * ---------------------------------------------------------------------------------------------- */

/**
 * The site-wide QUOTE UI, adopted for box-office articles.
 *
 * Same visual treatment the other lanes use: red left rule, large display italic, small-caps
 * attribution. It renders ONLY when the automation captured a quote AND verified it word-for-word
 * against the source it actually fetched (see pipeline/boxoffice/agents/gatherer.mjs — a quote that
 * cannot be found verbatim in the fetched text is discarded, never published).
 *
 * Box office is a numbers beat, so most articles legitimately have no quote. In that case this
 * renders nothing at all rather than showing an empty frame — the automation never manufactures a
 * quote to fill the design.
 */
export function BoxOfficePullQuote({ article }: { article: Article }) {
  const q = article.pullQuote;
  if (!q?.text) return null;
  return (
    <figure className="my-6 border-l-4 border-red pl-5 not-prose">
      <blockquote className="font-display text-2xl italic leading-snug text-ink sm:text-[1.7rem]">
        &ldquo;{q.text.trim().replace(/^["“”]+|["“”]+$/g, "")}&rdquo;
      </blockquote>
      {q.attribution ? (
        <figcaption className="mt-2 font-sans text-xs uppercase tracking-[0.08em] text-slate">
          — {q.attribution}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Everything the box-office lane renders above the article body. */
export default function BoxOfficeModules({ article }: { article: Article }) {
  if (article.formatTag !== "box-office" && article.formatTag !== "streaming") return null;
  return <BoxOfficePullQuote article={article} />;
}
