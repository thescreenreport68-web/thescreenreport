"use client";

import { useEffect } from "react";

/* Official Bluesky embed (REV 4 — the audience posts ARE the story): blockquote with the post's
   at-uri + Bluesky's own embed.js, exactly the platform's sanctioned pattern (same shape as the
   Instagram embed). EMBED ONLY — the post renders from Bluesky's servers; we never re-host.
   Before hydration the blockquote shows the post text + a link, so nothing is ever blank. */
export default function BlueskyEmbed({ uri, text }: { uri: string; text?: string }) {
  useEffect(() => {
    const w = window as typeof window & { __bskyEmbedLoaded?: boolean };
    if (w.__bskyEmbedLoaded) {
      // the script scans on load only — poke it for late-mounted embeds
      document.dispatchEvent(new Event("bluesky:refresh"));
      const s = document.createElement("script");
      s.src = "https://embed.bsky.app/static/embed.js";
      s.async = true;
      document.body.appendChild(s);
      return;
    }
    w.__bskyEmbedLoaded = true;
    const s = document.createElement("script");
    s.src = "https://embed.bsky.app/static/embed.js";
    s.async = true;
    document.body.appendChild(s);
  }, [uri]);

  if (!uri?.startsWith("at://")) return null;
  const [, did, , rkey] = uri.replace("at://", "").split("/").length >= 3
    ? ["", ...uri.replace("at://", "").split("/")]
    : ["", "", "", ""];
  const href = did && rkey ? `https://bsky.app/profile/${did}/post/${rkey}` : "https://bsky.app";
  return (
    <div className="flex justify-center">
      <blockquote className="bluesky-embed" data-bluesky-uri={uri} style={{ maxWidth: 600, width: "100%" }}>
        {text ? <p>{text}</p> : null}
        <a href={href} target="_blank" rel="noopener noreferrer">
          View the post on Bluesky
        </a>
      </blockquote>
    </div>
  );
}
