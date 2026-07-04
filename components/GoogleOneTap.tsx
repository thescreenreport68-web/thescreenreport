"use client";

import { useEffect, useRef } from "react";
import { getSupabase, GOOGLE_CLIENT_ID } from "@/lib/supabase";

/* Google One Tap — the auto-popup that appears top-right on desktop (bottom
   sheet on mobile) the moment a signed-out reader opens the site, exactly as the
   owner asked (COMMENTS_SYSTEM_PLAN.md §1). One tap signs them in.

   Flow (verified 2026): One Tap returns a Google ID token (JWT); we hand it to
   Supabase via signInWithIdToken. Nonce: Google gets the SHA-256 HASH, Supabase
   gets the RAW value (Supabase re-hashes and compares). FedCM is automatic now —
   we set no flags; the browser draws the card. Fails silently if the Google
   provider isn't enabled in Supabase yet, so nothing ever breaks on the page. */

type CredentialResponse = { credential: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: Record<string, unknown>) => void;
          prompt: () => void;
          cancel: () => void;
        };
      };
    };
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function GoogleOneTap() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const supabase = getSupabase();
    if (!supabase || !GOOGLE_CLIENT_ID) return; // not configured → no-op

    let cancelled = false;

    (async () => {
      // Already signed in? Don't prompt.
      const { data } = await supabase.auth.getSession();
      if (cancelled || data.session) return;

      const rawNonce = crypto.randomUUID();
      const hashedNonce = await sha256Hex(rawNonce);

      const onCredential = async (resp: CredentialResponse) => {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: resp.credential,
          nonce: rawNonce,
        });
        if (error) {
          // Most likely: the Google provider isn't enabled in Supabase yet.
          console.warn("[one-tap] sign-in not completed:", error.message);
          return;
        }
        // Signed in — let listeners (comment UI) react; no reload needed.
        window.dispatchEvent(new Event("tsr-auth-changed"));
      };

      const init = () => {
        if (cancelled || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: onCredential,
          nonce: hashedNonce,
          auto_select: false,
          itp_support: true,
          cancel_on_tap_outside: false,
          context: "signin",
        });
        window.google.accounts.id.prompt();
      };

      // Load the Google Identity Services script once.
      if (window.google) {
        init();
      } else {
        const existing = document.getElementById("gsi-script");
        if (existing) {
          existing.addEventListener("load", init, { once: true });
        } else {
          const s = document.createElement("script");
          s.id = "gsi-script";
          s.src = "https://accounts.google.com/gsi/client";
          s.async = true;
          s.defer = true;
          s.onload = init;
          document.head.appendChild(s);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
