import type { Article } from "@/lib/articles";
import { SectionLabel } from "@/components/NicheModules";
import SocialEmbed from "@/components/SocialEmbed";

/* The "receipt": the originating post the rumor is ABOUT, embedded as lead media. YouTube = a clean responsive
   iframe (powerful + free); X/Bluesky go through the client SocialEmbed. Renders nothing if there's no embed. */
function ReceiptEmbed({ article }: { article: Article }) {
  const e = article.heroEmbed;
  if (!e) return null;
  if (e.platform === "youtube" && e.embedUrl) {
    return (
      <div className="not-prose my-6 overflow-hidden border border-hair">
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          <iframe
            src={e.embedUrl}
            title={article.title}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute left-0 top-0 h-full w-full"
          />
        </div>
      </div>
    );
  }
  if (e.platform === "x" || e.platform === "bluesky") {
    return <SocialEmbed embed={{ platform: e.platform, sourceUrl: e.sourceUrl, handle: e.handle, tweetId: e.tweetId }} />;
  }
  return null;
}

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

function PullQuote({ article }: { article: Article }) {
  if (!article.gossipPull) return null;
  return (
    <blockquote className="my-6 not-prose border-l-4 border-breaking pl-5">
      <p className="font-display text-2xl font-bold leading-tight text-navy sm:text-[1.7rem]">
        &ldquo;{article.gossipPull.replace(/^["“]|["”]$/g, "")}&rdquo;
      </p>
    </blockquote>
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
      <ReceiptEmbed article={article} />
      <WhatWeKnowBox article={article} />
      <PullQuote article={article} />
      <DenialCallout article={article} />
    </>
  );
}

export function GossipBottom({ article }: { article: Article }) {
  if (article.formatTag !== "gossip") return null;
  return <AiDisclosureNote article={article} />;
}
