import type { Article } from "@/lib/articles";

// Reader-facing transparency for reported/rumour stories: the confidence label, what is verified, and
// what is still open. The gossip pipeline has written rumorStatus / whatWeKnow / whatWeDont on every
// article since launch and nothing rendered them — the owner's "what we know vs what we don't" contract
// existed in the data and was shown to nobody.
// Renders NOTHING unless the article carries the fields, so other lanes are unaffected.
// Stroke grammar matches KeyTakeaways (spec §F3): hairline frame, kicker, red square markers.
export default function StoryConfidence({ article }: { article: Article }) {
  const known = (article.whatWeKnow || []).filter(Boolean);
  const unknown = (article.whatWeDont || []).filter(Boolean);
  const status = (article.rumorStatus || "").trim();
  if (!known.length && !unknown.length) return null;

  return (
    <aside className="not-prose my-7 border-y-2 border-ink py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="kicker">Where This Story Stands</h2>
        {status ? (
          <span className="font-body text-[0.8rem] uppercase tracking-wide text-red">{status}</span>
        ) : null}
      </div>

      {known.length ? (
        <div className="mt-3">
          <div className="font-body text-[0.82rem] uppercase tracking-wide text-slate">What we know</div>
          <ul className="mt-2 space-y-2">
            {known.map((t, i) => (
              <li key={`k${i}`} className="flex gap-3 font-body text-[1.02rem] leading-snug text-ink">
                <span aria-hidden className="mt-[0.45em] h-1.5 w-1.5 shrink-0 bg-red" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {unknown.length ? (
        <div className="mt-4">
          <div className="font-body text-[0.82rem] uppercase tracking-wide text-slate">What we don&rsquo;t</div>
          <ul className="mt-2 space-y-2">
            {unknown.map((t, i) => (
              <li key={`u${i}`} className="flex gap-3 font-body text-[1.02rem] leading-snug text-charcoal">
                <span aria-hidden className="mt-[0.45em] h-1.5 w-1.5 shrink-0 border border-gray" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
