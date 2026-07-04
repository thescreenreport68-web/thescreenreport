import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How The Screen Report collects, uses, shares and protects your information — including cookies, advertising, Google Sign-In, comments, and your privacy rights under GDPR, CCPA/CPRA and India's DPDP Act.",
  alternates: { canonical: "/privacy/" },
};

export default function PrivacyPage() {
  return (
    <div className="container-wide max-w-prose py-12">
      <h1 className="font-display text-4xl font-bold text-ink">Privacy Policy</h1>
      <p className="meta-mono mt-3">Last updated · July 4, 2026</p>

      <div className="prose prose-screen mt-8 max-w-none">
        <p>
          This Privacy Policy explains what information <strong>The Screen Report</strong>{" "}
          (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;the Site&rdquo;) collects from and about
          visitors, how we use it, who we share it with, and the choices and rights you have.
          The Screen Report is an independent entertainment-news publication operated by an
          individual based in India, with a global readership that includes the United States,
          the European Union / EEA, the United Kingdom and Switzerland.
        </p>
        <p>
          By using the Site you agree to this Policy. If you do not agree, please discontinue use.
        </p>

        <h2>1. Information we collect</h2>
        <h3>Information you provide to us</h3>
        <ul>
          <li>
            <strong>Newsletter signup:</strong> your email address, and any name you choose to
            provide.
          </li>
          <li>
            <strong>Comments via Google Sign-In:</strong> when you sign in with Google to
            comment, we receive from Google your name, email address and profile picture
            (avatar), together with the comment text, timestamps and any replies or reactions
            you post. See Section 7 for full detail.
          </li>
          <li>
            <strong>Correspondence:</strong> any information you include when you email us or
            submit a form.
          </li>
        </ul>
        <h3>Information collected automatically</h3>
        <p>When you visit, our infrastructure and analytics automatically record:</p>
        <ul>
          <li>
            <strong>IP address</strong> — used transiently for security, spam and abuse
            prevention, and to infer a coarse country or region;
          </li>
          <li>
            <strong>Device and browser data</strong> — device type, operating system, browser
            type and version, screen size and language;
          </li>
          <li>
            <strong>Usage data</strong> — pages viewed, referring and exit pages, links clicked,
            time on page, and the approximate date and time of access;
          </li>
          <li>
            <strong>Cookies and similar technologies</strong> — see Section 2.
          </li>
        </ul>
        <p>
          Our own analytics are privacy-friendly and aggregate. We use them to understand overall
          traffic patterns; we do not use them to build individual advertising profiles or to
          fingerprint you.
        </p>
        <h3>Information from third parties and partners</h3>
        <ul>
          <li>
            <strong>Advertising partners</strong> (Google AdSense / Google Ad Manager and their
            vendors) set and read their own cookies and identifiers to serve and measure ads, and
            may combine what they collect here with data from your activity on other sites. We do
            not control, and cannot access, the raw data these partners collect (see Sections 2
            and 4).
          </li>
          <li>
            <strong>Affiliate networks:</strong> when you click an affiliate link, the destination
            retailer or network may set cookies to attribute a resulting purchase to us. We
            receive aggregate commission reporting, not your identity.
          </li>
        </ul>

        <h2>2. Cookies &amp; similar technologies</h2>
        <p>
          Cookies are small text files stored on your device. We and our partners also use similar
          technologies such as local storage, pixels and device identifiers. We group them into
          three categories:
        </p>
        <ul>
          <li>
            <strong>Strictly necessary</strong> — required for the Site to function (security,
            load balancing, remembering your cookie choice, and keeping you signed in to comment).
            These cannot be switched off.
          </li>
          <li>
            <strong>Analytics</strong> — help us understand aggregate traffic and improve content.
            Our analytics are configured to be privacy-friendly and aggregate.
          </li>
          <li>
            <strong>Advertising</strong> — set by Google and third-party ad vendors to serve, cap,
            personalize and measure ads.
          </li>
        </ul>
        <h3>Advertising cookies — Google AdSense / Ad Manager</h3>
        <p>We use Google AdSense and Google Ad Manager to display ads. As required by Google:</p>
        <ul>
          <li>
            Third-party vendors, including Google, use cookies to serve ads based on your prior
            visits to this website or other websites.
          </li>
          <li>
            Google&apos;s use of advertising cookies enables it and its partners to serve ads to
            you based on your visit to this Site and/or other sites on the Internet.
          </li>
          <li>
            You may opt out of personalized advertising by visiting{" "}
            <a href="https://adssettings.google.com/" rel="noopener noreferrer">
              Google Ads Settings
            </a>
            . You can also opt out of a third-party vendor&apos;s use of cookies for personalized
            advertising at{" "}
            <a href="https://optout.aboutads.info/" rel="noopener noreferrer">
              aboutads.info/choices
            </a>
            , and, in the EU, at{" "}
            <a href="https://www.youronlinechoices.eu/" rel="noopener noreferrer">
              youronlinechoices.eu
            </a>
            .
          </li>
          <li>
            For more on how our ad partners use data, see{" "}
            <a
              href="https://policies.google.com/technologies/partner-sites"
              rel="noopener noreferrer"
            >
              How Google uses information from sites or apps that use our services
            </a>
            .
          </li>
        </ul>
        <h3>Your consent (EEA / UK / Switzerland)</h3>
        <p>
          If you are in the EEA, the UK or Switzerland, we ask for your consent through a consent
          banner before setting non-essential (analytics and advertising) cookies, and we pass
          your choices to Google via Consent Mode. You can withdraw or change your consent at any
          time via the &ldquo;Cookie settings&rdquo; link in our footer. Where you decline, you
          will still see ads, but they will be non-personalized. Most browsers also let you block
          or delete cookies in their settings; blocking essential cookies may break parts of the
          Site.
        </p>

        <h2>3. How we use your information &amp; legal bases</h2>
        <p>
          Where the GDPR applies, we rely on a lawful basis for each purpose, shown in brackets
          below:
        </p>
        <ul>
          <li>
            Publish and deliver the Site, and keep it secure and free of abuse and spam — using IP,
            device and usage data and essential cookies. <em>[Legitimate interests.]</em>
          </li>
          <li>
            Show ads to fund the Site — using advertising cookies and identifiers.{" "}
            <em>[Consent for personalized ads; legitimate interests for non-personalized ads
            where permitted.]</em>
          </li>
          <li>
            Understand aggregate traffic and improve content — using aggregate analytics.{" "}
            <em>[Consent where required, otherwise legitimate interests.]</em>
          </li>
          <li>
            Send the newsletter you asked for — using your email and optional name.{" "}
            <em>[Consent.]</em>
          </li>
          <li>
            Let you sign in with Google and post comments — using your Google name, email and
            avatar, and your comment text. <em>[Consent / performance of the service you
            request.]</em>
          </li>
          <li>
            Respond to your emails and requests. <em>[Legitimate interests; legal obligation for
            data-rights requests.]</em>
          </li>
          <li>
            Comply with law and enforce our terms. <em>[Legal obligation / legitimate
            interests.]</em>
          </li>
        </ul>
        <p>
          We do not use your data for automated decision-making that produces legal or similarly
          significant effects, and we do not sell your personal information (see Section 5).
        </p>

        <h2>4. Third parties, processors &amp; service providers</h2>
        <p>
          We share limited data with the following service providers and partners, each acting
          under its own privacy terms:
        </p>
        <ul>
          <li>
            <strong>Google AdSense / Google Ad Manager</strong> — serving and measuring ads (ad
            cookies and identifiers, IP, usage) —{" "}
            <a href="https://policies.google.com/privacy" rel="noopener noreferrer">
              privacy policy
            </a>
            .
          </li>
          <li>
            <strong>Google Sign-In (OAuth) / Google Identity</strong> — authenticating commenters
            (name, email, avatar) —{" "}
            <a href="https://policies.google.com/privacy" rel="noopener noreferrer">
              privacy policy
            </a>
            .
          </li>
          <li>
            <strong>Cloudflare, Inc.</strong> — content delivery, DNS, security and hosting (IP,
            request metadata, security cookies) —{" "}
            <a href="https://www.cloudflare.com/privacypolicy/" rel="noopener noreferrer">
              privacy policy
            </a>
            .
          </li>
          <li>
            <strong>Supabase, Inc.</strong> — our database, storing comments and newsletter
            records (name, email, avatar, comment text, signup data) —{" "}
            <a href="https://supabase.com/privacy" rel="noopener noreferrer">
              privacy policy
            </a>
            .
          </li>
          <li>
            <strong>Our email / newsletter provider</strong> — sending and managing the newsletter
            (email, name, engagement metrics).
          </li>
          <li>
            <strong>Affiliate networks</strong> (such as Amazon Associates) — purchase attribution
            and commissions (click data and affiliate cookies, set by them).
          </li>
        </ul>
        <h3>Embedded third-party content</h3>
        <p>
          Articles may embed videos and posts from <strong>YouTube, X and Instagram</strong>. When
          such an embed loads, that platform can set its own cookies and receive information
          including your IP address and the page you are viewing — as if you had visited the
          platform directly — even if you do not click. We use YouTube&apos;s privacy-enhanced mode
          where available. These embeds are governed by the platforms&apos; own privacy policies.
          We may also disclose information if required by law, to enforce our terms, or to protect
          rights, safety and security.
        </p>

        <h2>5. Your privacy rights</h2>
        <h3>European Economic Area, UK &amp; Switzerland (GDPR)</h3>
        <p>If you are in the EEA, UK or Switzerland, you have the right to:</p>
        <ul>
          <li>access the personal data we hold about you;</li>
          <li>rectify inaccurate or incomplete data;</li>
          <li>
            erase your data (&ldquo;right to be forgotten&rdquo;), subject to our need to retain
            some data for legal or journalistic reasons;
          </li>
          <li>restrict or object to processing, including direct marketing;</li>
          <li>data portability;</li>
          <li>withdraw consent at any time, without affecting processing already carried out;</li>
          <li>
            not be subject to solely automated decisions with legal or similarly significant
            effects (we do not do this); and
          </li>
          <li>lodge a complaint with your local data protection authority.</li>
        </ul>
        <p>
          To exercise any right, email{" "}
          <a href="mailto:privacy@thescreenreport.com">privacy@thescreenreport.com</a>. We respond
          within one month (extendable by two months for complex requests) and do not charge a fee
          except where requests are manifestly unfounded or excessive.
        </p>
        <h3>California (CCPA / CPRA)</h3>
        <p>
          If you are a California resident, you have the right to know and access, delete, and
          correct your personal information; to opt out of its &ldquo;sale&rdquo; or
          &ldquo;sharing&rdquo;; to limit the use of sensitive personal information; and to
          non-discrimination for exercising your rights.
        </p>
        <p>
          <strong>&ldquo;Sale&rdquo; and &ldquo;sharing.&rdquo;</strong> We do not sell your
          personal information for money. However, our use of third-party advertising cookies to
          show you personalized ads may be considered &ldquo;sharing&rdquo; for cross-context
          behavioral advertising under the CCPA/CPRA. You can opt out using the &ldquo;Your Privacy
          Choices&rdquo; link in our footer, and/or by enabling a browser-based Global Privacy
          Control (GPC) signal, which we treat as a valid opt-out of sharing. When you opt out you
          will still see ads, but they will be non-personalized. Residents of other US states with
          comprehensive privacy laws have similar rights, and the same contact and opt-out
          mechanisms apply.
        </p>
        <h3>India (Digital Personal Data Protection Act, 2023)</h3>
        <p>
          The Screen Report is operated from India and acts as a Data Fiduciary under India&apos;s
          Digital Personal Data Protection Act, 2023. If you are in India, you are a Data Principal
          and have the right to access information about the personal data we process and with whom
          it is shared; to correct, complete, update or erase it; to nominate another individual to
          exercise your rights in the event of death or incapacity; and to grievance redressal. We
          process your data only for the purposes described here, you may withdraw consent as
          easily as you gave it, and we maintain reasonable security safeguards. In the event of a
          personal-data breach, we will notify affected individuals and the Data Protection Board
          of India as required. Grievance contact:{" "}
          <a href="mailto:privacy@thescreenreport.com">privacy@thescreenreport.com</a>.
        </p>

        <h2>6. Children&apos;s privacy</h2>
        <p>
          The Screen Report is a general-audience entertainment-news publication intended for
          adults and is not directed to children. We do not knowingly collect personal information
          from children under 13 (or the minimum age of digital consent in your country, which may
          be up to 16 in parts of the EU). If you believe a child has provided us personal
          information, contact{" "}
          <a href="mailto:privacy@thescreenreport.com">privacy@thescreenreport.com</a> and we will
          delete it. Consistent with this, we do not tag our content as child-directed for
          advertising purposes.
        </p>

        <h2>7. Google Sign-In &amp; account / data deletion</h2>
        <p>
          We offer &ldquo;Sign in with Google&rdquo; so you can post comments without creating a
          separate password. When you sign in, Google shares a limited set of basic profile
          information with us — your name, email address and profile picture — via the{" "}
          <code>openid</code>, <code>email</code> and <code>profile</code> scopes. We request no
          access to your Gmail, Google Drive, Contacts or any other Google service.
        </p>
        <p>
          <strong>How we use Google data (Limited Use).</strong> We use this information only to
          display your name and avatar next to your comments, associate your comments with your
          account and let you manage them, contact you about your account or comments if needed,
          and prevent spam and abuse. Our use of information received from Google APIs adheres to
          the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements. We do not sell this data, do not transfer it to
          advertisers, data brokers or resellers, and do not use it for advertising or any purpose
          other than the comment features above.
        </p>
        <p>
          <strong>Where it is stored.</strong> Your comment account data is stored in our database
          hosted by Supabase and delivered via Cloudflare.
        </p>
        <p>
          <strong>Deleting your account and data.</strong> You can delete your comment account and
          associated data at any time using the &ldquo;Delete my account&rdquo; option in your
          profile, or by emailing a deletion request to{" "}
          <a href="mailto:privacy@thescreenreport.com">privacy@thescreenreport.com</a> from the
          email tied to your account. Deleting your account removes your profile information and,
          at your choice, your comment history; we complete verified deletion requests within 30
          days, except for minimal records we must keep for legal, security or fraud-prevention
          reasons. You can also revoke The Screen Report&apos;s access to your Google account at any
          time via{" "}
          <a href="https://myaccount.google.com/connections" rel="noopener noreferrer">
            your Google account connections
          </a>
          .
        </p>

        <h2>8. Transfers, retention, security &amp; changes</h2>
        <p>
          <strong>International data transfers.</strong> We operate from India and use service
          providers (including Google, Cloudflare and Supabase) that process data on servers in the
          United States, the EU and other countries. Where we transfer personal data out of the
          EEA/UK, we rely on appropriate safeguards such as the EU Standard Contractual Clauses, the
          UK International Data Transfer Addendum, and/or providers&apos; certification under
          applicable frameworks.
        </p>
        <p>
          <strong>Retention.</strong> We keep comment account data until you delete your account or
          ask us to remove it; newsletter data until you unsubscribe; server and security logs for
          a limited period (typically up to 90 days); and analytics only in non-identifying,
          aggregate form. We may retain limited information longer where required by law.
        </p>
        <p>
          <strong>Security.</strong> We use reasonable technical and organizational measures —
          including HTTPS/TLS encryption in transit, access controls, and reputable infrastructure
          providers — to protect personal data. No method of transmission or storage is completely
          secure, and we cannot guarantee absolute security.
        </p>
        <p>
          <strong>A note on AI-assisted content.</strong> Some articles on The Screen Report may be
          produced or edited with the assistance of AI and automated tools, and all such content is
          subject to human editorial review before publication. This concerns how we create
          editorial content and does not change how we handle your personal data — we do not feed
          your personal information, such as your comments or email, into third-party AI tools to
          train them.
        </p>
        <p>
          <strong>Changes to this Policy.</strong> We may update this Policy from time to time. When
          we make material changes, we will update the &ldquo;Last updated&rdquo; date above and,
          where appropriate, provide a more prominent notice. Your continued use of the Site after
          changes take effect constitutes acceptance.
        </p>
        <p>
          <strong>Contact us.</strong> For any privacy question or to exercise your rights, email{" "}
          <a href="mailto:privacy@thescreenreport.com">privacy@thescreenreport.com</a>. EEA/UK
          users also have the right to complain to their local supervisory authority; India users
          may escalate an unresolved grievance to the Data Protection Board of India.
        </p>
      </div>
    </div>
  );
}
