import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of The Screen Report.",
};

export default function TermsPage() {
  return (
    <div className="container-wide max-w-prose py-12">
      <h1 className="font-serif text-4xl font-bold text-ink">Terms of Service</h1>
      <div className="prose prose-screen mt-6 max-w-none">
        <p>
          Welcome to The Screen Report (thescreenreport.com). By accessing or
          using this website, you agree to these Terms of Service. If you do not
          agree, please do not use the site.
        </p>
        <h2>Use of the site</h2>
        <p>
          The Screen Report provides entertainment news and commentary for
          personal, non-commercial use. You may share links to our articles, but
          you may not republish, scrape, or redistribute our content in bulk
          without written permission.
        </p>
        <h2>Content &amp; accuracy</h2>
        <p>
          We work to keep our reporting accurate and clearly attributed; see our{" "}
          <a href="/editorial-standards/">Editorial Standards</a> and{" "}
          <a href="/corrections/">Corrections</a> pages. Content is provided
          &quot;as is&quot; without warranties of any kind, and we are not liable
          for decisions made based on it.
        </p>
        <h2>Intellectual property</h2>
        <p>
          Articles, design, and original media on this site are the property of
          The Screen Report or used under license or applicable editorial-use
          principles, with credits provided. Third-party trademarks, posters, and
          stills belong to their respective owners. For copyright concerns, see
          our <a href="/dmca/">DMCA policy</a>.
        </p>
        <h2>Third-party services &amp; YouTube</h2>
        <p>
          Pages on this site may embed or reference content from third-party
          platforms, including YouTube. Where YouTube content or features appear,
          your use is also governed by the{" "}
          <a href="https://www.youtube.com/t/terms" rel="noopener noreferrer">
            YouTube Terms of Service
          </a>{" "}
          and the{" "}
          <a
            href="https://www.google.com/policies/privacy"
            rel="noopener noreferrer"
          >
            Google Privacy Policy
          </a>
          . Our use of YouTube API Services is described in our{" "}
          <a href="/privacy/">Privacy Policy</a>.
        </p>
        <h2>Advertising &amp; affiliate links</h2>
        <p>
          The site displays advertising and may include affiliate links, disclosed
          in our <a href="/ethics/">Ethics &amp; Ownership</a> page. Advertisers
          and affiliates do not influence editorial decisions.
        </p>
        <h2>Changes</h2>
        <p>
          We may update these terms from time to time; the current version is
          always at this page. Continued use of the site after changes means you
          accept the updated terms.
        </p>
        <h2>Contact</h2>
        <p>
          Questions about these terms:{" "}
          <a href="mailto:contact@thescreenreport.com">
            contact@thescreenreport.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}
