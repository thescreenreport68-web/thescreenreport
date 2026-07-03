"use client";

import { useState } from "react";
import { CATEGORIES } from "@/lib/site";

// Renders the article's real image when `src` is provided. Without one — or when
// a hotlinked image 404s/blocks at runtime — it renders a branded typographic
// card (mist ground, hairline mat, ghosted logotype) — never random stock, never
// a broken-image glyph (spec §F9).
export default function PlaceholderImage({
  slug,
  category,
  title,
  className = "",
  showTitle = false,
  src,
  alt,
  eager = false,
  width,
  height,
}: {
  slug: string;
  category?: string;
  title?: string;
  className?: string;
  showTitle?: boolean;
  src?: string;
  alt?: string;
  eager?: boolean;
  width?: number;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);
  const catName =
    CATEGORIES.find((c) => c.slug === category)?.name ?? "The Screen Report";
  const altText = alt || title || catName;

  if (!src || failed) {
    return (
      <div
        className={`relative isolate overflow-hidden bg-mist ${className}`}
        role="img"
        aria-label={altText}
      >
        <div className="absolute inset-1.5 flex items-center justify-center border border-ink/15">
          <div className="px-4 text-center">
            <span className="kicker text-ink/40">{catName}</span>
            <div className="mt-2 font-display text-2xl font-bold italic leading-none text-ink/20">
              The Screen Report
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative isolate overflow-hidden bg-mist ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={altText}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        decoding={eager ? "auto" : "async"}
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover object-[center_30%]"
      />
      {showTitle && title ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5">
            <span className="kicker inline-block bg-red px-2 py-1 text-paper">
              {catName}
            </span>
            <h3 className="mt-2 max-w-[22ch] font-display text-2xl font-bold leading-tight text-paper">
              {title}
            </h3>
          </div>
        </>
      ) : null}
    </div>
  );
}
