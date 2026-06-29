import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Report a Problem",
  description:
    "Report a story you believe is inaccurate, unfair, or should be taken down. The Screen Report reviews every report and corrects or removes content promptly.",
};

export default function ReportPage() {
  return (
    <div className="container-wide max-w-prose py-12">
      <h1 className="font-serif text-4xl font-bold text-navy">Report a Problem</h1>
      <div className="prose prose-screen mt-6 max-w-none">
        <p>
          If you are featured in a story and believe it is inaccurate, unfair, or
          should be removed, we want to hear from you. We take every report
          seriously and review it quickly.
        </p>
        <ul>
          <li>
            Some of our celebrity and music stories report on rumors and
            speculation that are circulating publicly. We label these clearly as
            unconfirmed, attribute what we can, and monitor them &mdash; updating or
            removing them as the facts develop.
          </li>
          <li>
            If you are the subject of a story, or their representative, and want it
            corrected or taken down, email{" "}
            <a href="mailto:corrections@thescreenreport.com">
              corrections@thescreenreport.com
            </a>{" "}
            with the article link and the specific issue. We will respond promptly.
          </li>
          <li>
            See also our{" "}
            <a href="/corrections/">Corrections Policy</a> and{" "}
            <a href="/editorial-standards/">Editorial Standards</a>.
          </li>
        </ul>
      </div>
    </div>
  );
}
