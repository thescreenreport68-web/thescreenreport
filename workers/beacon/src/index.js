// tsr-beacon — cookieless pageview counter on Cloudflare Workers Analytics
// Engine (free tier). The site sends one sendBeacon per pageview; a build-time
// script queries the aggregate counts back into homepage placement
// (HOMEPAGE_PROGRAMMING_PLAN.md Phase 2). No cookies, no IPs stored, no
// per-user anything — aggregate paths only.

const ALLOWED_ORIGINS = new Set([
  "https://thescreenreport.com",
  "https://www.thescreenreport.com",
  "http://localhost:3000",
]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://thescreenreport.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return new Response("ok", { status: 200, headers: corsHeaders(origin) });
    }
    try {
      // sendBeacon posts text/plain — parse defensively, cap sizes hard.
      const raw = (await request.text()).slice(0, 500);
      const data = JSON.parse(raw);
      let path = typeof data.p === "string" ? data.p : "";
      if (!path.startsWith("/")) throw new Error("bad path");
      path = path.split("?")[0].slice(0, 96);
      env.METRICS.writeDataPoint({
        blobs: [path],
        doubles: [1],
        indexes: [path.slice(0, 32)],
      });
    } catch {
      /* malformed beacons are dropped silently */
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  },
};
