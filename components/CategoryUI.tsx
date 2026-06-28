import type { Article } from "@/lib/articles";

/* Per-category UI/UX overhaul (2026-06-28): the distinctive, form-specific modules the playbook calls for,
   that the existing NicheModules didn't yet cover. All server components (no client JS — works on `next export`)
   and each guards on its own field, returning null when absent so any un-filled form degrades to the shared shell. */

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 font-sans text-xs font-bold uppercase tracking-[0.14em] text-breaking">{children}</div>;
}

/* CATEGORY KICKER — a linked eyebrow ("MOVIES · RANKINGS") above the H1 that instantly distinguishes each
   category/subcategory and links to the hub. Replaces the news-only red badge for non-news forms. */
export function CategoryKicker({ href, categoryName, subName }: { href: string; categoryName: string; subName?: string }) {
  return (
    <a href={href} className="mt-2 inline-block font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-breaking hover:underline">
      {categoryName}
      {subName ? <span className="text-slate"> · {subName}</span> : null}
    </a>
  );
}

/* RANKING ENTRIES — the rankings spine: an oversized rank numeral + anchored <h2 id="rank-N"> + a per-entry
   spec card (Director/Cast/Runtime/Year/Where) + the case. Renders only when entries carry the rich fields. */
export function RankingEntries({ entries }: { entries: NonNullable<Article["entries"]> }) {
  const rich = entries.some((e) => e.whyHere || e.director || e.runtime || e.whereToWatch || e.cast?.length);
  if (!entries.length || !rich) return null;
  const ordered = [...entries].sort((a, b) => a.rank - b.rank);
  return (
    <section className="mt-10 not-prose">
      <div className="mb-4 border-b-2 border-navy pb-1">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-navy">The Ranking</h2>
      </div>
      {ordered.map((e) => {
        const spec = ([["Director", e.director], ["Cast", e.cast?.join(", ")], ["Runtime", e.runtime], ["Year", e.year], ["Where to Watch", e.whereToWatch]] as [string, string | undefined][]).filter(([, v]) => v) as [string, string][];
        return (
          <article key={e.rank} id={`rank-${e.rank}`} className="mb-9 scroll-mt-24 border-t border-hair pt-4">
            <div className="flex items-start gap-4">
              <span className="font-display text-5xl font-bold leading-[0.8] text-breaking sm:text-6xl">{e.rank}</span>
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-2xl font-bold leading-tight text-navy sm:text-[1.7rem]">
                  {e.title}
                  {e.year ? <span className="font-normal text-slate"> ({e.year})</span> : null}
                  {e.verdictTier ? <span className="ml-2 inline-block bg-mist px-1.5 py-0.5 align-middle font-sans text-[10px] font-bold uppercase tracking-[0.08em] text-breaking">{e.verdictTier}</span> : null}
                </h3>
                {e.whyHere ? <p className="mt-1 font-body text-lg italic leading-snug text-navy">{e.whyHere}</p> : null}
                {spec.length ? (
                  <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1.5 sm:grid-cols-3">
                    {spec.map(([k, v]) => (
                      <div key={k} className="border-l-2 border-hair pl-2">
                        <dt className="font-sans text-[10px] font-bold uppercase tracking-[0.05em] text-slate">{k}</dt>
                        <dd className="font-body text-[0.98rem] leading-snug text-navy">{v}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {e.blurb ? <p className="mt-3 font-body text-[1.05rem] leading-relaxed text-navy">{e.blurb}</p> : null}
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}

/* TOP 5 STRIP — a quick at-a-glance #1..#5 row near the top of a ranking / best-of. */
export function TopFiveStrip({ topFive }: { topFive: NonNullable<Article["topFive"]> }) {
  if (!topFive?.length) return null;
  return (
    <aside className="my-6 not-prose border-y-2 border-navy py-4">
      <Label>The Top 5 at a Glance</Label>
      <ol className="flex flex-wrap gap-x-6 gap-y-1">
        {topFive.slice(0, 5).map((t, i) => (
          <li key={i} className="font-body text-[1.05rem] text-navy">
            <span className="font-display font-bold text-breaking">{i + 1}.</span> {t}
          </li>
        ))}
      </ol>
    </aside>
  );
}

/* BEST-OF ENTRIES — verdict-tier-forward pick cards (streaming best-of "WATCH IT / WORTH A LOOK / SKIP IT"). */
export function BestOfEntries({ entries }: { entries: NonNullable<Article["entries"]> }) {
  const rich = entries.some((e) => e.verdictTier || e.bestFor);
  if (!entries.length || !rich) return null;
  const ordered = [...entries].sort((a, b) => a.rank - b.rank);
  const tierClass = (t?: string) => (/skip/i.test(t || "") ? "text-slate" : /look/i.test(t || "") ? "text-navy" : "text-breaking");
  return (
    <section className="mt-8 not-prose space-y-6">
      {ordered.map((e) => (
        <article key={e.rank} id={`pick-${e.rank}`} className="scroll-mt-24 border border-hair p-5">
          <div className="flex items-baseline justify-between gap-3 border-b border-hair pb-2">
            <h2 className="font-display text-xl font-bold text-navy sm:text-2xl">
              <span className="text-breaking">{e.rank}.</span> {e.title}
              {e.year ? <span className="font-normal text-slate"> ({e.year})</span> : null}
            </h2>
            {e.verdictTier ? <span className={"flex-none font-sans text-xs font-bold uppercase tracking-[0.08em] " + tierClass(e.verdictTier)}>{e.verdictTier}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 font-sans text-xs text-slate">
            {e.bestFor ? <span><b className="text-navy">Best for:</b> {e.bestFor}</span> : null}
            {e.runtime ? <span>{e.runtime}</span> : null}
            {e.whereToWatch ? <span>▶ {e.whereToWatch}</span> : null}
          </div>
          {e.blurb ? <p className="mt-2 font-body text-[1.05rem] leading-relaxed text-navy">{e.blurb}</p> : null}
        </article>
      ))}
    </section>
  );
}

/* WEEKEND BOX-OFFICE CHART — the multi-film top-chart table that defines a box-office report. */
export function WeekendChart({ weekendChart }: { weekendChart: NonNullable<Article["weekendChart"]> }) {
  if (!weekendChart?.length) return null;
  return (
    <aside className="my-6 not-prose border border-hair">
      <div className="border-b border-hair bg-mist/40 px-4 py-2"><Label>The Weekend Box Office</Label></div>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-hair font-sans text-[10px] uppercase tracking-[0.06em] text-slate">
            <th className="px-4 py-2">#</th>
            <th className="px-2 py-2">Film</th>
            <th className="px-2 py-2 text-right">Weekend</th>
            <th className="px-4 py-2 text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          {weekendChart.map((r, i) => (
            <tr key={i} className="border-b border-dotted border-slate/30 last:border-0">
              <td className="px-4 py-2 font-display text-lg font-bold text-breaking">{r.rank ?? i + 1}</td>
              <td className="px-2 py-2 font-body text-[1.02rem] font-semibold text-navy">{r.title}</td>
              <td className="px-2 py-2 text-right font-body text-[1.02rem] text-navy">{r.gross || "—"}</td>
              <td className="px-4 py-2 text-right font-sans text-sm text-slate">{r.change || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}

/* TRAILER REVEAL SPINE — the official synopsis (quarantined) + the numbered "what the trailer reveals" list. */
export function RevealSpine({ article }: { article: Article }) {
  if (!article.reveals?.length && !article.officialSynopsis) return null;
  return (
    <div className="my-6 not-prose">
      {article.officialSynopsis ? (
        <div className="mb-5 border-l-4 border-hair bg-mist/30 px-4 py-3">
          <Label>The Official Synopsis</Label>
          <p className="font-body text-[1.05rem] italic leading-snug text-navy">{article.officialSynopsis}</p>
        </div>
      ) : null}
      {article.reveals?.length ? (
        <>
          <Label>What the Trailer Reveals</Label>
          <ol className="space-y-3">
            {article.reveals.map((r, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-display text-xl font-bold leading-tight text-breaking">{i + 1}</span>
                <span className="font-body text-[1.05rem] leading-snug text-navy">
                  <b>{r.term}</b>
                  {r.note ? <span className="text-slate"> — {r.note}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
}

/* READING-MODE BOX — the explainer's "Just the facts" answer-first box + a quick version, above the full read. */
export function ReadingModeBox({ article }: { article: Article }) {
  const rm = article.readingModes;
  if (!rm?.justFacts?.length && !rm?.quickVersion) return null;
  return (
    <aside className="my-6 border border-hair bg-mist/40 p-5">
      <Label>Just the Facts</Label>
      {rm.justFacts?.length ? (
        <ul className="space-y-1.5">
          {rm.justFacts.map((f, i) => (
            <li key={i} className="flex gap-2 font-body text-[1.05rem] leading-snug text-navy">
              <span className="flex-none font-bold text-breaking">→</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rm.quickVersion ? <p className="mt-3 border-t border-hair pt-3 font-body text-lg leading-snug text-navy">{rm.quickVersion}</p> : null}
    </aside>
  );
}
