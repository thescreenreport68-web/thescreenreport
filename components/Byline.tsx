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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy font-display text-sm font-semibold text-white">
        {initials(a?.name ?? "SR")}
      </span>
      <div className="leading-tight">
        <div className="font-sans text-[13px]">
          <span className="text-faint">By </span>
          <Link
            href={`/author/${author}/`}
            className="font-semibold uppercase tracking-wide text-navy hover:text-gold-600"
          >
            {a?.name ?? "The Screen Report"}
          </Link>
        </div>
        <div className="mt-0.5 font-sans text-xs text-faint">
          {a?.role ? <span>{a.role} · </span> : null}
          {updated ? `Updated ${formatDate(updated)}` : formatDate(date)} ·{" "}
          {readingTime} min read
        </div>
      </div>
      <span className="ml-auto rounded-sm bg-mist px-2 py-1 font-sans text-[10px] font-semibold uppercase tracking-wide text-slate">
        AI-assisted
      </span>
    </div>
  );
}
