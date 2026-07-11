"use client";

import { useEffect } from "react";

/* Official Reddit embed (REV 5 — the audience discussion IS the story): a blockquote pointing at
   the thread/comment permalink + Reddit's own embed.js, which runs in the READER's browser and
   swaps in the rendered card. EMBED ONLY — the post renders from Reddit's servers; we never call
   Reddit from our pipeline (so Reddit's datacenter-IP block never touches us) and never re-host.
   Before hydration the blockquote shows a link, so it is never blank. */
export default function RedditEmbed({ url }: { url: string }) {
  useEffect(() => {
    // Keep EXACTLY ONE widgets.js on the page: remove any prior copy, then add a fresh one so it
    // re-scans (covers multiple embeds + client-side route changes) without scripts accumulating.
    document.querySelectorAll('script[src="https://embed.reddit.com/widgets.js"]').forEach((n) => n.remove());
    const s = document.createElement("script");
    s.src = "https://embed.reddit.com/widgets.js";
    s.async = true;
    s.setAttribute("charset", "UTF-8");
    document.body.appendChild(s);
    return () => { s.remove(); };
  }, [url]);

  // Require an actual reddit.com host (not merely a substring) before building the href.
  let href: string | null = null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://www.reddit.com${url}`);
    if (/(^|\.)reddit\.com$/i.test(u.hostname)) href = u.href;
  } catch {
    href = null;
  }
  if (!href) return null;
  return (
    <div className="flex justify-center">
      <blockquote className="reddit-embed-bq" data-embed-height="316" style={{ maxWidth: 640, width: "100%" }}>
        <a href={href} target="_blank" rel="noopener noreferrer">
          View the discussion on Reddit
        </a>
      </blockquote>
    </div>
  );
}
