import Link from "next/link";

export default function SectionHeading({
  title,
  href,
  cta = "View all",
}: {
  title: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="section-heading justify-between">
      <h2>{title}</h2>
      {href ? (
        <Link
          href={href}
          className="text-xs font-bold uppercase tracking-wider text-gold-600 hover:text-navy"
        >
          {cta} →
        </Link>
      ) : null}
    </div>
  );
}
