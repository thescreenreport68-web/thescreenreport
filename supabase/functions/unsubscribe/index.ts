// unsubscribe — one-click opt-out. Handles GET (link click → branded page) and
// POST (RFC 8058 List-Unsubscribe-Post that Gmail/Yahoo/Outlook fire automatically,
// now required for bulk senders). Marks the row unsubscribed by its unsub_token.
// Deploy: supabase functions deploy unsubscribe --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = "https://thescreenreport.com";

async function optOut(token: string): Promise<boolean> {
  if (!token) return false;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: sub } = await admin.from("subscribers").select("id").eq("unsub_token", token).maybeSingle();
  if (!sub) return false;
  await admin.from("subscribers").update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() }).eq("id", sub.id);
  return true;
}

function page(title: string, msg: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
  <body style="margin:0;background:#f4f4f2;font-family:Georgia,serif;color:#101010;display:flex;min-height:100vh;align-items:center;justify-content:center">
    <div style="max-width:480px;margin:24px;background:#fff;border:1px solid #dcdcdc;text-align:center">
      <div style="padding:26px;border-bottom:2px solid #101010"><span style="font-size:22px;font-weight:700;letter-spacing:-.02em">The <i>Screen</i> Report<span style="color:#d92128">.</span></span></div>
      <div style="padding:40px 32px">
        <h1 style="font-size:24px;margin:0 0 12px">${title}</h1>
        <p style="font-size:16px;line-height:1.55;color:#333;margin:0 0 26px">${msg}</p>
        <a href="${SITE}" style="background:#d92128;color:#fff;text-decoration:none;padding:13px 30px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;display:inline-block">Back to The Screen Report</a>
      </div>
    </div>
  </body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  // RFC 8058 one-click: mail clients POST here — just process and 200.
  if (req.method === "POST") {
    await optOut(token).catch(() => {});
    return new Response("OK", { status: 200 });
  }
  try {
    const ok = await optOut(token);
    return ok
      ? page("You're unsubscribed", "You won't receive The Screen Report Daily anymore. We're sorry to see you go — you're always welcome back.")
      : page("Link not found", "This unsubscribe link is invalid or already used. If you're still receiving emails, reply to any of them and we'll remove you.");
  } catch {
    return page("Something went wrong", "We couldn't process that just now. Please try again in a moment.");
  }
});
