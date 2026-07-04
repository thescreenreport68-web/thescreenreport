// post-comment — the trusted write path for comments (COMMENTS_SYSTEM_PLAN.md §3).
// Runs the whole guardrail pipeline server-side, then inserts with the service
// role so the client can never bypass it. Deploy:
//   supabase functions deploy post-comment --no-verify-jwt
// Secrets it needs (supabase secrets set ...):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TURNSTILE_SECRET_KEY,
//   OPENROUTER_API_KEY, MOD_MODEL (optional, defaults below)

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "npm:obscenity@0.4.3";

const ALLOWED_ORIGINS = new Set([
  "https://thescreenreport.com",
  "https://www.thescreenreport.com",
  "http://localhost:3000",
]);
const cors = (origin: string) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://thescreenreport.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // supabase-js / our fetch send apikey + x-client-info alongside authorization —
  // all must be allowed or the browser blocks the request (the "network error").
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
});
const json = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });

const profanity = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});
// No links in v1 — but ONLY real links, never a plain sentence period. Matches
// full URLs, www., bare domains with a known TLD, and obfuscated forms
// (word[.]com, word(dot)com, "word dot com", t.me/). Verified: normal sentences
// ending in "." pass; "example.com" / "spam[.]shop" / "scam dot com" are blocked.
const LINK_TLD =
  "com|net|org|io|co|xyz|top|ru|tk|ml|ly|me|gg|link|shop|store|info|biz|dev|app|site|online|click|vip|buzz|cc|to|ws|pw|icu|live|fun";
const LINK_RE = new RegExp(
  "https?:\\/\\/\\S+" +
    "|\\bwww\\.[a-z0-9-]+\\.[a-z]{2,}" +
    "|\\b[a-z0-9-]{2,}\\.(?:" + LINK_TLD + ")\\b(?:\\/\\S*)?" +
    "|\\b[a-z0-9-]{2,}\\s*(?:\\[\\s*\\.\\s*\\]|\\(\\s*(?:dot|\\.)\\s*\\))\\s*[a-z0-9-]{2,}" +
    "|\\b[a-z0-9-]{2,}\\s+dot\\s+(?:" + LINK_TLD + ")\\b" +
    "|\\bt\\.me\\/",
  "i",
);

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
  if (!secret) return true; // not configured → don't hard-block (dev)
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const r = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form },
  );
  const out = await r.json();
  return !!out.success;
}

