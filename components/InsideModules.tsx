import Link from "next/link";
import { getArticleBySlug, type Article } from "@/lib/articles";
import { SectionLabel } from "@/components/NicheModules";
import TweetEmbed from "@/components/embed/TweetEmbed";
import { formatDateShort } from "@/lib/format";

/* Inside (audience-reaction & discourse) per-form UI — formatTag "inside". Each component guards on its
   own field, so an article only renders the modules for its data. On the shared design tokens. */

const stripQuotes = (s: string) => s.trim().replace(/^["“”]+|["“”]+$/g, "").trim();

const INSIDE_LABEL: Record<string, string> = {
  "audience-reaction": "Fans React",
  "the-debate": "The Debate",
  "creator-answers-critics": "The Response",
  "breakout-buzz": "Everyone's Talking",
};

/* ---------- ripple header: form label + parent-story backlink + live line ---------- */
function RippleHeader({ article }: { article: Article }) {
  const label = article.insideForm ? INSIDE_LABEL[article.insideForm] || "The Discourse" : "";
  if (!label && !article.parentSlug && !article.parentTitle) return null;
  // Resolve the parent by slug alone — the pipeline can route the child into a DIFFERENT
  // category than the parent story, and a retracted/deleted parent must not leave a dead
  // link (unresolved → plain text, no 404).
  const parent = article.parentSlug ? getArticleBySlug(article.parentSlug) : undefined;
  const parentText = article.parentTitle || article.parentSlug?.replace(/-/g, " ");
  // Audience-reaction and the-debate keep collecting posts after publish (monitor top-ups).
  const stillLive = article.insideForm === "audience-reaction" || article.insideForm === "the-debate";
  return (
    <div className="my-5 not-prose border-y-2 border-ink py-3">
      {label ? <span className="kicker">{label}</span> : null}
      {article.parentSlug || article.parentTitle ? (
        <div className="mt-1.5 font-body text-[1.02rem] leading-snug text-ink">
          <span className="font-sans text-xs font-bold uppercase tracking-[0.08em] text-slate">
            The story:{" "}
          </span>
          {parent ? (
            <Link
              href={`/${parent.category}/${parent.slug}/`}
              className="font-semibold text-ink hover:text-red"
            >
              {article.parentTitle || parent.title}
            </Link>
          ) : (
            <span className="font-semibold">{parentText}</span>
          )}
        </div>
      ) : null}
      {stillLive ? (
        <div className="meta-mono mt-1.5">
          Reactions still coming in · Updated {formatDateShort(article.updated ?? article.date)}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- the anchor statement (creator's reply to critics) ---------- */
function AnchorStatement({ article }: { article: Article }) {
  const a = article.anchorStatement;
  if (!a?.quote) return null;
  const meta = [a.connection, a.platform].filter(Boolean).join(" · ");
  return (
    <aside className="my-6 not-prose border border-hair p-5">
      <SectionLabel>The Response</SectionLabel>
      <div className="font-display text-xl font-bold leading-tight text-ink">{a.speaker}</div>
      {meta ? <div className="meta-mono mt-0.5">{meta}</div> : null}
      <blockquote className="mt-3 border-l-2 border-red pl-4 font-body text-xl italic leading-snug text-ink">
        &ldquo;{stripQuotes(a.quote)}&rdquo;
      </blockquote>
    </aside>
  );
}

/* ---------- fan-consensus verdict (sentiment read; present on all forms) ---------- */
function FanConsensusBox({ article }: { article: Article }) {
  if (!article.fanConsensus) return null;
  return (
    <aside className="my-6 not-prose border border-hair p-5">
      <SectionLabel>The Verdict</SectionLabel>
      <p className="font-body text-xl leading-snug text-ink sm:text-2xl">{article.fanConsensus}</p>
    </aside>
  );
}

/* ---------- the reaction cards (the core content) ---------- */
function ReactionCard({
  r,
  n,
}: {
  r: NonNullable<Article["reactions"]>[number];
  n: number;
}) {
  const meta = [r.connection, r.platform, r.date].filter(Boolean).join(" · ");
  return (
    <li className="flex gap-3 py-4">
      <span className="meta-mono w-6 flex-none pt-1 text-gray">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="font-body text-[1.05rem] font-bold leading-snug text-ink">{r.speaker}</div>
        {meta ? <div className="meta-mono mt-0.5 text-xs text-gray">{meta}</div> : null}
        {/* The written quote is canonical; the tweet embed below is garnish and may render null. */}
        <p className="mt-1.5 font-body text-[1.05rem] leading-snug text-ink">
          &ldquo;{stripQuotes(r.quote)}&rdquo;
        </p>
        {r.tweetId ? (
          <div className="mt-3">
            <TweetEmbed id={r.tweetId} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ReactionList({ article }: { article: Article }) {
  if (!article.reactions?.length) return null;
  const heading = "The Reactions";
  return (
    <section className="mt-10 not-prose">
      <div className="mb-1 border-b-2 border-ink pb-1">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-ink">
          {heading}
        </h2>
      </div>
      <ol className="divide-y divide-hair">
        {article.reactions.map((r, i) => (
          <ReactionCard key={i} r={r} n={i + 1} />
        ))}
      </ol>
    </section>
  );
}

/* ---------- dispatchers ---------- */
export function InsideTop({ article }: { article: Article }) {
  if (article.formatTag !== "inside") return null;
  return (
    <>
      <RippleHeader article={article} />
      <AnchorStatement article={article} />
      <FanConsensusBox article={article} />
    </>
  );
}

export function InsideBottom({ article }: { article: Article }) {
  if (article.formatTag !== "inside") return null;
  return <ReactionList article={article} />;
}
