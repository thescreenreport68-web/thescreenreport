import Link from "next/link";
import { Wordmark } from "./Wordmark";
import { SITE, CATEGORIES, getSubcategoriesForCategory } from "@/lib/site";

const COMPANY = [
  { href: "/about/", label: "About The Screen Report" },
  { href: "/editorial-standards/", label: "Editorial Standards" },
  { href: "/corrections/", label: "Corrections" },
  { href: "/ethics/", label: "Ethics & Ownership" },
  { href: "/contact/", label: "Contact & Tips" },
  { href: "/report/", label: "Report a Problem" },
];

const LEGAL = [
  { href: "/privacy/", label: "Privacy Policy" },
  { href: "/terms/", label: "Terms of Service" },
  { href: "/dmca/", label: "DMCA" },
];

const SOCIAL = [
  {
    label: "X",
    href: "https://twitter.com/thescreenreport",
    d: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z",
  },
];

function ColumnHead({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="font-sans text-[13px] font-bold uppercase tracking-[0.05em] text-ink">
      {children}
    </h4>
  );
}

function FooterLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="font-sans text-sm text-slate transition-colors duration-150 hover:text-red"
    >
      {label}
    </Link>
  );
}

// Premium footer (spec §B3): boxed sitemap columns on white → black band with
// social + newsletter + the AI-newsroom disclosure → mono legal row.
export default function Footer() {
  const sections = CATEGORIES.map((c) => ({
    ...c,
    subs: getSubcategoriesForCategory(c.slug),
  }));
  const [first, second] = [sections.slice(0, 4), sections.slice(4)];

  return (
    <footer className="mt-16">
      {/* Sitemap columns */}
      <div className="border-t-2 border-ink">
        <div className="container-wide grid gap-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-hair p-5">
            <ColumnHead>Sections</ColumnHead>
            <ul className="mt-3 space-y-2">
              {first.map((c) => (
                <li key={c.slug}>
                  <FooterLink href={`/${c.slug}/`} label={c.name} />
                </li>
              ))}
            </ul>
          </div>
          <div className="border border-hair p-5">
            <ColumnHead>More Coverage</ColumnHead>
            <ul className="mt-3 space-y-2">
              {second.map((c) => (
                <li key={c.slug}>
                  <FooterLink href={`/${c.slug}/`} label={c.name} />
                </li>
              ))}
              <li>
                <FooterLink href="/news/" label="All the Latest News" />
              </li>
            </ul>
          </div>
          <div className="border border-hair p-5">
            <ColumnHead>The Company</ColumnHead>
            <ul className="mt-3 space-y-2">
              {COMPANY.map((t) => (
                <li key={t.href}>
                  <FooterLink href={t.href} label={t.label} />
                </li>
              ))}
            </ul>
          </div>
          <div className="border border-hair p-5">
            <ColumnHead>Legal</ColumnHead>
            <ul className="mt-3 space-y-2">
              {LEGAL.map((t) => (
                <li key={t.href}>
                  <FooterLink href={t.href} label={t.label} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Black band */}
      <div className="bg-ink text-paper">
        <div className="container-wide grid items-center gap-8 py-10 lg:grid-cols-2">
          <div>
            <Wordmark className="text-[30px] text-paper" />
            <p className="mt-3 max-w-md font-body text-sm leading-relaxed text-paper/70">
              {SITE.description}
            </p>
            <div className="mt-4 flex items-center gap-4">
              <span className="byline text-paper/60">Follow</span>
              {SOCIAL.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`The Screen Report on ${s.label}`}
                  className="text-paper/80 transition-colors duration-150 hover:text-red"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d={s.d} />
                  </svg>
                </a>
              ))}
            </div>
          </div>
          <div id="newsletter-footer">
            <div className="font-display text-xl font-bold uppercase tracking-[0.005em]">
              The Screen Report Daily
            </div>
            <p className="mt-1.5 font-body text-sm italic text-paper/70">
              Every story that matters in film and TV, each morning.
            </p>
            <form
              className="mt-4 flex max-w-md"
              action="#"
              aria-label="Newsletter signup"
            >
              <input
                type="email"
                required
                placeholder="Your email address"
                className="w-full border border-paper/40 bg-transparent px-3 py-2.5 font-sans text-sm text-paper placeholder:text-paper/40 focus:border-paper focus:outline-none"
              />
              <button className="btn-label whitespace-nowrap bg-red px-5 py-2.5 text-paper transition-colors duration-150 hover:bg-red-dark">
                Sign Up
              </button>
            </form>
            <p className="meta-mono mt-3 text-paper/40">
              No spam. Unsubscribe anytime.
            </p>
          </div>
        </div>
      </div>

      {/* Legal row */}
      <div className="bg-ink text-paper/50">
        <div className="container-wide flex flex-col gap-2 border-t border-paper/15 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="meta-mono text-paper/50">
            © {new Date().getFullYear()} The Screen Report. All rights reserved.
          </p>
          <p className="meta-mono text-paper/50">
            An AI-assisted newsroom —{" "}
            <Link
              href="/editorial-standards/"
              className="underline decoration-paper/30 underline-offset-2 transition-colors duration-150 hover:text-paper"
            >
              our editorial standards
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
