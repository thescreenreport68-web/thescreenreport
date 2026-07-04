// post-comment — the trusted write path for comments (COMMENTS_SYSTEM_PLAN.md §3).
// Runs the whole guardrail pipeline server-side, then inserts with the service
// role so the client can never bypass it. Deploy:
//   supabase functions deploy post-comment --no-verify-jwt
// Secrets: TURNSTILE_SECRET_KEY, OPENROUTER_API_KEY, MOD_MODEL (SUPABASE_URL/
// ANON/SERVICE_ROLE are auto-injected).

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

// Real links only (never a plain sentence period). Label runs are bounded to the
// 63-char DNS label limit so the regex is linear (no ReDoS even if the length
// cap ever changes). Blocks example.com / spam[.]shop / scam dot com / t.me/.
const LINK_TLD =
  "com|net|org|io|co|xyz|top|ru|tk|ml|ly|me|gg|link|shop|store|info|biz|dev|app|site|online|click|vip|buzz|cc|to|ws|pw|icu|live|fun";
const LINK_RE = new RegExp(
  "https?:\\/\\/\\S+" +
    "|\\bwww\\.[a-z0-9-]{1,63}\\.[a-z]{2,24}" +
    "|\\b[a-z0-9-]{2,63}\\.(?:" + LINK_TLD + ")\\b(?:\\/\\S*)?" +
    "|\\b[a-z0-9-]{2,63}\\s*(?:\\[\\s*\\.\\s*\\]|\\(\\s*(?:dot|\\.)\\s*\\))\\s*[a-z0-9-]{2,63}" +
    "|\\b[a-z0-9-]{2,63}\\s+dot\\s+(?:" + LINK_TLD + ")\\b" +
    "|\\bt\\.me\\/",
  "i",
);

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
  if (!secret) return true; // not configured (dev) → don't hard-block
  try {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) return true; // Cloudflare hiccup → don't block a real signed-in user
    const out = await r.json();
    return !!out.success;
  } catch {
    return true; // transport failure → soft-pass (auth + rate-limit + moderation still apply)
  }
}

type Verdict = "ALLOW" | "BLOCK" | "REVIEW" | "ERROR";

