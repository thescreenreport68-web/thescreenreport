// GOSSIP — SOCIAL DISCOVERY (Step 3). Opens the SPECULATION lane that RSS can't reach (TMZ/Page Six RSS carry
// only CONFIRMED news; the juicy rumors break on social). Polls free/cheap social sources and emits the SAME
// candidate shape discover.mjs produces, so they flow through the existing categorize → dedup → content-finder
// → verify pipeline. CRITICAL: every social signal is a DISCOVERY/velocity TIP + search seed ONLY — NEVER a
// citable fact. The content finder (Step 4) + verify gate (Step 5) establish every published fact.
import { tierOf } from "./policy.mjs";

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";
const strip = (s) => String(s || "").replace(/\s+/g, " ").trim();
const defaultFetch = (url, opts) => fetch(url, opts);

// ── Bluesky public AppView (FREE, no auth) — the real gossip accounts live here (live-verified). ──
export const BLUESKY = [
  { handle: "popbase.bsky.social", tier: 2 },
  { handle: "popcrave.com", tier: 2 },
  { handle: "deuxmoi.bsky.social", tier: 2 },
  { handle: "justjared.bsky.social", tier: 3 },
  { handle: "etonline.bsky.social", tier: 3 },
];
async function bluesky(fetchImpl, { accounts = BLUESKY, limit = 25, nowMs } = {}) {
  const now = nowMs ?? Date.now();
  const out = [];
  for (const a of accounts) {
    try {
      const r = await fetchImpl(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(a.handle)}&limit=${limit}`, { headers: { "User-Agent": UA } });
      if (!r.ok) continue;
      const j = await r.json();
      for (const item of j?.feed || []) {
        const p = item?.post, rec = p?.record;
        if (!rec?.text || item.reason) continue; // skip reposts (item.reason present)
        const rkey = p.uri ? p.uri.split("/").pop() : "";
        out.push({
          outlet: `Bluesky @${a.handle.split(".")[0]}`, tier: a.tier,
          title: strip(rec.text).slice(0, 180), summary: strip(rec.text),
          url: rkey ? `https://bsky.app/profile/${a.handle}/post/${rkey}` : "",
          engagement: (p.likeCount || 0) + (p.repostCount || 0),
          ageMin: rec.createdAt ? Math.round((now - Date.parse(rec.createdAt)) / 60000) : null,
        });
      }
    } catch { /* a down account is not fatal */ }
  }
  return out;
}

// ── X via twitterapi.io — DORMANT (owner decision 2026-07-17): the key's free credits are exhausted
// (HTTP 402 "Credits is not enough") and we are NOT paying. Evaluated free alternatives and REJECTED:
//   • syndication.twitter.com/srv/timeline-profile → 200 but a STALE top-tweets cache (newest ≈ 8 months old,
//     0 fresh in 100 entries) — fine for embedding a known tweet, useless for live discovery;
//   • cdn.syndication.twimg.com/timeline/profile → empty body (retired);
//   • no other gossip desks are active on Bluesky (probed variety/THR/E!/PageSix/TMZ/UsWeekly — dead/absent).
// The SAME amplifiers (Pop Crave / PopBase / Deuxmoi) post actively on Bluesky, which the BLUESKY list above
// already covers — so the amplifier lane stays live and free. This path auto-revives if the workflow ever
// passes a recharged TWITTERAPI_KEY again; without the key it costs zero calls.
export const X_ACCOUNTS = ["PopCrave", "PopBase", "DeuxmoiOfficial"];
async function xReader(fetchImpl, { accounts = X_ACCOUNTS, nowMs } = {}) {
  const key = process.env.TWITTERAPI_KEY;
  if (!key) return []; // no key → skip, zero cost (see the dormancy note above)
  const now = nowMs ?? Date.now();
  const out = [];
  for (const acct of accounts) {
    try {
      const r = await fetchImpl(`https://api.twitterapi.io/twitter/user/last_tweets?userName=${encodeURIComponent(acct)}`, { headers: { "X-API-Key": key } });
      if (!r.ok) continue;
      const j = await r.json();
      for (const t of j?.tweets || j?.data?.tweets || []) {
        const text = strip(t.text || t.full_text || "");
        if (!text || t.isReply) continue;
        out.push({
          outlet: `X @${acct}`, tier: 2, title: text.slice(0, 180), summary: text,
          url: t.url || (t.id ? `https://x.com/${acct}/status/${t.id}` : ""),
          engagement: (t.likeCount || 0) + (t.retweetCount || 0),
          ageMin: t.createdAt ? Math.round((now - Date.parse(t.createdAt)) / 60000) : null,
        });
      }
    } catch { /* skip */ }
  }
  return out;
}

// ── Reddit — BUILT but currently inactive: the public JSON now 403s; needs the OAuth app (2-4 wk approval),
// after which this swaps to oauth.reddit.com + a bearer token. Returns [] gracefully until then. ──
export const REDDIT_SUBS = ["Fauxmoi", "popculturechat", "popheads", "deuxmoi"];
async function reddit(fetchImpl, { subs = REDDIT_SUBS, limit = 20, nowMs } = {}) {
  const now = nowMs ?? Date.now();
  const out = [];
  for (const sub of subs) {
    try {
      const r = await fetchImpl(`https://www.reddit.com/r/${sub}/hot.json?limit=${limit}`, { headers: { "User-Agent": UA } });
      if (!r.ok) continue; // 403 until OAuth — handled gracefully
      const j = await r.json();
      for (const c of j?.data?.children || []) {
        const d = c.data;
        if (!d || d.stickied) continue;
        out.push({ outlet: `Reddit r/${sub}`, tier: 3, title: strip(d.title), summary: strip((d.selftext || "").slice(0, 300)), url: "https://www.reddit.com" + d.permalink, engagement: d.score || 0, ageMin: Math.round((now - (d.created_utc || 0) * 1000) / 60000) });
      }
    } catch { /* skip */ }
  }
  return out;
}

export async function discoverSocial({ fetchImpl = defaultFetch, freshHours = 48, nowMs, minEngagement = 0 } = {}) {
  const all = [
    ...(await bluesky(fetchImpl, { nowMs })),
    ...(await xReader(fetchImpl, { nowMs })),
    ...(await reddit(fetchImpl, { nowMs })),
  ];
  const seen = new Set();
  return all
    .filter((c) => c.title && (c.ageMin == null || c.ageMin / 60 <= freshHours) && (c.engagement || 0) >= minEngagement)
    .filter((c) => { const k = c.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.engagement || 0) - (a.engagement || 0) || (a.ageMin ?? 1e9) - (b.ageMin ?? 1e9));
}

export const _parsers = { bluesky, xReader, reddit }; // exported for tests
