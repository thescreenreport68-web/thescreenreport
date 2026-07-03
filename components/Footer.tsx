import Link from "next/link";
import { SITE, CATEGORIES } from "@/lib/site";

const COMPANY = [
  { href: "/about/", label: "About The Screen Report" },
  { href: "/editorial-standards/", label: "Editorial Standards" },
  { href: "/corrections/", label: "Corrections" },
  { href: "/ethics/", label: "Ethics & Ownership" },
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
    <h4 className="font-sans text-[13px] font-bold uppercase tracking-[0.08em] text-paper">
      {children}
    </h4>
  );
}

function FooterLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="font-sans text-sm leading-none text-paper/60 transition-colors duration-150 hover:text-paper"
    >
      {label}
    </Link>
  );
}

/* The footer — THR's black-slab architecture executed in our grammar
   (spec §B3 rebuilt, owner 2026-07-03): giant native-type TSR. monogram as the
   visual anchor (their slot holds a magazine cover), hairline-ruled link
   columns, a newsletter | tip split band, then the flipped white legal strip. */
export default function Footer() {
  const [sections, more] = [CATEGORIES.slice(0, 4), CATEGORIES.slice(4)];

  return (
    <footer className="mt-16 bg-ink text-paper">
      {/* Anchor + link columns */}
      <div className="container-wide grid gap-x-8 gap-y-12 py-14 lg:grid-cols-[minmax(0,1.15fr)_2fr] lg:py-16">
        <div>
          <Link href="/" aria-label="The Screen Report — home" className="inline-block">
            <span
              className="inline-block font-display text-[96px] font-bold leading-none text-paper sm:text-[120px]"
              style={{
                transform: "scaleY(1.16) scaleX(0.95)",
                transformOrigin: "left center",
                letterSpacing: "-0.01em",
              }}
            >
              T<span className="italic">S</span>R<span className="text-red">.</span>
            </span>
          </Link>
          <p className="mt-5 max-w-sm font-body text-sm leading-relaxed text-paper/60">
            {SITE.description}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4 lg:border-l lg:border-paper/15 lg:pl-10">
          <div>
            <ColumnHead>Sections</ColumnHead>
            <ul className="mt-4 space-y-3">
              {sections.map((c) => (
                <li key={c.slug}>
                  <FooterLink href={`/${c.slug}/`} label={c.name} />
                </li>
              ))}
              <li>
                <FooterLink href="/news/" label="Latest News" />
              </li>
            </ul>
          </div>
          <div>
            <ColumnHead>More</ColumnHead>
            <ul className="mt-4 space-y-3">
              {more.map((c) => (
                <li key={c.slug}>
                  <FooterLink href={`/${c.slug}/`} label={c.name} />
                </li>
              ))}
              <li>
                <FooterLink href="/contact/" label="Contact & Tips" />
              </li>
            </ul>
          </div>
          <div>
            <ColumnHead>The Company</ColumnHead>
            <ul className="mt-4 space-y-3">
              {COMPANY.map((t) => (
                <li key={t.href}>
                  <FooterLink href={t.href} label={t.label} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <ColumnHead>Legal</ColumnHead>
            <ul className="mt-4 space-y-3">
              {LEGAL.map((t) => (
                <li key={t.href}>
                  <FooterLink href={t.href} label={t.label} />
                </li>
              ))}
            </ul>
            <h4 className="mt-8 font-sans text-[13px] font-bold uppercase tracking-[0.08em] text-paper">
              Follow Us
            </h4>
            <ul className="mt-4 space-y-3">
              {SOCIAL.map((s) => (
                <li key={s.label}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`The Screen Report on ${s.label}`}
                    className="inline-flex items-center gap-2.5 font-sans text-sm text-paper/60 transition-colors duration-150 hover:text-paper"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d={s.d} />
                    </svg>
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Newsletter | Tip band */}
      <div className="border-t border-paper/15">
        <div className="container-wide grid gap-10 py-10 lg:grid-cols-2 lg:gap-0">
          <div id="newsletter-footer" className="lg:pr-12">
            <h4 className="font-display text-xl font-bold uppercase tracking-[0.005em] text-paper">
              The Screen Report Daily
            </h4>
            <p className="mt-1.5 font-body text-sm italic text-paper/60">
              Every story that matters in film and TV, each morning.
            </p>
            <form className="mt-4 flex max-w-md" action="#" aria-label="Newsletter signup">
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
            <p className="meta-mono mt-3 text-paper/40">No spam. Unsubscribe anytime.</p>
          </div>
          <div className="lg:border-l lg:border-paper/15 lg:pl-12">
            <h4 className="font-display text-xl font-bold uppercase tracking-[0.005em] text-paper">
              Have a Tip?
            </h4>
            <p className="mt-1.5 font-body text-sm italic text-paper/60">
              Know something we should be reporting? We read everything.
            </p>
            <Link
              href="/contact/"
              className="btn-label mt-5 inline-flex items-center gap-2 border border-paper/40 px-5 py-3 text-paper transition-colors duration-150 hover:border-red hover:bg-red"
            >
              Send Us a Tip
              <span aria-hidden>›</span>
            </Link>
            <p className="meta-mono mt-3 text-paper/40">
              Confidential. tips@thescreenreport.com
            </p>
          </div>
        </div>
      </div>

      {/* Flipped legal strip */}
      <div className="border-t border-paper/15 bg-paper text-ink">
        <div className="container-wide flex flex-col gap-2 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="meta-mono">
            © {new Date().getFullYear()} The Screen Report. All rights reserved.
          </p>
          <p className="meta-mono">
            An AI-assisted newsroom —{" "}
            <Link
              href="/editorial-standards/"
              className="underline decoration-ink/30 underline-offset-2 transition-colors duration-150 hover:text-red"
            >
              our editorial standards
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
