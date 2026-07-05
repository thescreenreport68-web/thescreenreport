// confirm — the double opt-in landing. The link in the confirmation email hits
// this; it flips the subscriber to CONFIRMED, sends a welcome email, and shows a
// branded page. Deploy: supabase functions deploy confirm --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";

const FROM = "The Screen Report <newsletter@news.thescreenreport.com>";
const REPLY_TO = "editor@thescreenreport.com";
const SITE = "https://thescreenreport.com";

function page(title: string, msg: string, cta = true): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
  <body style="margin:0;background:#f4f4f2;font-family:Georgia,'Times New Roman',serif;color:#101010;display:flex;min-height:100vh;align-items:center;justify-content:center">
    <div style="max-width:480px;margin:24px;background:#fff;border:1px solid #dcdcdc;text-align:center">
      <div style="padding:26px;border-bottom:2px solid #101010"><span style="font-size:22px;font-weight:700;letter-spacing:-.02em">The <i>Screen</i> Report<span style="color:#d92128">.</span></span></div>
      <div style="padding:40px 32px">
        <h1 style="font-size:24px;margin:0 0 12px">${title}</h1>
        <p style="font-size:16px;line-height:1.55;color:#333;margin:0 0 26px">${msg}</p>
        ${cta ? `<a href="${SITE}" style="background:#d92128;color:#fff;text-decoration:none;padding:13px 30px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;display:inline-block">Read The Screen Report</a>` : ""}
      </div>
    </div>
  </body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function welcomeEmail(unsubUrl: string, mailingAddress: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:Georgia,serif;color:#101010">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dcdcdc">
    <div style="padding:28px 32px;border-bottom:2px solid #101010;text-align:center"><span style="font-size:22px;font-weight:700;letter-spacing:-.02em">The <i>Screen</i> Report<span style="color:#d92128">.</span></span></div>
    <div style="padding:32px">
      <h1 style="font-size:22px;margin:0 0 14px">You're in. Welcome to the front row.</h1>
      <p style="font-size:16px;line-height:1.55;color:#333">Each morning we'll send you the Hollywood film, TV and celebrity stories that actually matter — the trailers, the box office, the castings, the moves — without the noise. First issue lands soon.</p>
      <p style="text-align:center;margin:26px 0"><a href="${SITE}" style="background:#d92128;color:#fff;text-decoration:none;padding:12px 28px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;display:inline-block">Start reading</a></p>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #dcdcdc;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;color:#8c8c8c">
      The Screen Report${mailingAddress ? " · " + mailingAddress : ""}<br><a href="${unsubUrl}" style="color:#8c8c8c">Unsubscribe</a>
    </div>
  </div></body></html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) return page("Invalid link", "This confirmation link is missing its code. Please sign up again.", true);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: sub } = await admin.from("subscribers").select("id, email, status, unsub_token").eq("confirm_token", token).maybeSingle();
    if (!sub) return page("Link expired", "This confirmation link is invalid or has already been used. If you're already subscribed, you're all set.", true);
    if (sub.status === "confirmed") return page("Already confirmed", "You're already on the list — thanks for reading!", true);

    await admin.from("subscribers").update({ status: "confirmed", confirmed_at: new Date().toISOString(), confirm_token: null }).eq("id", sub.id);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const unsubUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/unsubscribe?token=${sub.unsub_token}`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM, to: [sub.email], reply_to: REPLY_TO,
          subject: "Welcome to The Screen Report Daily",
          html: welcomeEmail(unsubUrl, Deno.env.get("MAILING_ADDRESS") ?? ""),
          headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        }),
      }).catch((e) => console.error("[confirm] welcome send", e));
    }
    return page("You're subscribed! 🎬", "Welcome to The Screen Report Daily. Check your inbox for a welcome note — your first issue is on the way.", true);
  } catch (e) {
    console.error("[confirm] unhandled", e instanceof Error ? e.message : e);
    return page("Something went wrong", "We couldn't confirm your subscription just now. Please try the link again in a moment.", true);
  }
});
