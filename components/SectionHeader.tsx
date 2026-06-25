import Link from "next/link";

// The Hollywood Reporter section-header pattern: serif title + small italic tagline
// + "See all" link, sitting on a thin navy hairline with a short gold accent tick.
export default function SectionHeader({
  title,
  tagline,
  href,
  cta = "See all",
  center = false,
  accent = "text-gold-600",
}: {
  title: string;
  tagline?: string;
  href?: string;
  cta?: string;
  center?: boolean;
  accent?: string;
}) {
  if (center) {
    return (
      <div className="mb-6 text-center">
        <h2 className="font-display text-3xl font-semibold uppercase tracking-tight text-navy">
          {title}
        </h2>
        {tagline ? (
          <p className="mt-1 font-dek text-sm italic text-faint">{tagline}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="relative mb-6 border-b border-navy/15 pb-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-navy sm:text-[1.7rem]">
            {title}
          </h2>
          {tagline ? (
            <span className="font-dek text-sm italic text-faint">{tagline}</span>
          ) : null}
        </div>
        {href ? (
          <Link
            href={href}
            className={`font-sans text-xs font-bold uppercase tracking-[0.14em] hover:text-navy ${accent}`}
          >
            {cta} →
          </Link>
        ) : null}
      </div>
      <span className="absolute -bottom-px left-0 h-0.5 w-12 bg-gold" />
    </div>
  );
}
