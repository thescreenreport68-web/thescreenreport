"use client";
import { useEffect } from "react";

/* The originating-post "receipt" embed for a gossip story (Step 6). YouTube renders as a plain iframe (handled by
   the caller); this client component handles the platforms that need a widget script (X) or a safe link card
   (Bluesky — its official embed needs an at:// URI + cid we don't resolve in v1). Instagram is deferred until the
   owner completes Meta app review. Keeping this tiny + dependency-free protects the build and avoids hydration risk. */

type Embed = {
  platform: "youtube" | "x" | "bluesky";
  sourceUrl: string;
  handle?: string | null;
  tweetId?: string | null;
};

function ensureScript(src: string, id: string) {
  const w = window as unknown as { twttr?: { widgets?: { load?: () => void } } };
  if (document.getElementById(id)) {
    w.twttr?.widgets?.load?.();
    return;
  }
  const s = document.createElement("script");
  s.src = src;
  s.id = id;
  s.async = true;
  document.body.appendChild(s);
}

export default function SocialEmbed({ embed }: { embed: Embed }) {
  useEffect(() => {
    if (embed.platform === "x") ensureScript("https://platform.twitter.com/widgets.js", "twitter-wjs");
  }, [embed.platform, embed.sourceUrl]);

  if (embed.platform === "x") {
    return (
      <div className="not-prose my-6 flex justify-center">
        <blockquote className="twitter-tweet" data-dnt="true" data-conversation="none">
          <a href={embed.sourceUrl}>{embed.handle ? `@${embed.handle} on X` : "View the post on X"}</a>
        </blockquote>
      </div>
    );
  }

  // Bluesky (and any other) → a clean, safe link card to the original post.
  return (
    <div className="not-prose my-6">
      <a
        href={embed.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 border border-hair bg-mist/30 p-4 no-underline transition hover:border-breaking"
      >
        <span className="font-sans text-xs font-semibold uppercase tracking-wide text-breaking">
          {embed.platform === "bluesky" ? "Bluesky" : "Source"}
        </span>
        <span className="font-body text-[0.98rem] text-navy">View the original post that sparked this &rarr;</span>
      </a>
    </div>
  );
}
