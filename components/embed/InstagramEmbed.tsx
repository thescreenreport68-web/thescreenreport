"use client";

import { InstagramEmbed as RSMEInstagram } from "react-social-media-embed";

/* Official Instagram embed behind react-social-media-embed (loads IG's own embed.js, no Meta app).
   EMBED ONLY — never screenshot or re-host. */
export default function InstagramEmbed({ url }: { url: string }) {
  if (!url) return null;
  return (
    <div className="flex justify-center">
      <RSMEInstagram url={url} width="100%" />
    </div>
  );
}
