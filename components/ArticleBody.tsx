import { Fragment } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import Link from "next/link";
import ReadNext from "./ReadNext";
import type { Article } from "@/lib/articles";

// THR's in-content cadence: a 300x250 after paragraph 2, after paragraph 4,
// then one roughly every 4 paragraphs — each framed with hairlines + a label.
function adAfter(paraCount: number): boolean {
  if (paraCount === 2 || paraCount === 4) return true;
  return paraCount > 4 && (paraCount - 4) % 4 === 0;
}

function isParagraph(b: string): boolean {
  return !/^(#|>|-|\*|\+|\d+\.|\||```|!\[)/.test(b.trim());
}

function InContentAd() {
  return (
    <div className="not-prose my-8 border-y border-hair py-5 text-center">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate/60">
        Advertisement
      </div>
      <div className="mx-auto flex h-[250px] w-[300px] items-center justify-center border border-dashed border-navy/20 bg-mist text-[11px] text-navy/30">
        300×250
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
}: {
  body: string;
  related?: Article[];
}) {
  const blocks = body
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  let para = 0;
  let readNextShown = false;
  return (
    <div className="prose prose-screen mx-auto">
      {blocks.map((blk, i) => {
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
