"use client";
import { useEffect } from "react";

/* The originating-post "receipt" embed for a gossip story (Step 6). Every platform here renders CLIENT-SIDE from
   just the PUBLIC post URL — NO Meta developer account, app, token, or App Review (verified against the live web,
   June 2026). Instagram + X need a hydration script (instagram embed.js / twitter widgets.js); Bluesky falls back
   to a safe link card (its official embed needs an at:// URI + cid we don't resolve here). YouTube + Facebook are
   plain iframes handled by the caller. Kept tiny + dependency-free to protect the build. */

type Embed = {
  platform: "instagram" | "x" | "bluesky";
  sourceUrl: string;
  handle?: string | null;
  tweetId?: string | null;
};

function ensureScript(src: string, id: string, onload?: () => void) {
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing) {
    onload?.();
    return;
  }
  const s = document.createElement("script");
  s.src = src;
  s.id = id;
  s.async = true;
  if (onload) s.addEventListener("load", onload);
  document.body.appendChild(s);
}

type IGWindow = Window & { instgrm?: { Embeds?: { process?: () => void } }; twttr?: { widgets?: { load?: () => void } } };

export default function SocialEmbed({ embed }: { embed: Embed }) {
  useEffect(() => {
    const w = window as IGWindow;
    if (embed.platform === "instagram") {
      // embed.js auto-scans ONCE on load; in an SPA the blockquote mounts AFTER that, so we must call process().
      ensureScript("https://www.instagram.com/embed.js", "instagram-embed-js", () => w.instgrm?.Embeds?.process?.());
      w.instgrm?.Embeds?.process?.();
    } else if (embed.platform === "x") {
      ensureScript("https://platform.twitter.com/widgets.js", "twitter-wjs", () => w.twttr?.widgets?.load?.());
      w.twttr?.widgets?.load?.();
    }
  }, [embed.platform, embed.sourceUrl]);

  if (embed.platform === "instagram") {
    return (
      <div className="not-prose my-6 flex justify-center">
        {/* embed.js replaces this blockquote with the post iframe; before JS runs it degrades to a captioned link. */}
        <blockquote
          className="instagram-media"
          data-instgrm-captioned
          data-instgrm-permalink={embed.sourceUrl}
          data-instgrm-version="14"
          style={{ maxWidth: 540, minWidth: 326, width: "100%", margin: 0, background: "#FFF", border: 0 }}
        >
          <a href={embed.sourceUrl} target="_blank" rel="noopener noreferrer">
            View this post on Instagram
          </a>
        </blockquote>
      </div>
    );
  }

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
