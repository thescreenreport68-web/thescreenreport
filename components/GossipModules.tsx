import type { Article } from "@/lib/articles";
import { SectionLabel } from "@/components/NicheModules";

/* Gossip per-article UI (formatTag === "gossip"). The rumor STATUS badge is already rendered by
   PlaybookModules' StoryStatusBadge (off `storyStatus`); these add the transparency modules that double as the
   legal shield: a "what we know vs. what's unconfirmed" box, a denial callout, and the AI-assistance disclosure
   with a report-a-problem link. Each guards on its own field, on the shared design tokens. */

function WhatWeKnowBox({ article }: { article: Article }) {
  const know = article.whatWeKnow ?? [];
  const dont = article.whatWeDont ?? [];
  if (!know.length && !dont.length) return null;
  return (
    <aside className="my-6 not-prose grid gap-5 border border-hair bg-mist/40 p-5 sm:grid-cols-2">
      {know.length ? (
        <div>
          <SectionLabel>What We Know</SectionLabel>
          <ul className="space-y-1.5">
            {know.map((p, i) => (
              <li key={i} className="flex gap-2 font-body text-[1.02rem] leading-snug text-navy">
                <span className="flex-none font-bold text-navy">✓</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {dont.length ? (
        <div>
          <SectionLabel>What&apos;s Unconfirmed</SectionLabel>
          <ul className="space-y-1.5">
            {dont.map((p, i) => (
              <li key={i} className="flex gap-2 font-body text-[1.02rem] leading-snug text-slate">
                <span className="flex-none font-bold text-breaking">?</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

function DenialCallout({ article }: { article: Article }) {
  if (!article.denial) return null;
  return (
    <aside className="my-6 not-prose border-l-4 border-breaking bg-mist/30 p-4">
      <SectionLabel>The Other Side</SectionLabel>
      <p className="font-body text-[1.05rem] leading-snug text-navy">{article.denial}</p>
    </aside>
  );
}

function AiDisclosureNote({ article }: { article: Article }) {
  if (!article.aiDisclosure) return null;
  return (
    <p className="mt-6 not-prose border-t border-hair pt-4 font-sans text-xs leading-relaxed text-slate">
      {article.aiDisclosure}{" "}
      <a href="/report/" className="underline hover:text-breaking">
        See something wrong? Report it.
      </a>
    </p>
  );
}

export function GossipTop({ article }: { article: Article }) {
  if (article.formatTag !== "gossip") return null;
  return (
    <>
      <WhatWeKnowBox article={article} />
      <DenialCallout article={article} />
    </>
  );
}

export function GossipBottom({ article }: { article: Article }) {
  if (article.formatTag !== "gossip") return null;
  return <AiDisclosureNote article={article} />;
}
