import { getSupabase, GOOGLE_CLIENT_ID } from "./supabase";

/* One shared Google Identity Services init, used by both the site-wide One Tap
   popup and the "Sign in with Google" button in the comment composer. One
   client_id, one nonce, one callback → signInWithIdToken. (COMMENTS_SYSTEM_PLAN.) */

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: Record<string, unknown>) => void;
          prompt: () => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
          cancel: () => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.getElementById("gsi-script") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("gsi load")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.id = "gsi-script";
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("gsi load"));
    document.head.appendChild(s);
  });
}

let initPromise: Promise<boolean> | null = null;

function ensureInit(): Promise<boolean> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const supabase = getSupabase();
      if (!supabase || !GOOGLE_CLIENT_ID) return false;
      await loadScript();
      if (!window.google) return false;
      const rawNonce = crypto.randomUUID();
      const hashedNonce = await sha256Hex(rawNonce);
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp: { credential: string }) => {
          const { error } = await supabase.auth.signInWithIdToken({
            provider: "google",
            token: resp.credential,
            nonce: rawNonce,
          });
          if (error) {
            console.warn("[google-auth] sign-in failed:", error.message);
          } else {
            window.dispatchEvent(new Event("tsr-auth-changed"));
          }
        },
        nonce: hashedNonce,
        auto_select: false,
        itp_support: true,
        cancel_on_tap_outside: false,
        context: "signin",
      });
      return true;
    } catch {
      // A load blip must not permanently disable sign-in — clear the memo so the
      // next click/mount retries.
      initPromise = null;
      return false;
    }
  })();
  return initPromise;
}

export async function promptOneTap(): Promise<void> {
  if (await ensureInit()) window.google?.accounts.id.prompt();
}

export async function renderGoogleButton(el: HTMLElement): Promise<void> {
  if (await ensureInit()) {
    window.google?.accounts.id.renderButton(el, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "pill",
      logo_alignment: "left",
    });
  }
}
