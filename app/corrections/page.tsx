import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Corrections Policy",
  description: "How The Screen Report handles corrections and updates.",
};

export default function CorrectionsPage() {
  return (
    <div className="container-wide max-w-prose py-12">
      <h1 className="font-serif text-4xl font-bold text-navy">Corrections</h1>
      <div className="prose prose-screen mt-6 max-w-none">
        <p>
          Accuracy matters to us. When we publish something that is incorrect, we
          correct it promptly and transparently.
        </p>
        <ul>
          <li>
            Material corrections are noted on the article, with the date and nature
            of the change.
          </li>
          <li>
            Minor updates (such as adding new confirmed information) may be reflected
            in the article&apos;s &ldquo;Updated&rdquo; timestamp.
          </li>
          <li>
            To request a correction, email{" "}
            <a href="mailto:corrections@thescreenreport.com">
              corrections@thescreenreport.com
            </a>{" "}
            with the article link and the specific issue.
          </li>
        </ul>
      </div>
    </div>
  );
}
