import Link from "next/link";
import { formatDate } from "@/lib/format";
import { getAuthor } from "@/lib/site";

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);
}

export default function Byline({
  author,
  date,
  updated,
  readingTime,
}: {
  author: string;
  date: string;
  updated?: string;
  readingTime: number;
}) {
  const a = getAuthor(author);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-navy/60">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy font-serif text-sm font-bold text-white">
          {initials(a?.name ?? "SR")}
        </span>
        <span>
          By{" "}
          <Link
            href={`/author/${author}/`}
            className="font-semibold text-navy hover:text-gold-600"
          >
            {a?.name ?? "The Screen Report"}
          </Link>
          {a?.role ? <span className="text-navy/50">, {a.role}</span> : null}
        </span>
      </div>
      <span aria-hidden className="text-navy/30">
        ·
      </span>
      <span>{updated ? `Updated ${formatDate(updated)}` : formatDate(date)}</span>
      <span aria-hidden className="text-navy/30">
        ·
      </span>
      <span>{readingTime} min read</span>
      <span className="rounded-sm bg-mist px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy/60">
        AI-assisted
      </span>
    </div>
  );
}
