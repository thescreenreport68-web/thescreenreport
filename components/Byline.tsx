import Link from "next/link";
import { formatDate } from "@/lib/format";
import { getAuthor } from "@/lib/site";

function Share({ d, label }: { d: string; label: string }) {
  return (
    <span
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center border border-slate text-slate transition hover:border-breaking hover:bg-breaking hover:text-white"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d={d} />
      </svg>
    </span>
  );
}

export default function Byline({
  author,
  date,
  updated,
}: {
  author: string;
  date: string;
  updated?: string;
  readingTime?: number;
}) {
  const a = getAuthor(author);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-hair pb-4">
      <div className="font-sans text-[15px] font-bold uppercase tracking-[0.02em]">
        <span className="text-breaking">By </span>
        <Link href={`/author/${author}/`} className="text-breaking hover:text-slate">
          {a?.name ?? "The Screen Report"}
        </Link>
      </div>
      <time className="font-sans text-[15px] uppercase tracking-[0.02em] text-navy">
        {formatDate(updated ?? date)}
      </time>
      <div className="ml-auto flex gap-2">
        <Share
          label="Share on X"
          d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"
        />
        <Share
          label="Share on Facebook"
          d="M13.5 9H16l.5-3h-3V4.2c0-.86.24-1.45 1.48-1.45H16.6V.1C16.26.06 15.3 0 14.2 0 11.9 0 10.35 1.38 10.35 3.9V6h-2.6v3h2.6v9h3.15V9Z"
        />
        <Share
          label="Copy link"
          d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 1 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 1 0 7.07 7.07l1.5-1.5"
        />
      </div>
    </div>
  );
}
