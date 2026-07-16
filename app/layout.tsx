import type { Metadata } from "next";
import Script from "next/script";
import { Fraunces, Source_Serif_4, Karla, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import AnchorAd from "@/components/AnchorAd";
import Beacon from "@/components/Beacon";
import CloudflareAnalytics from "@/components/CloudflareAnalytics";
import GoogleOneTap from "@/components/GoogleOneTap";
import JsonLd from "@/components/JsonLd";
import { SITE } from "@/lib/site";

const SITE_SCHEMA = [
  {
    "@context": "https://schema.org",
    "@type": "NewsMediaOrganization",
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
    logo: {
      "@type": "ImageObject",
      url: `${SITE.url}${SITE.logoPath}`,
      width: SITE.logoWidth,
      height: SITE.logoHeight,
    },
    sameAs: ["https://twitter.com/thescreenreport"],
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
  },
];

// Headlines / display — Fraunces, loaded with its opsz/SOFT/WONK axes so globals.css
// can pin SOFT=0 / WONK=0. That converts Fraunces from its soft, quirky DEFAULT cut
// (which read as "basic") into a warm, HIGH-CONTRAST editorial serif in the spirit of
// The Hollywood Reporter's Kepler. Optical size stays automatic via font-optical-sizing.
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  axes: ["opsz", "SOFT", "WONK"],
  style: ["normal", "italic"],
});

// Body copy — readable editorial serif.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

// Labels / kickers / nav / bylines — Karla, the exact grotesque The Hollywood Reporter uses.
const karla = Karla({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "700"],
  style: ["normal", "italic"],
});

// Timestamps / credits / folio lines / data — the mono metadata layer THR doesn't have
// (DESIGN_UPGRADE_SPEC.md §A2): the cheapest "more premium than THR" move.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s — ${SITE.name}`,
  },
  description: SITE.description,
  // max-image-preview:large is REQUIRED for Google Discover's large image cards — without it
  // Discover cannot show the big card at all (the playbook's single highest-ROI directive).
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  alternates: { types: { "application/rss+xml": "/feed.xml" } },
  verification: { other: { "p:domain_verify": "732df0e14a6881379e2a7185fdde95a4" } },
  openGraph: {
    siteName: SITE.name,
    type: "website",
    locale: SITE.locale,
    url: SITE.url,
    title: SITE.name,
    description: SITE.description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: SITE.name }],
  },
  twitter: { card: "summary_large_image", site: SITE.twitter, images: ["/og.png"] },
};

export const viewport = { themeColor: "#101010" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${sourceSerif.variable} ${karla.variable} ${plexMono.variable}`}
    >
      <body>
        <a
          href="#content"
          className="btn-label sr-only text-ink focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:bg-paper focus:px-4 focus:py-2"
        >
          Skip to content
        </a>
        <JsonLd data={SITE_SCHEMA} />
        <Script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9157799451949681"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
        <Beacon />
        <CloudflareAnalytics />
        <GoogleOneTap />
        <Header />
        <main id="content">{children}</main>
        <Footer />
        {/* Reserved space for the bottom anchor ad — constant height (even when
            the reader collapses the bar) so content is never hidden behind it
            and collapsing causes zero layout shift. */}
        <div
          aria-hidden
          className="h-[58px] md:h-[98px]"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        />
        <AnchorAd />
      </body>
    </html>
  );
}
