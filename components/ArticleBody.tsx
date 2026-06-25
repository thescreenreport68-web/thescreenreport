import { Fragment } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import Link from "next/link";
import AdSlot from "./AdSlot";

// Split the article at H2 boundaries so we can drop in-content ads between
// sections without ever breaking a list or paragraph.
function splitAtH2(body: string): string[] {
  return body
    .split(/\n(?=## )/g)
    .map((p) => p.trim())
    .filter(Boolean);
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

export default function ArticleBody({ body }: { body: string }) {
  const segments = splitAtH2(body);
  const mid = segments.length > 3 ? Math.floor(segments.length / 2) : -1;
  return (
    <div className="prose prose-screen max-w-none">
      {segments.map((seg, i) => (
        <Fragment key={i}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug]}
            components={components}
          >
            {seg}
          </ReactMarkdown>
          {i === 0 || i === mid ? (
            <div className="not-prose my-8">
              <AdSlot format="rectangle" />
            </div>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}
