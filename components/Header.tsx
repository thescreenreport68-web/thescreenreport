import Link from "next/link";

// Premium THR-style category nav with subcategory dropdowns. Top-level links point
// to real category pages where they exist; the rest are presentational for now.
const NAV = [
  { label: "News", href: "/", subs: ["Film News", "TV News", "Celebrity", "Streaming"] },
  { label: "Film", href: "/movies/", subs: ["Film News", "Reviews", "Box Office", "Trailers", "Features"] },
  { label: "TV", href: "/tv/", subs: ["TV News", "Recaps", "Reviews", "Streaming"] },
  { label: "Streaming", href: "/streaming/", subs: ["Netflix", "Max", "Prime Video", "Apple TV+", "Disney+"] },
  { label: "Awards", href: "/", subs: ["Oscars", "Emmys", "Golden Globes", "Cannes"] },
  { label: "Celebrity", href: "/celebrity/", subs: ["Interviews", "Style", "Profiles"] },
  { label: "Reviews", href: "/reviews/", subs: ["Movie Reviews", "TV Reviews"] },
  { label: "Lists", href: "/", subs: ["Best Movies", "Best Shows", "Rankings"] },
  { label: "Video", href: "/", subs: ["Trailers", "Interviews", "Roundtables"] },
];

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
      <div className="mx-auto flex max-w-wide items-center gap-3 px-4 py-5">
        <div className="flex flex-1 items-center gap-4">
          <details className="relative lg:hidden">
            <summary className="flex cursor-pointer list-none items-center text-navy">
              <Hamburger />
            </summary>
            <div className="absolute left-0 z-50 mt-3 max-h-[70vh] w-56 overflow-auto rounded border border-hair bg-white p-2 shadow-xl">
              {NAV.map((n) => (
                <Link
                  key={n.label}
                  href={n.href}
                  className="block rounded px-3 py-2 text-sm font-bold uppercase tracking-wide text-navy hover:bg-mist"
                >
                  {n.label}
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

      {/* Category nav bar with dropdowns */}
      <nav className="hidden border-y border-hair lg:block" aria-label="Primary">
        <div className="mx-auto flex max-w-wide items-center justify-center gap-7 px-4">
          {NAV.map((n) => (
            <div key={n.label} className="group relative">
              <Link
                href={n.href}
                className="block py-3 text-[13px] font-bold uppercase tracking-[0.08em] text-navy hover:text-gold"
              >
                {n.label}
              </Link>
              <div className="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 opacity-0 transition duration-150 group-hover:visible group-hover:opacity-100">
                <div className="w-52 rounded-b border border-hair bg-white p-2 shadow-xl">
                  {n.subs.map((s) => (
                    <Link
                      key={s}
                      href={n.href}
                      className="block rounded px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy hover:bg-mist hover:text-gold"
                    >
                      {s}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </nav>
    </header>
  );
}
