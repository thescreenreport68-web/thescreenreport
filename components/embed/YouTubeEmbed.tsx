"use client";

import LiteYouTubeEmbed from "react-lite-youtube-embed";
import "react-lite-youtube-embed/dist/LiteYouTubeEmbed.css";

/* CWV-safe official YouTube embed: renders a static facade (thumbnail + play button)
   and only loads the privacy youtube-nocookie iframe on click. We embed official
   video only and never re-host it. */
export default function YouTubeEmbed({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  if (!id) return null;
  return (
    <div className="overflow-hidden border border-hair bg-ink">
      <LiteYouTubeEmbed
        id={id}
        title={title}
        noCookie
        poster="hqdefault"
        webp
        wrapperClass="yt-lite"
        playerClass="lty-playbtn"
      />
    </div>
  );
}
