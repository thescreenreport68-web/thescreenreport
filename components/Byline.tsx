import Link from "next/link";
import CopyLinkButton from "./CopyLinkButton";
import { formatDateShort, formatTime } from "@/lib/format";
import { getAuthor, SITE } from "@/lib/site";

// Working share links (spec §D5) — real intent URLs, square hairline buttons
// that invert to red on hover. No dead controls.
function ShareLink({
  href,
  label,
  d,
}: {
  href: string;
  label: string;
  d: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center border border-slate text-slate transition-colors duration-150 hover:border-red hover:bg-red hover:text-paper"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d={d} />
      </svg>
    </a>
  );
}

export default function Byline({
  author,
  date,
  updated,
  url,
  title,
  readingTime,
}: {
  author: string;
  date: string;
  updated?: string;
  url?: string;
  title?: string;
  readingTime?: number;
}) {
  const a = getAuthor(author);
  const shareUrl = url ? `${SITE.url}${url}` : SITE.url;
  const shareText = encodeURIComponent(title ?? SITE.name);
  const encodedUrl = encodeURIComponent(shareUrl);
  const wasUpdated = updated && updated !== date;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-y border-hair py-3">
      <div className="byline">
        <span className="font-normal normal-case text-slate">By </span>
        <Link
          href={`/author/${author}/`}
          className="text-ink transition-colors duration-150 hover:text-red"
        >
          {a?.name ?? "The Screen Report"}
        </Link>
      </div>
      <div className="meta-mono flex items-baseline gap-2">
        {wasUpdated ? <span className="text-red">Updated</span> : null}
        <time dateTime={wasUpdated ? updated : date}>
          {formatDateShort(wasUpdated ? updated : date)}{" "}
          {formatTime(wasUpdated ? updated : date)}
        </time>
        {readingTime ? <span aria-hidden>·</span> : null}
        {readingTime ? <span>{readingTime} min read</span> : null}
      </div>
      <div className="ml-auto flex gap-2">
        <ShareLink
          label="Share on X"
          href={`https://twitter.com/intent/tweet?text=${shareText}&url=${encodedUrl}`}
          d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"
        />
        <ShareLink
          label="Share on Facebook"
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
          d="M13.5 9H16l.5-3h-3V4.2c0-.86.24-1.45 1.48-1.45H16.6V.1C16.26.06 15.3 0 14.2 0 11.9 0 10.35 1.38 10.35 3.9V6h-2.6v3h2.6v9h3.15V9Z"
        />
        <ShareLink
          label="Share by email"
          href={`mailto:?subject=${shareText}&body=${encodedUrl}`}
          d="M1.5 4.5h21v15h-21v-15Zm1.9 1.9v.9l8.6 5.4 8.6-5.4v-.9l-8.6 5.4-8.6-5.4Z"
        />
        <CopyLinkButton url={shareUrl} />
      </div>
    </div>
  );
}
