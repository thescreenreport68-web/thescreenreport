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

    const render = () => {
      if (disposed || !ref.current || !window.turnstile) return;
      ref.current.innerHTML = "";
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        callback: (token: string) => onVerify(token),
        "error-callback": () => onVerify(""),
        "expired-callback": () => onVerify(""),
        theme: "auto",
        // Invisible: verify silently in the background, only surface UI if a real
        // challenge is required — no "Success!" box shown to the reader.
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
      const t = setInterval(() => {
        if (window.turnstile) {
          clearInterval(t);
          render();
        }
      }, 200);
    }

    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  if (!SITE_KEY) return null;
  return <div ref={ref} className="mt-2" />;
}