// The criticism-vs-abuse classifier (cheap model). ALLOW harsh opinions; BLOCK
// harassment/hate/threats/sexual/scam/doxxing; REVIEW when ambiguous.
async function moderateLLM(text: string): Promise<"ALLOW" | "BLOCK" | "REVIEW"> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return "REVIEW"; // fail safe: hold, don't auto-publish
  const model = Deno.env.get("MOD_MODEL") ?? "google/gemini-2.5-flash-lite";
  const sys =
    `You moderate comments on an entertainment-news site. Return ONLY JSON {"decision":"ALLOW|BLOCK|REVIEW"}.\n` +
    `ALLOW opinions and criticism, however harsh, about films, shows, music, performances, or a public figure's work or public conduct ("this movie is garbage", "worst acting ever", "he's overrated").\n` +
    `BLOCK only: harassment/bullying or targeted attacks on a person's identity/body; hate or slurs against a protected group; threats or incitement of violence; sexual content that is explicit or sexualizes minors; spam/scams/solicitation; doxxing (real private contact info).\n` +
    `Rule: attacking the WORK or a PUBLIC ACTION = ALLOW; attacking the PERSON's identity/existence or using slurs/threats = BLOCK. If genuinely ambiguous, REVIEW.`;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 20,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: text.slice(0, 2000) },
        ],
      }),
    });
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const m = raw.match(/ALLOW|BLOCK|REVIEW/i);
    return (m ? m[0].toUpperCase() : "REVIEW") as "ALLOW" | "BLOCK" | "REVIEW";
  } catch {
    return "REVIEW";
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);

  // 1. Authenticated user (the browser sends its Supabase JWT).
  const authz = req.headers.get("Authorization") ?? "";
  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authz } },
  });
  const { data: userData } = await anon.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "You must be signed in to comment." }, 401, origin);

  const body = await req.json().catch(() => ({}));
  const text = (body.body ?? "").toString().trim();
  const slug = (body.article_slug ?? "").toString().slice(0, 200);
  const parentId = body.parent_id ? String(body.parent_id) : null;
  const turnstileToken = (body.turnstile_token ?? "").toString();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

  if (!text || text.length < 1 || text.length > 2000)
    return json({ error: "Your comment is empty or too long." }, 400, origin);
  if (!slug) return json({ error: "Missing article." }, 400, origin);

  // 2. Turnstile (bot gate).
  if (!(await verifyTurnstile(turnstileToken, ip)))
    return json({ error: "Please complete the verification and try again." }, 400, origin);

  // service-role client for the trusted reads/writes below
  const admin = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // banned / shadowbanned?
  const { data: prof } = await admin
    .from("profiles").select("status").eq("id", user.id).single();
  if (prof?.status === "banned")
    return json({ error: "Your account can no longer comment." }, 403, origin);
  const shadowed = prof?.status === "shadowed";

  // 3. Rate limits (Postgres counters — no extra vendor).
  const since = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  const { count: last20s } = await admin
    .from("comments").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).gte("created_at", since(20));
  if ((last20s ?? 0) >= 1)
    return json({ error: "You're commenting too fast — take a breath." }, 429, origin);
  const { count: lastDay } = await admin
    .from("comments").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).gte("created_at", since(86400));
  if ((lastDay ?? 0) >= 40)
    return json({ error: "You've reached today's comment limit." }, 429, origin);

  // 4. Deterministic guards: no links, then profanity/slurs.
  if (LINK_RE.test(text))
    return json({ error: "Links aren't allowed in comments." }, 400, origin);
  if (/(.)\1{9,}/.test(text) || (text.length > 20 && text === text.toUpperCase() && /[A-Z]{20,}/.test(text)))
    return json({ error: "That looks like spam — please rephrase." }, 400, origin);

  // 5. Decide status.
  let status: "approved" | "pending" | "rejected" = "approved";
  let modReason: string | null = null;
  if (profanity.hasMatch(text)) {
    // Hard slurs/profanity → let the LLM make the criticism/abuse call; hold on doubt.
    const verdict = await moderateLLM(text);
    if (verdict === "BLOCK") return json({ error: "That comment breaks our community rules." }, 400, origin);
    status = verdict === "ALLOW" ? "approved" : "pending";
    if (status === "pending") modReason = "held: language review";
  } else {
    const verdict = await moderateLLM(text);
    if (verdict === "BLOCK") return json({ error: "That comment breaks our community rules." }, 400, origin);
    if (verdict === "REVIEW") { status = "pending"; modReason = "held: review"; }
  }
  if (shadowed) { status = "approved"; modReason = "shadowed"; } // renders only to author via app logic

  // 6. Insert (service role bypasses RLS — this is the only trusted write path).
  const { data: inserted, error } = await admin
    .from("comments")
    .insert({ article_slug: slug, user_id: user.id, parent_id: parentId, body: text, status, mod_reason: modReason })
    .select("id, body, status, like_count, reply_count, created_at, parent_id, user_id")
    .single();
  if (error) return json({ error: "Could not post your comment. Try again." }, 500, origin);

  return json(
    {
      comment: inserted,
      held: status !== "approved" && !shadowed,
      author: { display_name: user.user_metadata?.full_name ?? user.user_metadata?.name, avatar_url: user.user_metadata?.avatar_url ?? user.user_metadata?.picture },
    },
    200,
    origin,
  );
});
