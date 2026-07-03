import Link from "next/link";
import { getAuthor } from "@/lib/site";

// Deframed author unit (spec §D11): a 2px ink rule, no card, no initials bubble —
// the org byline plus the standards links that carry the E-E-A-T weight.
export default function AuthorBox({ author }: { author: string }) {
  const a = getAuthor(author);
  if (!a) return null;
  return (
    <aside className="mt-10 border-t-2 border-ink pt-4">
      <div className="kicker text-ink">{a.role}</div>
      <Link
        href={`/author/${a.slug}/`}
        className="hed-l mt-2 inline-block text-xl transition-colors duration-150 hover:text-red"
      >
        {a.name}
      </Link>
      <p className="mt-2 max-w-prose font-body text-[0.95rem] leading-relaxed text-slate">
        {a.bio}
      </p>
      <p className="byline mt-3">
        <Link
          href="/editorial-standards/"
          className="transition-colors duration-150 hover:text-red"
        >
          Editorial Standards
        </Link>
        <span className="mx-2 text-gray" aria-hidden>
          /
        </span>
        <Link
          href="/corrections/"
          className="transition-colors duration-150 hover:text-red"
        >
          Corrections
        </Link>
      </p>
    </aside>
  );
}
