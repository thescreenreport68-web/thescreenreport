"use client";

import { useEffect, useRef } from "react";

/* Cloudflare Turnstile widget — the invisible CAPTCHA on the comment composer.
   Auto-solves in managed mode and hands the token back via onVerify. Bump `nonce`
   to force a fresh token after a submit (tokens are single-use). Site key is
   public (NEXT_PUBLIC_TURNSTILE_SITE_KEY). */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export default function Turnstile({
  onVerify,
  nonce = 0,
}: {
  onVerify: (token: string) => void;
  nonce?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY) return;
    let disposed = false;
    let poll: ReturnType<typeof setInterval> | undefined;

    const render = () => {
      if (disposed || !ref.current || !window.turnstile) return;
      // Remove any prior widget instance before drawing a fresh one (avoids
      // leaking widgets on each nonce bump / re-render).
      if (widgetId.current) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* already gone */
        }
        widgetId.current = null;
      }
      ref.current.innerHTML = "";
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        callback: (token: string) => onVerify(token),
        "error-callback": () => onVerify(""),
        "expired-callback": () => onVerify(""),
        theme: "auto",
        appearance: "interaction-only",
        action: "comment_submit",
      });
    };

    if (window.turnstile) {
      render();
    } else if (!document.getElementById("cf-turnstile-script")) {
      const s = document.createElement("script");
      s.id = "cf-turnstile-script";
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.defer = true;
      s.onload = render;
      document.head.appendChild(s);
    } else {
      poll = setInterval(() => {
        if (window.turnstile) {
          if (poll) clearInterval(poll);
          render();
        }
      }, 200);
    }

    return () => {
      disposed = true;
      if (poll) clearInterval(poll);
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* already gone */
        }
        widgetId.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  if (!SITE_KEY) return null;
  return <div ref={ref} className="mt-2" />;
}