// Criticism-vs-abuse classifier. ALLOW harsh opinions; BLOCK abuse/hate/threats/
// sexual/scam/doxxing; REVIEW if ambiguous; ERROR = provider unavailable (the
// caller decides fail-open vs fail-safe, so an outage never silently eats posts).
async function moderateLLM(text: string): Promise<Verdict> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return "ERROR";
  const model = Deno.env.get("MOD_MODEL") ?? "google/gemini-2.5-flash-lite";
  const sys =
    `You moderate comments on an entertainment-news site. Return ONLY JSON {"decision":"ALLOW"|"BLOCK"|"REVIEW"}.\n` +
    `ALLOW opinions and criticism, however harsh, about films, shows, music, performances, or a public figure's work or public conduct ("this movie is garbage", "worst acting ever", "he's overrated").\n` +
    `BLOCK only: harassment/bullying or targeted attacks on a person's identity/body; hate or slurs against a protected group; threats or incitement of violence; sexual content that is explicit or sexualizes minors; spam/scams/solicitation; doxxing (real private contact info).\n` +
    `Rule: attacking the WORK or a PUBLIC ACTION = ALLOW; attacking the PERSON's identity/existence or using slurs/threats = BLOCK. If genuinely ambiguous, REVIEW.`;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
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
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) return "ERROR";
    const data = await r.json();
    const raw = (data?.choices?.[0]?.message?.content ?? "").toString().trim();
    // Prefer the structured decision; fall back to a word-boundary scan that
    // prefers the most-restrictive verdict (so "allowed"/"disallow" in prose
    // can't be misread as ALLOW).
    let decision = "";
    try {
      const j = JSON.parse((raw.match(/\{[\s\S]*\}/) ?? [raw])[0]);
      decision = String(j.decision ?? "").toUpperCase();
    } catch {
      /* not JSON — fall through */
    }
    if (!/^(ALLOW|BLOCK|REVIEW)$/.test(decision)) {
      if (/\bBLOCK\b/i.test(raw)) decision = "BLOCK";
      else if (/\bREVIEW\b/i.test(raw)) decision = "REVIEW";
      else if (/\bALLOW\b/i.test(raw)) decision = "ALLOW";
      else decision = "REVIEW"; // couldn't read a verdict → hold (safe)
    }
    return decision as Verdict;
  } catch {
    return "ERROR";
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);

  // One top-level guard so EVERY error path returns CORS headers — otherwise a
  // thrown error becomes a bare 500 with no CORS, which the browser reports as a
  // generic "network error".
  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const authz = req.headers.get("Authorization") ?? "";
    const anon = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authz } },
    });
    const { data: userData } = await anon.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "AUTH", message: "You must be signed in to comment." }, 401, origin);

    const body = await req.json().catch(() => ({}));
    const text = (body.body ?? "").toString().trim();
    const slug = (body.article_slug ?? "").toString().slice(0, 200);
    const parentId = body.parent_id ? String(body.parent_id) : null;
    const turnstileToken = (body.turnstile_token ?? "").toString();
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

    if (!text || text.length > 2000)
      return json({ error: "Your comment is empty or too long." }, 400, origin);
    if (!slug) return json({ error: "Missing article." }, 400, origin);

    // Turnstile (bot gate). TURNSTILE = a distinct code so the client can keep the
    // token and retry rather than discarding it.
    if (!(await verifyTurnstile(turnstileToken, ip)))
      return json({ error: "TURNSTILE", message: "Please try again in a moment." }, 400, origin);

    const admin = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const { data: prof } = await admin
      .from("profiles")
      .select("status, display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    if (prof?.status === "banned")
      return json({ error: "Your account can no longer comment." }, 403, origin);
    const shadowed = prof?.status === "shadowed";

    // Rate limits — allow a small burst (comment + a couple quick replies) but
    // stop rapid spam.
    const since = (s: number) => new Date(Date.now() - s * 1000).toISOString();
    const { count: recent } = await admin
      .from("comments").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", since(30));
    if ((recent ?? 0) >= 3)
      return json({ error: "You're commenting a little too fast — give it a few seconds." }, 429, origin);
    const { count: lastDay } = await admin
      .from("comments").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", since(86400));
    if ((lastDay ?? 0) >= 60)
      return json({ error: "You've reached today's comment limit." }, 429, origin);

    // Deterministic guards.
    if (LINK_RE.test(text))
      return json({ error: "Links aren't allowed in comments." }, 400, origin);
    if (/(.)\1{9,}/.test(text) || (text.length > 20 && text === text.toUpperCase() && /[A-Z]{20,}/.test(text)))
      return json({ error: "That looks like spam — please rephrase." }, 400, origin);

    // Moderation decision.
    let status: "approved" | "pending" | "rejected" = "approved";
    let modReason: string | null = null;
    const verdict = await moderateLLM(text);
    if (verdict === "BLOCK")
      return json({ error: "That comment breaks our community rules." }, 400, origin);
    if (profanity.hasMatch(text)) {
      // Higher-risk text → fail-SAFE: only ALLOW publishes; REVIEW/ERROR hold.
      status = verdict === "ALLOW" ? "approved" : "pending";
      if (status === "pending")
        modReason = verdict === "ERROR" ? "held: moderation unavailable" : "held: language review";
    } else if (verdict === "REVIEW") {
      status = "pending";
      modReason = "held: review";
    } else if (verdict === "ERROR") {
      // Clean-looking text during a moderation outage → fail-OPEN so a provider
      // hiccup doesn't silently swallow normal comments (publish-everything pivot).
      console.error("[post-comment] moderation unavailable — approving clean-text comment");
    }
    if (shadowed) { status = "approved"; modReason = "shadowed"; }

    const { data: inserted, error } = await admin
      .from("comments")
      .insert({ article_slug: slug, user_id: user.id, parent_id: parentId, body: text, status, mod_reason: modReason })
      .select("id, body, status, like_count, reply_count, created_at, parent_id, user_id")
      .single();
    if (error || !inserted) {
      console.error("[post-comment] insert failed", error?.message);
      return json({ error: "Could not post your comment. Try again." }, 500, origin);
    }

    return json(
      {
        ok: true,
        comment: inserted,
        held: status !== "approved" && !shadowed,
        author: {
          display_name: prof?.display_name ?? user.user_metadata?.full_name ?? user.user_metadata?.name ?? "Reader",
          avatar_url: prof?.avatar_url ?? user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
        },
      },
      200,
      origin,
    );
  } catch (e) {
    console.error("[post-comment] unhandled", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong. Please try again." }, 500, origin);
  }
});
