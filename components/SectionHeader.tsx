import Link from "next/link";

function Chevron() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ml-1 inline-block align-[-1px]"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

// Section head: condensed-display caps sitting ON a 2px ink rule, italic serif
// tagline beside it, CTA right-aligned on the same baseline (spec §C3).
export default function SectionHeader({
  title,
  tagline,
  href,
  cta = "See All",
  center = false,
}: {
  title: string;
  tagline?: string;
  href?: string;
  cta?: string;
  center?: boolean;
}) {
  if (center) {
    return (
      <div className="mb-6 border-b-2 border-ink pb-2 text-center">
        <h2 className="sect-head">
          {href ? <Link href={href}>{title}</Link> : title}
        </h2>
        {tagline ? <p className="sect-tag mt-1.5">{tagline}</p> : null}
      </div>
    );
  }
  return (
    <div className="mb-6 flex items-end justify-between gap-3 border-b-2 border-ink pb-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="sect-head">
          {href ? <Link href={href}>{title}</Link> : title}
        </h2>
        {tagline ? <span className="sect-tag hidden sm:inline">{tagline}</span> : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="meta-mono shrink-0 whitespace-nowrap transition-colors duration-150 hover:text-red"
        >
          {cta}
          <Chevron />
        </Link>
      ) : null}
    </div>
  );
}
