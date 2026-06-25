import Link from "next/link";
import { SITE, CATEGORIES } from "@/lib/site";

const TRUST = [
  { href: "/about/", label: "About" },
  { href: "/editorial-standards/", label: "Editorial Standards" },
  { href: "/corrections/", label: "Corrections" },
  { href: "/ethics/", label: "Ethics & Ownership" },
  { href: "/contact/", label: "Contact" },
  { href: "/privacy/", label: "Privacy Policy" },
  { href: "/dmca/", label: "DMCA" },
];

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-navy/10 bg-navy text-white">
      <div className="mx-auto max-w-wide px-4 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <div className="font-display text-2xl font-semibold italic">
              The Screen Report<span className="not-italic text-gold">.</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              {SITE.description}
            </p>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-gold">
              Sections
            </h4>
            <ul className="mt-3 space-y-2 text-sm text-white/80">
              {CATEGORIES.map((c) => (
                <li key={c.slug}>
                  <Link href={`/${c.slug}/`} className="hover:text-gold">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-gold">
              Company
            </h4>
            <ul className="mt-3 space-y-2 text-sm text-white/80">
              {TRUST.map((t) => (
                <li key={t.href}>
                  <Link href={t.href} className="hover:text-gold">
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div id="newsletter">
            <h4 className="text-xs font-bold uppercase tracking-widest text-gold">
              Newsletter
            </h4>
            <p className="mt-3 text-sm text-white/70">
              The day&apos;s biggest stories, in your inbox.
            </p>
            <form className="mt-3 flex gap-2" action="#" aria-label="Newsletter signup">
              <input
                type="email"
                placeholder="Your email"
                className="w-full rounded-sm px-3 py-2 text-sm text-ink"
              />
              <button className="rounded-sm bg-gold px-3 py-2 text-sm font-bold text-navy hover:bg-gold-600">
                Join
              </button>
            </form>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 text-xs text-white/50">
          <p>© {new Date().getFullYear()} The Screen Report. All rights reserved.</p>
          <p className="mt-2">
            The Screen Report runs an AI-assisted newsroom. Every story is produced and
            checked against our{" "}
            <Link href="/editorial-standards/" className="underline hover:text-gold">
              Editorial Standards
            </Link>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
