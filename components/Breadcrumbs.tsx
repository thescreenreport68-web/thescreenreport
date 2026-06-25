import Link from "next/link";

export type Crumb = { href?: string; label: string };

export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="my-3">
      <ol className="flex flex-wrap items-center gap-1.5 font-sans text-[13px] font-bold uppercase tracking-[0.04em]">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {it.href ? (
              <Link href={it.href} className="text-breaking hover:text-slate">
                {it.label}
              </Link>
            ) : (
              <span className="text-breaking">{it.label}</span>
            )}
            {i < items.length - 1 ? (
              <span className="text-breaking" aria-hidden>
                ›
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
