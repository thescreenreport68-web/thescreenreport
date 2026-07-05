// subscribe — public newsletter signup (double opt-in). Stores a PENDING row and
// emails a confirmation link; the address only joins the list after they click it
// (protects deliverability on a new domain + proves GDPR consent). No login needed.
// Deploy: supabase functions deploy subscribe --no-verify-jwt
// Secrets: RESEND_API_KEY, MAILING_ADDRESS (SUPABASE_URL/SERVICE_ROLE auto-injected).
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED = new Set([
  "https://thescreenreport.com",
  "https://www.thescreenreport.com",
  "http://localhost:3000",
]);
const cors = (o: string) => ({
  "Access-Control-Allow-Origin": ALLOWED.has(o) ? o : "https://thescreenreport.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
});
const json = (b: unknown, s: number, o: string) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...cors(o) } });

const FROM = "The Screen Report <newsletter@news.thescreenreport.com>";
const REPLY_TO = "editor@thescreenreport.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function confirmEmail(confirmUrl: string, mailingAddress: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:Georgia,'Times New Roman',serif;color:#101010">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dcdcdc">
    <div style="padding:28px 32px;border-bottom:2px solid #101010;text-align:center">
      <span style="font-size:22px;font-weight:700;letter-spacing:-.02em">The <i>Screen</i> Report<span style="color:#d92128">.</span></span>
    </div>
    <div style="padding:32px">
      <h1 style="font-size:22px;margin:0 0 14px">Confirm your subscription</h1>
      <p style="font-size:16px;line-height:1.55;color:#333">You're one click away from <b>The Screen Report Daily</b> — the Hollywood film, TV and celebrity stories that matter, each morning. Tap the button to confirm you want in.</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${confirmUrl}" style="background:#d92128;color:#fff;text-decoration:none;padding:13px 30px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;display:inline-block">Confirm my subscription</a>
      </p>
      <p style="font-size:13px;line-height:1.5;color:#8c8c8c">If the button doesn't work, paste this link into your browser:<br><a href="${confirmUrl}" style="color:#d92128;word-break:break-all">${confirmUrl}</a></p>
      <p style="font-size:13px;line-height:1.5;color:#8c8c8c">If you didn't request this, just ignore this email — you won't be subscribed.</p>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #dcdcdc;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;color:#8c8c8c">
      The Screen Report${mailingAddress ? " · " + mailingAddress : ""}<br>You received this because someone entered this address at thescreenreport.com.
    </div>
  </div></body></html>`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);
  try {
    const body = await req.json().catch(() => ({}));
    // Honeypot: real users leave the hidden field blank; bots fill everything.
    if ((body.company ?? "").toString().trim()) return json({ ok: true }, 200, origin);

    const email = (body.email ?? "").toString().trim().toLowerCase();
    const source = (body.source ?? "web").toString().slice(0, 40);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    if (!EMAIL_RE.test(email) || email.length > 254)
      return json({ error: "Please enter a valid email address." }, 400, origin);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    // IP rate limit: max 5 signups/hour per IP (blunt anti-abuse; double opt-in is the real filter).
    if (ip) {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await admin.from("subscribers").select("id", { count: "exact", head: true })
        .eq("consent_ip", ip).gte("created_at", since);
      if ((count ?? 0) >= 5) return json({ error: "Too many signups from here — try again later." }, 429, origin);
    }

    const { data: existing } = await admin.from("subscribers")
      .select("id, status, confirm_token").eq("email", email).maybeSingle();
    if (existing?.status === "confirmed")
      return json({ ok: true, already: true, message: "You're already subscribed — thanks!" }, 200, origin);

    const confirmToken = crypto.randomUUID();
    const unsubToken = existing ? undefined : crypto.randomUUID();
    const row: Record<string, unknown> = {
      email, status: "pending", confirm_token: confirmToken, source,
      consent_ip: ip || null, consent_ts: new Date().toISOString(),
    };
    if (unsubToken) row.unsub_token = unsubToken;

    if (existing) {
      await admin.from("subscribers").update({ status: "pending", confirm_token: confirmToken, consent_ts: row.consent_ts }).eq("id", existing.id);
    } else {
      const { error } = await admin.from("subscribers").insert(row);
      if (error) { console.error("[subscribe] insert", error.message); return json({ error: "Something went wrong. Please try again." }, 500, origin); }
    }

    const confirmUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/confirm?token=${confirmToken}`;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM, to: [email], reply_to: REPLY_TO,
          subject: "Confirm your subscription to The Screen Report",
          html: confirmEmail(confirmUrl, Deno.env.get("MAILING_ADDRESS") ?? ""),
        }),
      });
      if (!r.ok) { console.error("[subscribe] resend", await r.text()); return json({ error: "Couldn't send the confirmation email. Please try again." }, 502, origin); }
    }
    return json({ ok: true, message: "Almost there! Check your inbox to confirm your subscription." }, 200, origin);
  } catch (e) {
    console.error("[subscribe] unhandled", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong. Please try again." }, 500, origin);
  }
});
