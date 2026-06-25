import type { Metadata } from "next";
import { Fraunces, Source_Serif_4, Karla } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { SITE } from "@/lib/site";

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

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s — ${SITE.name}`,
  },
  description: SITE.description,
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
      className={`${fraunces.variable} ${sourceSerif.variable} ${karla.variable}`}
    >
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
