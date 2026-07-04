import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* Browser Supabase client (COMMENTS_SYSTEM_PLAN.md). URL + anon key are
   public-safe — every table is protected by Row Level Security. Injected at
   build from NEXT_PUBLIC_SUPABASE_* (see next.config / .env). If they're absent
   the client is null and every comment feature no-ops (nothing breaks). */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

// Comments go live once the Supabase backend is provisioned AND this is on.
export const COMMENTS_ENABLED =
  process.env.NEXT_PUBLIC_COMMENTS_ENABLED === "1" &&
  !!SUPABASE_URL &&
  !!SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    // Keep every mounted component's auth UI in sync with the real session —
    // token refresh, expiry, sign-in/out, or a change in another tab all
    // re-fire our one 'tsr-auth-changed' event.
    if (typeof window !== "undefined") {
      client.auth.onAuthStateChange((event) => {
        if (["SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) {
          window.dispatchEvent(new Event("tsr-auth-changed"));
        }
      });
    }
  }
  return client;
}
