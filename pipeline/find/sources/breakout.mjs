// INDIE-BREAKOUT detector (zero-key — owner decision 2026-06-28). The 4% indie music lane is for an
// under-the-radar artist/track that UNEXPECTEDLY broke out. The core rule: a breakout is a DELTA, not a
// LEVEL — a pop star always has high absolute numbers; a real indie breakout is a sharp rate-of-change off
// a LOW baseline. We confirm it from TWO independent FREE signals (mirrors verify.mjs's corroboration
// posture, so one noisy signal can't fake a breakout), with NO API keys:
//   1. Wikipedia pageviews (REST API) — a low-baseline artist with a sudden multi-day spike = "an unknown
//      name is suddenly being searched" (the strongest tell).
//   2. Reddit JSON (r/indieheads + r/popheads + r/listentothis) — fresh post/comment velocity on the name.
// An ESTABLISHED act (high pageview baseline) stays "popular" no matter the spike (the delta-not-level rule).
// Everything fails SAFE: any network hiccup just leaves the LLM's musicTier heuristic in place.

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";
const DAY = 86400000;

// median of a numeric array (robust baseline — ignores the spike days a mean would absorb)
function median(xs) {
  const s = [...xs].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;

// Wikipedia daily pageviews for the last ~21 days. Returns { baselineMedian, peakRecent, ratio, lowBaseline }.
// A breakout = a LOW trailing baseline AND a recent peak that dwarfs it. `now` is injected (no Date.now()
// reliance baked into logic — caller passes the run clock) so behavior is deterministic for tests.
async function wikiPageviews(title, now) {
  try {
    const end = new Date(now - DAY); // yesterday (today is incomplete)
    const start = new Date(now - 22 * DAY);
    const article = encodeURIComponent(title.replace(/ /g, "_"));
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${article}/daily/${ymd(start)}/${ymd(end)}`;
    const r = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json" } });
    if (!r.ok) return null;
    const items = (await r.json())?.items || [];
    if (items.length < 10) return null; // too little history to judge a delta
    const views = items.map((it) => it.views || 0);
    const recent = views.slice(-4); // last ~4 days = the "is it spiking now" window
    const trailing = views.slice(0, -4); // the baseline window
    const baselineMedian = median(trailing);
    const peakRecent = Math.max(0, ...recent);
    const ratio = peakRecent / Math.max(1, baselineMedian);
    return { baselineMedian, peakRecent, ratio, lowBaseline: baselineMedian < 1500 };
  } catch {
    return null;
  }
}

// Reddit fresh-post velocity for the artist name across the indie/pop discovery subs (no key, needs a UA).
// Returns the count of posts in the last 7 days that name the artist — a proxy for "people are posting this".
async function redditVelocity(name) {
  try {
    const q = encodeURIComponent(`"${name}"`);
    const url = `https://www.reddit.com/r/indieheads+popheads+listentothis/search.json?q=${q}&restrict_sr=1&sort=new&t=week&limit=25`;
    const r = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json" } });
    if (!r.ok) return 0;
    const children = (await r.json())?.data?.children || [];
    const weekAgo = Date.now() / 1000 - 7 * 86400;
    return children.filter((c) => (c?.data?.created_utc || 0) >= weekAgo).length;
  } catch {
    return 0;
  }
}

// Decide the lane for one music topic. Promotes to "indie" ONLY on two-signal corroboration off a LOW
// baseline; force-keeps "popular" for an established act; otherwise leaves the LLM heuristic untouched.
export async function classifyBreakout(topic, now) {
  if ((topic.category || "").toLowerCase() !== "music") return null;
  const name = topic.primaryEntity || topic.primaryKeyword || topic.title;
  if (!name) return null;
  const pv = await wikiPageviews(name, now);
  // High established baseline → definitively POPULAR (delta-not-level: a star isn't an indie breakout).
  if (pv && pv.baselineMedian >= 4000) {
    topic.tier = "popular";
    topic.breakoutVelocity = 0;
    return { name, lane: "popular", reason: "established (high pageview baseline)", pv };
  }
  const pvSpike = !!(pv && pv.lowBaseline && pv.ratio >= 3 && pv.peakRecent >= 200);
  const reddit = await redditVelocity(name);
  const redditHot = reddit >= 4;
  // TWO independent signals required (corroboration) → a genuine indie breakout.
  if (pvSpike && redditHot) {
    topic.tier = "indie";
    topic.breakoutVelocity = Math.round((pv?.ratio || 0) * 10 + reddit);
    return { name, lane: "indie", reason: `breakout: pageview x${pv.ratio.toFixed(1)} off low baseline + ${reddit} reddit posts/wk`, pv, reddit };
  }
  return { name, lane: topic.tier || "popular", reason: "no corroborated breakout", pv, reddit };
}

// Run the detector over a batch of topics (music only), in parallel, fail-safe. Sets topic.tier in place.
export async function detectBreakouts(topics, monitor, { now = Date.now() } = {}) {
  const music = topics.filter((t) => (t.category || "").toLowerCase() === "music");
  if (!music.length) return topics;
  const results = await Promise.all(music.map((t) => classifyBreakout(t, now).catch(() => null)));
  const indie = results.filter((r) => r && r.lane === "indie");
  if (monitor) {
    monitor.stage("breakout", `music tiers: ${music.filter((t) => t.tier === "indie").length} indie / ${music.filter((t) => t.tier !== "indie").length} popular`);
    for (const r of indie) monitor.stage("breakout", `INDIE breakout → ${r.name} (${r.reason})`);
  }
  return topics;
}
