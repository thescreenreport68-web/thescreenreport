import type { Article } from "@/lib/articles";
import { SectionLabel } from "@/components/NicheModules";

/* Playbook per-form UI (CATEGORY_UIUX_EDITORIAL_PLAYBOOK.md Part 3). Each component guards on its own
   field, so an article only renders the modules for its form. On the shared design tokens. */

/* ---------- news: story-status badge + key-points TL;DR + sightings ---------- */
const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: "bg-ink text-white",
  DEVELOPING: "bg-red text-white",
  RUMOR: "border border-red text-red",
  HOLD: "border border-slate text-slate",
};
function StoryStatusBadge({ article }: { article: Article }) {
  const s = (article.storyStatus || "").toUpperCase();
  if (!STATUS_STYLE[s]) return null;
  return (
    <div className={`mb-3 inline-block px-2.5 py-1 font-sans text-[11px] font-bold uppercase tracking-[0.12em] ${STATUS_STYLE[s]}`}>
      {s === "DEVELOPING" ? "Developing Story" : s === "CONFIRMED" ? "Confirmed" : s === "RUMOR" ? "Unconfirmed Report" : "Holding for Confirmation"}
    </div>
  );
}
function KeyPointsBox({ article }: { article: Article }) {
  if (!article.keyPoints?.length) return null;
  return (
    <aside className="my-6 not-prose border border-hair p-5">
      <SectionLabel>The Key Points</SectionLabel>
      <ul className="space-y-1.5">
        {article.keyPoints.map((p, i) => (
          <li key={i} className="flex gap-2 font-body text-[1.05rem] leading-snug text-ink">
            <span className="flex-none font-bold text-red">▸</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
function Sightings({ article }: { article: Article }) {
  if (!article.sightings?.length) return null;
  return (
    <aside className="my-6 not-prose border-l-4 border-hair pl-4">
      <SectionLabel>On the Record</SectionLabel>
      <ul className="space-y-1">
        {article.sightings.map((s, i) => (
          <li key={i} className="font-body text-[1.02rem] leading-snug text-ink">
            <span className="font-semibold">{s.event}</span>
            {s.date ? <span className="text-slate"> — {s.date}</span> : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* ---------- tv: series-status spine + series-context card ---------- */
function SeriesStatusBox({ article }: { article: Article }) {
  const s = article.seriesStatus;
  if (!s?.show && !s?.status) return null;
  const rows: [string, string | undefined][] = [
    ["Show", s.show],
    ["Network", s.network],
    ["Status", s.status],
    ["Season", s.season],
    ["Window", s.window],
  ].filter(([, v]) => v) as [string, string][];
  return (
    <div className="my-6 not-prose border border-hair p-5">
      <SectionLabel>Series Status</SectionLabel>
      <dl className="divide-y divide-hair">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 py-1.5">
            <dt className="w-28 flex-none font-sans text-xs font-bold uppercase tracking-[0.04em] text-slate">{k}</dt>
            <dd className="font-body text-[1.02rem] text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {s.castAdded?.length ? (
        <div className="mt-3 border-t border-hair pt-3">
          <div className="mb-1 font-sans text-xs font-bold uppercase tracking-[0.04em] text-slate">Joining the cast</div>
          <ul className="space-y-0.5">
            {s.castAdded.map((c, i) => (
              <li key={i} className="font-body text-[1.02rem] text-ink">
                <span className="font-semibold">{c.name}</span>{c.role ? <span className="text-slate"> as {c.role}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
function SeriesContextCard({ article }: { article: Article }) {
  const s = article.seriesContext;
  if (!s) return null;
  const rows: [string, string | undefined][] = [
    ["Network", s.network],
    ["Premiered", s.premiere],
    ["Seasons", s.seasons],
    ["Created by", s.creator],
    ["Cast", s.cast?.join(", ")],
    ["Where to watch", s.whereToWatch],
  ].filter(([, v]) => v) as [string, string][];
  if (!rows.length) return null;
  return (
    <aside className="my-8 not-prose border border-hair p-5">
      <SectionLabel>The Series, in Brief</SectionLabel>
      <dl className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 py-0.5">
            <dt className="w-28 flex-none font-sans text-xs font-bold uppercase tracking-[0.04em] text-slate">{k}</dt>
            <dd className="font-body text-[1.02rem] text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/* ---------- reviews: full credits block ---------- */
function CreditsBlock({ article }: { article: Article }) {
  const c = article.credits;
  if (!c) return null;
  const rows: [string, string | undefined][] = [
    ["Distributor", c.distributor],
    ["Director", c.director],
    ["Screenplay", c.screenplay],
    ["Cinematography", c.dp],
    ["Editor", c.editor],
    ["Music", c.composer],
    ["Starring", c.cast?.join(", ")],
    ["Runtime", c.runtime],
    ["Rated", c.rated],
  ].filter(([, v]) => v) as [string, string][];
  if (!rows.length) return null;
  return (
    <section className="mt-10 not-prose border-t-2 border-ink pt-4">
      <SectionLabel>The Credits</SectionLabel>
      <dl className="divide-y divide-hair">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 py-1.5">
            <dt className="w-36 flex-none font-sans text-xs font-bold uppercase tracking-[0.04em] text-slate">{k}</dt>
            <dd className="font-body text-[1.02rem] text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ---------- watch-guide: deterministic verdict box + release windows ---------- */
function VerdictBoxWatch({ article }: { article: Article }) {
  const v = article.verdictBox;
  const w = article.releaseWindows;
  if (!v?.answer && !w) return null;
  const winRows = w
    ? ([
        ["In theaters", w.theatrical],
        ["Streaming", w.streaming || (w.streamingEstimated ? `${w.streamingEstimated} (estimated)` : undefined)],
        ["Digital", w.digital || (w.digitalEstimated ? `${w.digitalEstimated} (estimated)` : undefined)],
      ].filter(([, x]) => x) as [string, string][])
    : [];
  return (
    <aside className="my-6 not-prose border-2 border-ink p-5">
      <SectionLabel>Where to Watch — The Short Answer</SectionLabel>
      {v?.answer ? <p className="font-body text-xl leading-snug text-ink sm:text-2xl">{v.answer}</p> : null}
      {(v?.where || v?.when) ? (
        <p className="mt-1 font-sans text-sm text-slate">{[v?.where, v?.when].filter(Boolean).join(" · ")}</p>
      ) : null}
      {winRows.length ? (
        <dl className="mt-4 divide-y divide-hair border-t border-hair pt-2">
          {winRows.map(([k, val]) => (
            <div key={k} className="flex gap-3 py-1.5">
              <dt className="w-28 flex-none font-sans text-xs font-bold uppercase tracking-[0.04em] text-slate">{k}</dt>
              <dd className="font-body text-[1.02rem] text-ink">{val}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </aside>
  );
}

/* ---------- rankings: criterion intro + honorable mentions ---------- */
function Criterion({ article }: { article: Article }) {
  if (!article.criterion) return null;
  return (
    <aside className="my-5 not-prose border-l-4 border-red pl-4">
      <SectionLabel>How We Ranked Them</SectionLabel>
      <p className="font-body text-[1.05rem] leading-snug text-ink">{article.criterion}</p>
    </aside>
  );
}
function HonorableMentions({ article }: { article: Article }) {
  if (!article.honorableMentions?.length) return null;
  return (
    <aside className="my-8 not-prose border border-hair p-5">
      <SectionLabel>Honorable Mentions</SectionLabel>
      <ul className="space-y-1.5">
        {article.honorableMentions.map((m, i) => (
          <li key={i} className="font-body text-[1.02rem] leading-snug text-ink">
            <span className="font-semibold">{m.title}</span>
            {m.year ? <span className="text-slate"> ({m.year})</span> : null}
            {m.note ? <span className="text-slate"> — {m.note}</span> : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* ---------- awards: at-a-glance leaderboard ---------- */
function AtAGlancePanel({ article }: { article: Article }) {
  const a = article.atAGlance;
  if (!a?.leaderboard && !a?.biggestUpset && !a?.firsts) return null;
  const rows: [string, string | undefined][] = [
    ["Leaderboard", a.leaderboard],
    ["Biggest upset", a.biggestUpset],
    ["Firsts", a.firsts],
  ].filter(([, v]) => v) as [string, string][];
  return (
    <aside className="my-6 not-prose border-y-2 border-ink py-4">
      <SectionLabel>The Night at a Glance</SectionLabel>
      <dl className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <dt className="w-32 flex-none font-sans text-xs font-bold uppercase tracking-[0.04em] text-slate">{k}</dt>
            <dd className="font-body text-[1.05rem] text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/* ---------- predictions: verdict buckets + precursor timeline + bottom line ---------- */
const BUCKET_STYLE: Record<string, string> = {
  FRONTRUNNER: "border-red",
  "IN THE HUNT": "border-ink",
  "DARK HORSE": "border-slate",
  SNUB: "border-hair",
};
function VerdictBuckets({ article }: { article: Article }) {
  if (!article.verdictBuckets?.length) return null;
  return (
    <div className="my-6 not-prose grid gap-4 sm:grid-cols-2">
      {article.verdictBuckets.map((b, i) => (
        <div key={i} className={`border-l-4 pl-4 ${BUCKET_STYLE[(b.bucket || "").toUpperCase()] || "border-hair"}`}>
          <div className="font-sans text-[11px] font-bold uppercase tracking-[0.1em] text-red">{b.bucket}</div>
          <div className="font-body text-[1.05rem] font-semibold leading-snug text-ink">
            {b.name}{b.film ? <span className="font-normal text-slate"> — {b.film}</span> : null}
          </div>
          {b.case ? <div className="mt-0.5 font-body text-[1.02rem] leading-snug text-slate">{b.case}</div> : null}
        </div>
      ))}
    </div>
  );
}
function PrecursorTimeline({ article }: { article: Article }) {
  if (!article.precursorTimeline?.length && !article.bottomLine) return null;
  return (
    <section className="mt-10 not-prose">
      {article.precursorTimeline?.length ? (
        <>
          <SectionLabel>The Precursors So Far</SectionLabel>
          <ol className="space-y-1.5">
            {article.precursorTimeline.map((p, i) => (
              <li key={i} className="flex gap-3 font-body text-[1.05rem] leading-snug text-ink">
                <span className="w-32 flex-none font-sans text-xs font-bold uppercase tracking-[0.04em] text-slate">{p.body}</span>
                <span className="font-semibold">{p.winner}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {article.bottomLine ? (
        <p className="mt-5 border-t-2 border-ink pt-4 font-body text-xl leading-snug text-ink">
          <span className="font-sans text-xs font-bold uppercase tracking-[0.1em] text-red">The Bottom Line — </span>
          {article.bottomLine}
        </p>
      ) : null}
    </section>
  );
}

/* ---------- recap: loose threads ---------- */
function LooseThreads({ article }: { article: Article }) {
  if (!article.looseThreads?.length) return null;
  return (
    <aside className="my-8 not-prose border border-hair p-5">
      <SectionLabel>Loose Threads</SectionLabel>
      <ul className="space-y-1.5">
        {article.looseThreads.map((t, i) => (
          <li key={i} className="flex gap-2 font-body text-[1.02rem] leading-snug text-ink">
            <span className="flex-none text-red">▸</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* ---------- profile: career stats + methodology ---------- */
function CareerStats({ article }: { article: Article }) {
  if (!article.careerStats?.length && !article.methodology) return null;
  return (
    <div className="my-6 not-prose">
      {article.careerStats?.length ? (
        <div className="grid grid-cols-2 gap-px overflow-hidden border border-hair bg-hair sm:grid-cols-4">
          {article.careerStats.map((s, i) => (
            <div key={i} className="bg-white px-4 py-3 text-center">
              <div className="font-display text-2xl font-bold leading-tight text-ink">{s.value}</div>
              <div className="mt-0.5 font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-slate">{s.label}</div>
            </div>
          ))}
        </div>
      ) : null}
      {article.methodology ? (
        <p className="mt-2 font-sans text-xs italic text-slate">{article.methodology}</p>
      ) : null}
    </div>
  );
}

/* ---------- interview: glossary footnotes ---------- */
function Footnotes({ article }: { article: Article }) {
  if (!article.footnotes?.length) return null;
  return (
    <aside className="mt-10 not-prose border-t border-hair pt-4">
      <SectionLabel>Context</SectionLabel>
      <dl className="space-y-1.5">
        {article.footnotes.map((f, i) => (
          <div key={i} className="font-body text-[1.0rem] leading-snug">
            <dt className="inline font-semibold text-ink">{f.term}: </dt>
            <dd className="inline text-slate">{f.fact}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/* ---------- dispatchers ---------- */
export function PlaybookTop({ article }: { article: Article }) {
  return (
    <>
      <StoryStatusBadge article={article} />
      <KeyPointsBox article={article} />
      <SeriesStatusBox article={article} />
      <VerdictBoxWatch article={article} />
      <Criterion article={article} />
      <AtAGlancePanel article={article} />
      <VerdictBuckets article={article} />
      <CareerStats article={article} />
      <Sightings article={article} />
    </>
  );
}
export function PlaybookBottom({ article }: { article: Article }) {
  return (
    <>
      <SeriesContextCard article={article} />
      <CreditsBlock article={article} />
      <HonorableMentions article={article} />
      <PrecursorTimeline article={article} />
      <LooseThreads article={article} />
      <Footnotes article={article} />
    </>
  );
}
