"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NAV } from "@/lib/site";

function Hamburger() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 100);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-t border-ink bg-white/95 backdrop-blur">
      {/* Masthead — collapses on desktop scroll (THR-style), always shown on mobile */}
      <div
        className={`overflow-hidden transition-all duration-300 ${
          scrolled ? "lg:max-h-0 lg:opacity-0" : "lg:max-h-40 lg:opacity-100"
        }`}
      >
        <div className="mx-auto flex max-w-wide items-center gap-3 px-4 py-5">
          <div className="flex flex-1 items-center gap-4">
            <details className="relative lg:hidden">
              <summary className="flex cursor-pointer list-none items-center text-navy">
                <Hamburger />
              </summary>
              <div className="absolute left-0 z-50 mt-3 max-h-[70vh] w-60 overflow-auto rounded border border-hair bg-white p-2 shadow-xl">
                {NAV.map((n) => (
                  <div key={n.label} className="py-1">
                    <Link
                      href={n.href}
                      className="block rounded px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-navy hover:bg-mist"
                    >
                      {n.label}
                    </Link>
                    {n.subs.map((s) => (
                      <Link
                        key={s.href}
                        href={s.href}
                        className="block rounded px-3 py-1 pl-6 text-xs font-semibold uppercase tracking-wide text-slate hover:bg-mist hover:text-gold"
                      >
                        {s.name}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </details>
            <button aria-label="Search" className="text-navy hover:text-gold">
              <SearchIcon />
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
            className="flex-none whitespace-nowrap font-display text-2xl font-bold italic leading-none text-gold sm:text-[2.7rem]"
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
      </div>

      {/* Category nav bar (desktop) — always visible; shows a compact masthead inline when scrolled */}
      <nav className="hidden border-y border-hair lg:block" aria-label="Primary">
        <div
          className={`mx-auto flex max-w-wide items-center gap-7 px-4 ${
            scrolled ? "justify-start" : "justify-center"
          }`}
        >
          {scrolled ? (
            <Link
              href="/"
              className="flex-none whitespace-nowrap font-display text-lg font-bold italic leading-none text-gold"
            >
              The Screen Report
            </Link>
          ) : null}
          {NAV.map((n) => (
            <div key={n.label} className="group relative">
              <Link
                href={n.href}
                className="block py-3 text-[13px] font-bold uppercase tracking-[0.08em] text-navy hover:text-gold"
              >
                {n.label}
              </Link>
              {n.subs.length ? (
                <div className="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 opacity-0 transition duration-150 group-hover:visible group-hover:opacity-100">
                  <div className="w-52 rounded-b border border-hair bg-white p-2 shadow-xl">
                    {n.subs.map((s) => (
                      <Link
                        key={s.href}
                        href={s.href}
                        className="block rounded px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy hover:bg-mist hover:text-gold"
                      >
                        {s.name}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </nav>
    </header>
  );
}
