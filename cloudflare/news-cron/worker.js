// NEWS SENTINEL + CLOCK (v2 — autonomous newsroom scale-up, owner 2026-07-16, NEWS_REALTIME_SCALE_PLAN §3/§4).
// Cron fires every 2 MINUTES. STATELESS by design (the account token can't create KV; nothing here needs it):
//   • An item is "breaking-new" iff its RSS pubDate falls inside the last ~4 minutes — each story crosses that
//     window exactly once (a boundary double-fire is absorbed downstream: breaking.mjs exits on the published
//     ledger / queue dedupe, and the news-publish concurrency group serializes runs).
//   • The regular news-drip batch tick (limit=2 → ~50+/day capacity) dispatches when the firing lands in the
//     first 2-minute slot after :00/:30 — exactly one slot per boundary, no state required.
//   • Urgency is deterministic (outlet tier + Tier-S/A keyword classes + Event-Radar entity match). The radar
//     (data/find/radar.json, committed by the pipeline) is fetched fresh per firing — free + fast.
//   • Caps: max 1 breaking dispatch per firing (≤30/h theoretical; the Actions queue + per-entity day caps +
//     ledger dedupe bound actual publishes far below that).
// Budgets (CF free): 720 invocations/day · ≤16 subrequests/firing · no storage.
// Secrets: GH_TOKEN (PAT, Actions RW).  Vars: GH_OWNER, GH_REPO, GH_REF.

const FEEDS = [
  ["https://variety.com/feed/", 1], ["https://deadline.com/feed/", 1], ["https://www.hollywoodreporter.com/feed/", 1],
  ["https://www.thewrap.com/feed/", 1], ["https://ew.com/feed/", 1], ["https://tvline.com/feed/", 2],
  ["https://collider.com/feed/", 2], ["https://www.indiewire.com/feed/", 2], ["https://www.rollingstone.com/music/feed/", 1],
  ["https://www.billboard.com/feed/", 1], ["https://people.com/feed/", 1], ["https://pagesix.com/feed/", 2],
  ["https://www.usmagazine.com/feed/", 2], ["https://www.vulture.com/rss/index.xml", 2],
];
const S_CLASS = /\b(dies|dead at \d|death|passed away|obituar|arrested|arrest|indicted|charged with|files for divorce|divorc(e|ing)|lawsuit|sues?\b|fired|ousted|steps down|resigns)\b/i;
const A_CLASS = /\b(exclusive|breaking|first look|teaser|trailer|casts?\b|cast as|joins\b|in talks|renewed|cancell?ed|greenlit|greenlights?|sets? premiere|directing|to direct|acquires?|merger)\b/i;
const OFF_SCOPE = /\bbox[- ]?office\b|where to (watch|stream)|now streaming|\banime\b|\bmanga\b|video ?game|bollywood/i;
const FRESH_MS = 4 * 60e3; // pubDate within the last 4 min = crossed the detection window this firing

const strip = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
function parseItems(xml, tier) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title = strip((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
    const link = strip((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
    const pub = Date.parse(strip((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]) || "");
    if (title && link && Number.isFinite(pub)) items.push({ title, link, pub, tier });
    if (items.length >= 10) break;
  }
  return items;
}
async function dispatch(env, workflow, inputs) {
  const res = await fetch(`https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "news-sentinel-worker" },
    body: JSON.stringify({ ref: env.GH_REF || "main", inputs }),
  });
  if (!res.ok) console.log(`sentinel: ${workflow} dispatch failed ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.ok;
}

export default {
  async scheduled(event, env, ctx) {
    const now = event.scheduledTime || Date.now();
    const minute = new Date(now).getUTCMinutes();

    // Regular batch tick FIRST — before the radar fetch + feed sweep, so a CPU-limit kill or a hung feed can
    // never cost the deterministic :00/:30 drip (the clock is the one thing that must never miss).
    if (minute % 30 < 2) {
      // limit 3 (surge, owner 2026-07-17 Odyssey release): 48 ticks × 3 = 144 ceiling — the pacing governor's
      // bar + bucket meter actual output to the PACE_TARGET; this just widens the pipe for the big day.
      if (await dispatch(env, "news-drip.yml", { limit: "3" })) console.log("sentinel: drip dispatched (limit=3)");
    }

    // Event Radar entities (committed by the pipeline; optional — degrade to keyword-only urgency)
    let radar = [];
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${env.GH_OWNER}/${env.GH_REPO}/${env.GH_REF || "main"}/data/find/radar.json`, { headers: { "User-Agent": "news-sentinel-worker" }, signal: AbortSignal.timeout(5000) });
      if (r.ok) radar = ((await r.json()).hotEntities || []).slice(0, 40).map((e) => String(e).toLowerCase());
    } catch { /* optional */ }

    // Sweep feeds; keep only items whose pubDate crossed the detection window this firing
    const results = await Promise.allSettled(FEEDS.map(async ([url, tier]) => {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TSR-sentinel)" }, signal: AbortSignal.timeout(8000) });
      // slice: the free plan's CPU budget is small and regex over a 500KB feed is CPU, not I/O — the newest
      // items sit at the top of every RSS doc, so 60KB always covers the fresh window
      return r.ok ? parseItems((await r.text()).slice(0, 60000), tier) : [];
    }));
    const fresh = [];
    for (const res of results) if (res.status === "fulfilled") for (const it of res.value) if (now - it.pub <= FRESH_MS && now - it.pub > -60e3) fresh.push(it);

    // Urgency: Tier-S keywords, or Tier-A keywords on a tier-1 outlet / radar entity — max 1 dispatch per firing
    const bound = (k) => new RegExp("(^|[^a-z0-9])" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)");
    const urgent = fresh.filter((it) => {
      if (OFF_SCOPE.test(it.title)) return false;
      const t = it.title.toLowerCase();
      const radarHit = radar.some((e) => e.length > 3 && bound(e).test(t));
      return S_CLASS.test(it.title) || (A_CLASS.test(it.title) && (it.tier === 1 || radarHit)) || (radarHit && it.tier === 1);
    }).sort((a, b) => (S_CLASS.test(b.title) ? 1 : 0) - (S_CLASS.test(a.title) ? 1 : 0) || b.pub - a.pub);
    if (urgent.length) {
      const u = urgent[0];
      const cls = S_CLASS.test(u.title) ? "S" : "A";
      if (await dispatch(env, "news-breaking.yml", { url: u.link, title: u.title.slice(0, 240), cls }))
        console.log(`sentinel: BREAKING dispatched [${cls}] ${u.title.slice(0, 90)}${urgent.length > 1 ? ` (+${urgent.length - 1} deferred to the drip)` : ""}`);
    }

  },
};
