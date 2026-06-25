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
      className="ml-1 inline-block align-middle"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

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
      <div className="mb-5 text-center">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-navy sm:text-[1.8rem]">
          {title}
        </h2>
        {tagline ? (
          <p className="mt-1 font-dek text-base italic text-slate">{tagline}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="mb-5 flex items-end justify-between gap-3 border-b border-hair pb-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-navy sm:text-[1.8rem]">
          {title}
        </h2>
        {tagline ? (
          <span className="font-dek text-base italic text-slate">{tagline}</span>
        ) : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="shrink-0 whitespace-nowrap font-sans text-xs font-bold uppercase tracking-[0.06em] text-slate hover:text-breaking"
        >
          {cta}
          <Chevron />
        </Link>
      ) : null}
    </div>
  );
}
