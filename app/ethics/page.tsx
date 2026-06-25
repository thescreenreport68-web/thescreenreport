import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ethics & Ownership",
  description:
    "The Screen Report's approach to independence, funding, affiliate links and sponsored content.",
};

export default function EthicsPage() {
  return (
    <div className="container-wide max-w-prose py-12">
      <h1 className="font-serif text-4xl font-bold text-navy">
        Ethics &amp; Ownership
      </h1>
      <div className="prose prose-screen mt-6 max-w-none">
        <h2>Independence</h2>
        <p>
          Our editorial judgment is independent. Coverage decisions are not
          influenced by advertisers, affiliate partners or the subjects of our
          reporting.
        </p>
        <h2>How we&apos;re funded</h2>
        <p>
          The Screen Report is supported by advertising, affiliate partnerships and
          reader support. When an article contains affiliate links, we may earn a
          commission if you buy or subscribe through them — at no extra cost to you.
          This never determines our verdicts or recommendations.
        </p>
        <h2>Sponsored content</h2>
        <p>
          Any sponsored or paid content is clearly labeled as such and kept separate
          from our independent editorial coverage.
        </p>
        <h2>Contact</h2>
        <p>
          Questions about ownership, funding or ethics? Reach us via our{" "}
          <a href="/contact/">contact page</a>.
        </p>
      </div>
    </div>
  );
}
