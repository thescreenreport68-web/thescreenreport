import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How The Screen Report handles data and privacy.",
};

export default function PrivacyPage() {
  return (
    <div className="container-wide max-w-prose py-12">
      <h1 className="font-serif text-4xl font-bold text-navy">Privacy Policy</h1>
      <div className="prose prose-screen mt-6 max-w-none">
        <p>
          This policy explains what information The Screen Report collects and how
          it is used. By using this site, you agree to the practices described here.
        </p>
        <h2>Information we collect</h2>
        <p>
          We collect standard analytics data (such as pages visited and general
          location) to understand and improve our content. If you subscribe to our
          newsletter, we collect the email address you provide.
        </p>
        <h2>Advertising &amp; cookies</h2>
        <p>
          We display advertising and may use third-party ad and analytics partners
          that use cookies or similar technologies to serve and measure ads. Where
          required, we present a consent choice for these technologies.
        </p>
        <h2>Affiliate links</h2>
        <p>
          Some links are affiliate links; see our{" "}
          <a href="/ethics/">Ethics &amp; Ownership</a> page for details.
        </p>
        <h2>Your choices</h2>
        <p>
          You can unsubscribe from emails at any time and manage cookie preferences
          through your browser or our consent tool. For privacy requests, contact{" "}
          <a href="mailto:privacy@thescreenreport.com">
            privacy@thescreenreport.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}
