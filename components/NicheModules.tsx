import type { Article } from "@/lib/articles";

/* Per-niche UI modules, rendered on top of the shared article base.
   Each article only carries the fields for its own niche, so the dispatchers
   (NicheTop / NicheBottom) simply render whatever structured data is present. */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 font-sans text-xs font-bold uppercase tracking-[0.14em] text-breaking">
      {children}
    </div>
  );
}

/* ---------- Reviews ---------- */
function RatingBadge({ rating }: { rating: NonNullable<Article["rating"]> }) {
  return (
    <div className="flex flex-none flex-col items-center justify-center border-2 border-breaking px-4 py-2 text-center">
      <span className="font-display text-3xl font-bold leading-none text-breaking">
        {rating.score}
        <span className="text-lg text-slate">/{rating.max}</span>
      </span>
      {rating.label ? (
        <span className="mt-1 font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-navy">
          {rating.label}
        </span>
      ) : null}
    </div>
  );
}

function VerdictBox({ article }: { article: Article }) {
  if (!article.verdict && !article.rating) return null;
  return (
    <aside className="my-6 flex items-center gap-5 border-y-2 border-navy py-4">
      {article.rating ? <RatingBadge rating={article.rating} /> : null}
      <div>
        <SectionLabel>The Verdict</SectionLabel>
        <p className="font-body text-xl leading-snug text-navy sm:text-2xl">
          {article.verdict}
        </p>
      </div>
    </aside>
  );
}

