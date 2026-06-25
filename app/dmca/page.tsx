import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DMCA & Copyright",
  description: "The Screen Report's copyright and DMCA takedown policy.",
};

export default function DmcaPage() {
  return (
    <div className="container-wide max-w-prose py-12">
      <h1 className="font-serif text-4xl font-bold text-navy">
        DMCA &amp; Copyright
      </h1>
      <div className="prose prose-screen mt-6 max-w-none">
        <p>
          The Screen Report respects the intellectual property rights of others and
          expects users to do the same. We source images and media through licensed,
          official or properly attributed channels.
        </p>
        <h2>Reporting infringement</h2>
        <p>
          If you believe content on this site infringes your copyright, send a notice
          to{" "}
          <a href="mailto:dmca@thescreenreport.com">dmca@thescreenreport.com</a>{" "}
          including:
        </p>
        <ul>
          <li>Identification of the copyrighted work;</li>
          <li>The URL of the allegedly infringing material;</li>
          <li>Your contact information;</li>
          <li>
            A statement of good-faith belief that the use is not authorized; and
          </li>
          <li>
            A statement, under penalty of perjury, that the information is accurate
            and that you are the rights holder or authorized to act on their behalf.
          </li>
        </ul>
        <p>We review all valid notices and act promptly to remove infringing material.</p>
      </div>
    </div>
  );
}
