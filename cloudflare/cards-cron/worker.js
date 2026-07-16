// CARDS sentinel + slot clock — STATELESS worker (v2, 2026-07-16).
// Why stateless: the account's CF token cannot create KV namespaces (proven by the news
// lane the same day), so there is no seen/alerted state. Dedupe lives in the RUNNER:
// cardsrun's ledger dup-guard (≥3 shared stems, 72h) + the breaking budget absorb the
// duplicate dispatches a pubDate-window poll produces. Order of operations is the other
// hard-won news-lane lesson: DISPATCH FIRST, parse second — the free-plan CPU limit
// killed a tick mid-feed-parse; regex over big feeds is CPU, so every feed is byte-capped.
//
// Cron: */2 min. Roles per fire:
//   1. SLOT_CLOCK=on  → dispatch cards-slate.yml once/day (06:44 LA) and cards-slot.yml
//      at :00/:30 (the runner no-ops when nothing is due — dispatches are cheap).
//   2. SENTINEL_MODE=shadow|live → poll tier-1 trade RSS, Rule-A gate (tier-1 outlet's
//      OWN feed + high-precision breaking marker + fresh pubDate). shadow = log only.
//      (Velocity Rules B/C need cross-fire state — they ride the normal 2×/day slate.)

const FEEDS = [
  "https://variety.com/feed/",
  "https://deadline.com/feed/",
  "https://www.hollywoodreporter.com/feed/",
  "https://www.thewrap.com/feed/",
  "https://ew.com/feed/",
];
const FEED_BYTE_CAP = 60_000; // CPU guard — regex over 500KB feeds ate a whole invocation (news lane)
const WINDOW_MIN = 8; // pubDate freshness window; wider than the 2-min fire so missed ticks don't drop stories
const BREAKING_RE = /\b(dies|dead at \d+|passes away|found dead|arrested|charged|indicted|steps down|fired|exits|exiting|delayed|pulled from|pushed to \d{4}|breaking:)\b/i;
const EXCLUDE_RE = /\b(years ago|anniversary|ranked|best of|recap|review:)\b/i;

function laNow() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { hour: Number(p.hour), minute: Number(p.minute) };
}

async function dispatch(env, workflowFile, inputs = {}) {
  const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/${workflowFile}/dispatches`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "tsr-cards-cron",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: env.GH_REF || "rebuild-trending-news", inputs }),
    });
    if (!r.ok) console.log(`dispatch ${workflowFile}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    return r.ok;
  } catch (e) {
    console.log(`dispatch ${workflowFile}: ${String(e.message || e).slice(0, 120)}`);
    return false;
  }
}

// minimal, CPU-cheap RSS item scan (title/link/pubDate only, byte-capped input)
function scanFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const b of blocks.slice(0, 20)) {
    const title = (b.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1]?.trim();
    const link = (b.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i) || [])[1]?.trim();
    const pub = Date.parse((b.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || "");
    if (title && link && Number.isFinite(pub)) items.push({ title, link, pub });
  }
  return items;
}

export default {
  async scheduled(_event, env, ctx) {
    const { hour, minute } = laNow();

    // ── 1. slot clock — dispatch BEFORE any feed work (CPU-limit lesson)
    if (env.SLOT_CLOCK === "on") {
      if (hour === 6 && minute === 44) ctx.waitUntil(dispatch(env, "cards-slate.yml"));
      if (minute % 30 === 0) ctx.waitUntil(dispatch(env, "cards-slot.yml"));
    }

    // ── 2. breaking sentinel
    const mode = env.SENTINEL_MODE || "off";
    if (mode === "off") return;
    const cut = Date.now() - WINDOW_MIN * 60_000;
    const results = await Promise.allSettled(FEEDS.map(async (u) => {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (TSR sentinel)" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return [];
      const xml = (await r.text()).slice(0, FEED_BYTE_CAP);
      return scanFeed(xml).filter((i) => i.pub > cut);
    }));
    const fresh = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

    for (const item of fresh) {
      if (!BREAKING_RE.test(item.title) || EXCLUDE_RE.test(item.title)) continue;
      // pre-capped payload — a raw JSON slice can cut mid-token and ship invalid JSON (audit D3)
      const payload = {
        title: String(item.title).slice(0, 300),
        links: [String(item.link).slice(0, 500)],
        rule: "A",
        detectedAt: new Date().toISOString(),
      };
      if (mode === "live") {
        const ok = await dispatch(env, "cards-breaking.yml", { payload: JSON.stringify(payload) });
        console.log(`sentinel LIVE (rule A) dispatch=${ok}: ${payload.title}`);
      } else {
        console.log(`sentinel SHADOW (rule A) would dispatch: ${payload.title} :: ${payload.links[0]}`);
      }
    }
  },
};
