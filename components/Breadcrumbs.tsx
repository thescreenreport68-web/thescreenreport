import Link from "next/link";

export type Crumb = { href?: string; label: string };

// Breadcrumb demoted to the mono metadata layer (spec §D2) — quiet slate,
// warms to red on hover; the headline keeps the stage.
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="my-3">
      <ol className="meta-mono flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {it.href ? (
              <Link
                href={it.href}
                className="transition-colors duration-150 hover:text-red"
              >
                {it.label}
              </Link>
            ) : (
              <span className="text-ink">{it.label}</span>
            )}
            {i < items.length - 1 ? (
              <span className="text-gray" aria-hidden>
                ›
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
