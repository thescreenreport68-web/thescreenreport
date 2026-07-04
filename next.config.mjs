import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Inject the PUBLIC-safe keys (Supabase URL/anon, Google client ID, Turnstile
// site key) into the build from the single source of truth — the parent .env —
// so nothing public is committed and there's no second env file to maintain.
// The Turnstile SECRET and Supabase service_role are deliberately NOT read here;
// they live only server-side (Supabase Edge Function secrets).
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "NEXT_PUBLIC_COMMENTS_ENABLED",
];
const publicEnv = {};
try {
  const raw = fs.readFileSync(path.join(ROOT, "..", ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=("?)(.*)\2\s*$/);
    if (m && PUBLIC_KEYS.includes(m[1])) publicEnv[m[1]] = m[3];
  }
} catch {
  /* no parent .env (e.g. CI) — comment features stay off, site builds fine */
}
// Feature flag (read from parent .env above): "1" once the Supabase backend is
// provisioned so the comments UI goes live. One Tap sign-in runs regardless.
publicEnv.NEXT_PUBLIC_COMMENTS_ENABLED =
  process.env.NEXT_PUBLIC_COMMENTS_ENABLED ?? publicEnv.NEXT_PUBLIC_COMMENTS_ENABLED ?? "0";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  env: publicEnv,
};

export default nextConfig;
