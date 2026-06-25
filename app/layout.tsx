import type { Metadata } from "next";
import {
  Bodoni_Moda,
  Newsreader,
  Source_Serif_4,
  Hanken_Grotesk,
} from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { SITE } from "@/lib/site";

// Display / headlines / masthead — high-contrast Didone with an optical-size axis.
const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  style: ["normal", "italic"],
});

// Deks / standfirsts / pull quotes — elegant editorial italic.
const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dek",
  style: ["italic", "normal"],
});

// Body copy — cohesive serif superfamily, text-optimized.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

// Labels / kickers / nav / bylines / UI — refined grotesque.
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s — ${SITE.name}`,
  },
  description: SITE.description,
  // PRE-LAUNCH: the whole site is noindex so Google can't see seed content.
  // Flip this to { index: true, follow: true } on launch day.
  robots: { index: false, follow: false },
  openGraph: {
    siteName: SITE.name,
    type: "website",
    locale: SITE.locale,
    url: SITE.url,
    title: SITE.name,
    description: SITE.description,
  },
  twitter: { card: "summary_large_image", site: SITE.twitter },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${bodoni.variable} ${newsreader.variable} ${sourceSerif.variable} ${hanken.variable}`}
    >
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