function ProsCons({ prosCons }: { prosCons: NonNullable<Article["prosCons"]> }) {
  const { pros = [], cons = [] } = prosCons;
  if (!pros.length && !cons.length) return null;
  return (
    <div className="my-6 grid gap-4 border border-hair bg-mist/30 p-5 sm:grid-cols-2">
      <div>
        <div className="mb-2 font-sans text-xs font-bold uppercase tracking-[0.1em] text-navy">
          ✓ What Works
        </div>
        <ul className="space-y-1.5">
          {pros.map((p, i) => (
            <li key={i} className="font-body text-[1.02rem] leading-snug text-navy">{p}</li>
          ))}
        </ul>
      </div>
      <div className="sm:border-l sm:border-hair sm:pl-4">
        <div className="mb-2 font-sans text-xs font-bold uppercase tracking-[0.1em] text-slate">
          ✕ What Doesn&apos;t
        </div>
        <ul className="space-y-1.5">
          {cons.map((c, i) => (
            <li key={i} className="font-body text-[1.02rem] leading-snug text-slate">{c}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function InfoCard({ infoCard }: { infoCard: NonNullable<Article["infoCard"]> }) {
  const rows: [string, string | undefined][] = [
    ["Director", infoCard.director],
    ["Starring", infoCard.cast?.join(", ")],
    ["Release", infoCard.releaseYear],
    ["Runtime", infoCard.runtime],
    ["Rated", infoCard.rated],
    ["Genre", infoCard.genre],
    ["Where to Watch", infoCard.whereToWatch],
  ].filter(([, v]) => v) as [string, string][];
  if (!rows.length) return null;
  return (
    <div className="my-6 border border-hair p-5">
      <SectionLabel>The Details</SectionLabel>
      <dl className="divide-y divide-hair">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 py-1.5">
            <dt className="w-32 flex-none font-sans text-xs font-bold uppercase tracking-[0.04em] text-slate">{k}</dt>
            <dd className="font-body text-[1.02rem] text-navy">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------- Explainers ---------- */
function SpoilerBanner({ article }: { article: Article }) {
  if (!article.spoiler) return null;
  return (
    <div className="my-5 border-l-4 border-breaking bg-breaking/5 px-4 py-3 font-sans text-sm font-bold uppercase tracking-[0.06em] text-breaking">
      ⚠ Spoiler warning — major plot details ahead
    </div>
  );
}

function TLDR({ article }: { article: Article }) {
  if (!article.tldr) return null;
  return (
    <aside className="my-6 border border-hair bg-mist/40 p-5">
      <SectionLabel>The Short Version</SectionLabel>
      <p className="font-body text-lg leading-snug text-navy">{article.tldr}</p>
    </aside>
  );
}

/* ---------- Rankings ---------- */
function RankingList({ entries }: { entries: NonNullable<Article["entries"]> }) {
  if (!entries?.length) return null;
  const ordered = [...entries].sort((a, b) => a.rank - b.rank);
  return (
    <aside className="my-6 border border-hair p-5">
      <SectionLabel>The Ranking at a Glance</SectionLabel>
      <ol className="space-y-2">
        {ordered.map((e) => (
          <li key={e.rank} className="flex gap-3">
            <span className="w-7 flex-none font-display text-xl font-bold leading-tight text-breaking">{e.rank}</span>
            <span className="font-body text-[1.05rem] leading-snug text-navy">
              <span className="font-semibold">{e.title}</span>
              {e.year ? <span className="text-slate"> ({e.year})</span> : null}
              {e.blurb ? <span className="text-slate"> — {e.blurb}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

/* ---------- Profiles ---------- */
function FactPanel({ factPanel }: { factPanel: NonNullable<Article["factPanel"]> }) {
  const rows: [string, string | undefined][] = [
    ["Born", factPanel.born],
    ["From", factPanel.nationality],
    ["Active", factPanel.activeYears],
    ["Known For", factPanel.knownFor?.join(", ")],
  ].filter(([, v]) => v) as [string, string][];
  if (!rows.length) return null;
  return (
    <div className="my-6 border border-hair p-5">
      <SectionLabel>At a Glance</SectionLabel>
      <dl className="divide-y divide-hair">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 py-1.5">
            <dt className="w-28 flex-none font-sans text-xs font-bold uppercase tracking-[0.04em] text-slate">{k}</dt>
            <dd className="font-body text-[1.02rem] text-navy">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Filmography({ filmography }: { filmography: NonNullable<Article["filmography"]> }) {
  if (!filmography?.length) return null;
  return (
    <section className="mt-10 not-prose">
      <div className="mb-3 border-b-2 border-navy pb-1">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-navy">Full Filmography</h2>
      </div>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-hair font-sans text-[11px] uppercase tracking-[0.06em] text-slate">
            <th className="py-2 pr-3">Year</th>
            <th className="py-2 pr-3">Title</th>
            <th className="py-2 pr-3">Role</th>
            <th className="py-2">Type</th>
          </tr>
        </thead>
        <tbody>
          {filmography.map((f, i) => (
            <tr key={i} className="border-b border-dotted border-slate/40 align-top">
              <td className="py-2 pr-3 font-sans text-sm text-slate">{f.year || "—"}</td>
              <td className="py-2 pr-3 font-body text-[1.02rem] font-semibold text-navy">{f.title}</td>
              <td className="py-2 pr-3 font-body text-[1.02rem] text-navy">{f.role || "—"}</td>
              <td className="py-2 font-sans text-xs uppercase tracking-[0.04em] text-slate">{f.type || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ---------- Guides ---------- */
function WhereToWatchTable({ whereToWatch }: { whereToWatch: NonNullable<Article["whereToWatch"]> }) {
  if (!whereToWatch?.length) return null;
  return (
    <aside className="my-6 not-prose border border-hair p-5">
      <SectionLabel>Where to Watch</SectionLabel>
      <table className="w-full border-collapse text-left">
        <tbody>
          {whereToWatch.map((w, i) => (
            <tr key={i} className="border-b border-dotted border-slate/40 last:border-0">
              <td className="py-2 pr-3 font-body text-[1.02rem] font-semibold text-navy">
                {w.title}{w.year ? <span className="font-normal text-slate"> ({w.year})</span> : null}
              </td>
              <td className="py-2 pr-3 font-body text-[1.02rem] text-navy">{w.platform}</td>
              <td className="py-2 font-sans text-xs uppercase tracking-[0.04em] text-slate">{w.type || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}

/* ---------- Dispatchers ---------- */
// Rendered above the article body (after the hero, before the prose).
export function NicheTop({ article }: { article: Article }) {
  return (
    <>
      <SpoilerBanner article={article} />
      <VerdictBox article={article} />
      <TLDR article={article} />
      {article.factPanel ? <FactPanel factPanel={article.factPanel} /> : null}
      {article.infoCard ? <InfoCard infoCard={article.infoCard} /> : null}
      {article.whereToWatch?.length ? <WhereToWatchTable whereToWatch={article.whereToWatch} /> : null}
      {article.entries?.length ? <RankingList entries={article.entries} /> : null}
      {article.prosCons ? <ProsCons prosCons={article.prosCons} /> : null}
    </>
  );
}

// Rendered after the article body (long tables that belong at the end).
export function NicheBottom({ article }: { article: Article }) {
  return <>{article.filmography?.length ? <Filmography filmography={article.filmography} /> : null}</>;
}
