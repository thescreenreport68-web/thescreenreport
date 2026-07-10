import { Fragment } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import Link from "next/link";
import ReadNext from "./ReadNext";
import TweetEmbed from "./embed/TweetEmbed";
import InstagramEmbed from "./embed/InstagramEmbed";
import type { Article } from "@/lib/articles";

/* Inline embed marker (inside lane, REV 3): a block of the form [embed:tweet:<id>] or
   [embed:instagram:<url>] renders as the real post, directly where the pipeline placed it —
   below the paragraph quoting that post. Only inside-lane articles emit markers. */
const EMBED_RX = /^\[embed:(tweet|instagram):([^\]\s]+)\]$/;

// THR's measured in-content cadence (live-audited 2026-07): first unit after
// ~2 paragraphs, second after ~6, then one every ~5 to the end — keeps ≥1
// viewport of content between ads (Better Ads / AdSense density-safe).
function adAfter(paraCount: number): boolean {
  if (paraCount === 2 || paraCount === 6) return true;
  return paraCount > 6 && (paraCount - 6) % 5 === 0;
}

function isParagraph(b: string): boolean {
  return !/^(#|>|-|\*|\+|\d+\.|\||```|!\[)/.test(b.trim());
}

function InContentAd() {
  return (
    <div className="not-prose my-8 border-y border-hair py-4 text-center">
      <div className="mx-auto flex min-h-[250px] w-full max-w-[336px] items-center justify-center">
        <span className="meta-mono text-gray">Advertisement</span>
      </div>
    </div>
  );
}

const components = {
  a: ({ href = "", children }: { href?: string; children?: React.ReactNode }) =>
    href.startsWith("/") ? (
      <Link href={href}>{children}</Link>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
};

export default function ArticleBody({
  body,
  related,
  dropCap = false,
}: {
  body: string;
  related?: Article[];
  dropCap?: boolean;
}) {
  const blocks = body
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  let para = 0;
  let readNextShown = false;
  return (
    <div
      className={`prose prose-screen article-endmark mx-auto ${
        dropCap ? "article-dropcap" : ""
      }`}
    >
      {blocks.map((blk, i) => {
        const em = blk.match(EMBED_RX);
        if (em) {
          return (
            <div key={i} className="not-prose my-6">
              {em[1] === "tweet" ? <TweetEmbed id={em[2]} /> : <InstagramEmbed url={em[2]} />}
            </div>
          );
        }
        const paragraph = isParagraph(blk);
        if (paragraph) para += 1;
        const showAd = paragraph && adAfter(para);
        const showReadNext =
          paragraph && !readNextShown && para === 5 && !!related?.length;
        if (showReadNext) readNextShown = true;
        return (
          <Fragment key={i}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSlug]}
              components={components}
            >
              {blk}
            </ReactMarkdown>
            {showReadNext ? <ReadNext articles={related!.slice(0, 1)} /> : null}
            {showAd ? <InContentAd /> : null}
          </Fragment>
        );
      })}
    </div>
  );
}
