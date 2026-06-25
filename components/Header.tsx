import Link from "next/link";
import { NAV } from "@/lib/site";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-navy/10 bg-white/95 backdrop-blur">
      {/* Utility bar */}
      <div className="hidden bg-navy text-white md:block">
        <div className="mx-auto flex max-w-wide items-center justify-between px-4 py-1.5 text-xs">
          <span className="tracking-wide text-white/80">Hollywood, decoded.</span>
          <div className="flex items-center gap-4 text-white/80">
            <Link href="/about/" className="hover:text-gold">
              About
            </Link>
            <Link href="/editorial-standards/" className="hover:text-gold">
              Standards
            </Link>
            <Link href="/contact/" className="hover:text-gold">
              Contact
            </Link>
          </div>
        </div>
      </div>

      {/* Main bar */}
      <div className="mx-auto flex max-w-wide items-center justify-between gap-4 px-4 py-3">
        <Link
          href="/"
          className="font-display text-[1.7rem] font-semibold italic leading-none tracking-tight text-navy sm:text-[2rem]"
        >
          The Screen Report<span className="not-italic text-gold">.</span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex" aria-label="Primary">
          {NAV.map((c) => (
            <Link
              key={c.slug}
              href={`/${c.slug}/`}
              className="text-sm font-semibold uppercase tracking-wide text-navy hover:text-gold-600"
            >
              {c.name}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="#newsletter"
            className="rounded-sm bg-breaking px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-[#8E0E1E]"
          >
            Subscribe
          </Link>

          {/* Mobile menu (no JS required) */}
          <details className="relative lg:hidden">
            <summary className="cursor-pointer list-none rounded border border-navy/20 px-2.5 py-1.5 text-sm font-semibold text-navy">
              Menu
            </summary>
            <div className="absolute right-0 z-50 mt-2 w-48 rounded border border-navy/10 bg-white p-2 shadow-xl">
              {NAV.map((c) => (
                <Link
                  key={c.slug}
                  href={`/${c.slug}/`}
                  className="block rounded px-3 py-2 text-sm font-semibold text-navy hover:bg-mist"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
