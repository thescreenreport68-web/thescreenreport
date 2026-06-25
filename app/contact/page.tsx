import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with The Screen Report.",
};

export default function ContactPage() {
  return (
    <div className="container-wide max-w-prose py-12">
      <h1 className="font-serif text-4xl font-bold text-navy">Contact Us</h1>
      <div className="prose prose-screen mt-6 max-w-none">
        <p>We&apos;d love to hear from you.</p>
        <ul>
          <li>
            General &amp; editorial:{" "}
            <a href="mailto:hello@thescreenreport.com">hello@thescreenreport.com</a>
          </li>
          <li>
            Corrections:{" "}
            <a href="mailto:corrections@thescreenreport.com">
              corrections@thescreenreport.com
            </a>
          </li>
          <li>
            Tips:{" "}
            <a href="mailto:tips@thescreenreport.com">tips@thescreenreport.com</a>
          </li>
          <li>
            Advertising &amp; partnerships:{" "}
            <a href="mailto:partners@thescreenreport.com">
              partners@thescreenreport.com
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
