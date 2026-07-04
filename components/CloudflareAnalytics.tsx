import Script from "next/script";

// Cloudflare Web Analytics — privacy-first, cookie-less real-visitor tracking
// (counts actual browsers that run JS, filtering out the bot/crawler noise that
// inflates the raw "Requests" metric). Get the token from the Cloudflare
// dashboard → Analytics & Logs → Web Analytics → Add a site → thescreenreport.com,
// and paste it below. Renders nothing until a token is set, so it's safe to ship.
const CF_BEACON_TOKEN = ""; // ← paste the Cloudflare Web Analytics token here

export default function CloudflareAnalytics() {
  if (!CF_BEACON_TOKEN) return null;
  return (
    <Script
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token: CF_BEACON_TOKEN })}
      strategy="afterInteractive"
    />
  );
}
