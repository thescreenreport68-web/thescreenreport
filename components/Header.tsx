"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/site";
import { WordmarkLink, TsrMark } from "./Wordmark";

function Hamburger({ open }: { open: boolean }) {
  return open ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

// Global chrome (spec §B2): full masthead + hairline nav row that condenses to a
// 52px bar on scroll; a full-screen white overlay menu on mobile (no rounded
// dropdown cards); desktop nav is flat — subsections live in the menu overlay
// and each category page's subnav.
export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 100);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the overlay on route change.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.documentElement.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 bg-paper/95 backdrop-blur">
      {/* Masthead — collapses on desktop scroll (THR-style), always shown on mobile */}
      <div
        className={`overflow-hidden transition-all duration-300 ${
          scrolled ? "lg:max-h-0 lg:opacity-0" : "lg:max-h-40 lg:opacity-100"
        }`}
      >
        <div className="mx-auto flex max-w-wide items-center gap-3 px-4 py-5 lg:py-6">
          <div className="flex flex-1 items-center gap-4">
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="text-ink transition-colors duration-150 hover:text-red lg:hidden"
            >
              <Hamburger open={menuOpen} />
            </button>
            <Link
              href="/search/"
              aria-label="Search"
              className="text-ink transition-colors duration-150 hover:text-red"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </Link>
            <Link
              href="/contact/"
              className="nav-link hidden text-[11px] sm:inline"
            >
              Got a Tip?
            </Link>
          </div>

          <WordmarkLink markClassName="text-[26px] sm:text-4xl lg:text-[52px]" />

          <div className="flex flex-1 items-center justify-end gap-5">
            <Link
              href="/about/"
              className="nav-link hidden text-[11px] sm:inline"
            >
              About
            </Link>
            <Link href="#newsletter" className="nav-link text-[11px] text-red hover:text-red-dark">
              Newsletter
            </Link>
          </div>
        </div>
      </div>

      {/* Nav row — hairline-framed; shows the compact logotype inline when scrolled */}
      <nav
        className="hidden border-y border-ink lg:block"
        aria-label="Primary"
      >
        <div
          className={`mx-auto flex h-[52px] max-w-wide items-center gap-7 px-4 ${
            scrolled ? "justify-start" : "justify-center"
          }`}
        >
          {scrolled ? <TsrMark /> : null}
          {NAV.map((n) => (
            <Link key={n.label} href={n.href} className="nav-link py-2">
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
      {/* Mobile: single hairline under the masthead */}
      <div className="border-b border-ink lg:hidden" />

      {/* Full-screen menu overlay (mobile + tablet) */}
      {menuOpen ? (
        <div className="fixed inset-x-0 bottom-0 top-0 z-40 overflow-y-auto bg-paper pt-20 lg:hidden">
          <div className="container-wide pb-16">
            {NAV.map((n) => (
              <div key={n.label} className="border-b border-hair py-4">
                <Link
                  href={n.href}
                  className="font-display text-[22px] font-bold uppercase leading-none tracking-[0.005em] text-ink transition-colors duration-150 hover:text-red"
                >
                  {n.label}
                </Link>
                {n.subs.length ? (
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                    {n.subs.map((s) => (
                      <Link
                        key={s.href}
                        href={s.href}
                        className="byline transition-colors duration-150 hover:text-red"
                      >
                        {s.name}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
              <Link href="/search/" className="nav-link text-[11px]">
                Search
              </Link>
              <Link href="/about/" className="nav-link text-[11px]">
                About
              </Link>
              <Link href="/editorial-standards/" className="nav-link text-[11px]">
                Editorial Standards
              </Link>
              <Link href="/contact/" className="nav-link text-[11px]">
                Contact
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
