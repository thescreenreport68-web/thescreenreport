"use client";

import { useState } from "react";

// Tiny client island: copies the canonical article URL. Degrades to nothing
// without JS (the three share links beside it are plain <a> tags).
export default function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Link copied" : "Copy link"}
      title="Copy link"
      onClick={() => {
        navigator.clipboard?.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={`flex h-8 w-8 items-center justify-center border transition-colors duration-150 ${
        copied
          ? "border-red bg-red text-paper"
          : "border-slate text-slate hover:border-red hover:bg-red hover:text-paper"
      }`}
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 1 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 1 0 7.07 7.07l1.5-1.5" />
        </svg>
      )}
    </button>
  );
}
