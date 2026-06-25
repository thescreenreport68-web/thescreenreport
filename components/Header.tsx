import Link from "next/link";
import { CATEGORIES } from "@/lib/site";

function Hamburger() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function Search() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export default function Header() {
  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur">
      {/* Utility row with centered masthead */}
      <div className="mx-auto flex max-w-wide items-center gap-3 px-4 py-4">
        <div className="flex flex-1 items-center gap-4">
          {/* Mobile menu */}
          <details className="relative lg:hidden">
            <summary className="flex cursor-pointer list-none items-center text-navy">
              <Hamburger />
            </summary>
            <div className="absolute left-0 z-50 mt-3 w-52 rounded border border-hair bg-white p-2 shadow-xl">
              {CATEGORIES.map((c) => (
                <Link
                  key={c.slug}
                  href={`/${c.slug}/`}
                  className="block rounded px-3 py-2 text-sm font-bold uppercase tracking-wide text-navy hover:bg-mist"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </details>
          <button aria-label="Search" className="text-navy hover:text-gold">
            <Search />
          </button>
          <Link
            href="/contact/"
            className="hidden text-[11px] font-bold uppercase tracking-[0.12em] text-navy hover:text-gold sm:inline"
          >
            Got a Tip?
          </Link>
        </div>

        <Link
          href="/"
          className="flex-none whitespace-nowrap font-display text-xl font-bold italic leading-none text-gold sm:text-[2.1rem]"
        >
          The Screen Report
        </Link>

        <div className="flex flex-1 items-center justify-end gap-4">
          <Link
            href="#newsletter"
            className="hidden text-[11px] font-bold uppercase tracking-[0.12em] text-navy hover:text-gold sm:inline"
          >
            Newsletters
          </Link>
          <Link
            href="#newsletter"
            className="text-[11px] font-bold uppercase tracking-[0.12em] text-gold hover:text-gold-600"
          >
            Subscribe
          </Link>
        </div>
      </div>

      {/* Category nav bar */}
      <nav className="hidden border-y border-hair md:block" aria-label="Primary">
        <div className="mx-auto flex max-w-wide items-center justify-center gap-8 px-4 py-2.5">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/${c.slug}/`}
              className="text-[13px] font-bold uppercase tracking-[0.09em] text-navy hover:text-gold"
            >
              {c.name}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
