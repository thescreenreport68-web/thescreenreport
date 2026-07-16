// AGENT 23 — ANALYTICS COLLECTOR (plan §2.2 #23, §5.7): per-post insights at fixed
// offsets → learning ledger. NEVER breaks a run (analytics is garnish for publishing,
// load-bearing only for learning).
//
// RESURRECTED (owner audit 2026-07-16): this had NEVER collected a row — it filtered on
// `p.zernioId` but recordPosted writes `postId` (one row per platform), so zero rows matched
// even when run manually. Now: every scheduled row with a post id is collected, routed by
// platform — Instagram/Facebook via Zernio, YouTube via Buffer post metrics (views, reactions,
// comments, engagementRate — Buffer does not expose YouTube's raw engagedViews; engagementRate
// is the engagement-quality signal we can actually get). Rows carry `platform` so the learner
// can merge the 3 platform rows of one story into one scored reel.
import { IG } from "../config.mjs";
import { fetchWithTimeout } from "../lib/util.mjs";
import { loadPosted, savePosted, appendInsight } from "../lib/ledger.mjs";
import { bufferMetrics } from "../lib/buffer.mjs";

const zHeaders = () => ({ Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, "Content-Type": "application/json" });

async function tryEndpoints(postId) {
  const candidates = [
    `${IG.zernio.base}/posts/${postId}/analytics`,
    `${IG.zernio.base}/posts/${postId}/insights`,
    `${IG.zernio.base}/analytics/posts/${postId}`,
    `${IG.zernio.base}/posts/${postId}`, // status endpoint sometimes carries metrics inline
  ];
  for (const url of candidates) {
    try {
      const res = await fetchWithTimeout(url, { headers: zHeaders() }, 20000);
      if (res.ok) return { url, data: await res.json() };
    } catch {}
  }
  return null;
}

function pick(data, keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((o, p) => o?.[p], data);
    if (v !== undefined && v !== null && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

export async function collect({ hoursMarks = [3, 24, 72, 168] } = {}) {
  const ledger = loadPosted(); // mutated in place and SAVED at the end (collected marks persist)
  // postId (current schema) OR zernioId (legacy rows) — the field mismatch that killed the flywheel
  const posted = ledger.posts.filter((p) => (p.postId || p.zernioId) && p.mode === "scheduled" && p.published !== false);
  const now = Date.now();
  const rows = [];
  for (const p of posted) {
    const goLive = new Date(p.whenISO || p.at).getTime();
    if (goLive > now) continue; // still scheduled in the future
    const ageH = (now - goLive) / 3600e3;
    // collect the HIGHEST due mark not yet collected (skips stale lower marks)
    const mark = [...hoursMarks].reverse().find((h) => ageH >= h && !(p.collected || []).includes(h));
    if (!mark) continue;
    const id = p.postId || p.zernioId;
    const platform = p.platform || "instagram"; // legacy zernioId rows were IG
    const row = {
      slug: p.slug,
      platform,
      postId: id,
      mark,
      at: new Date().toISOString(),
      views: null, reach: null, avgWatchMs: null, skipRate: null,
      shares: null, saved: null, likes: null, comments: null, engagementRate: null,
      hookStyle: p.hookStyle || null,
      segment: p.segment || null,
      slot: p.slot || null,
      goal: p.goal || null, // engagement ask (comments/saves/sends) — learner input
      endpoint: null,
    };
    try {
      if (platform === "youtube") {
        const m = await bufferMetrics(id);
        if (m) {
          row.views = m.views;
          row.likes = m.likes;
          row.comments = m.comments;
          row.engagementRate = m.engagementRate;
          row.endpoint = "buffer:metrics";
        }
      } else {
        const res = await tryEndpoints(id);
        const d = res?.data || {};
        row.views = pick(d, ["views", "data.views", "metrics.views", "insights.views", "platforms.0.metrics.views"]);
        row.reach = pick(d, ["reach", "data.reach", "metrics.reach", "platforms.0.metrics.reach"]);
        row.avgWatchMs = pick(d, ["igReelsAvgWatchTime", "avg_watch_time", "metrics.avgWatchTime"]);
        row.skipRate = pick(d, ["reelsSkipRate", "skip_rate", "metrics.skipRate"]);
        row.shares = pick(d, ["shares", "data.shares", "metrics.shares", "platforms.0.metrics.shares"]);
        row.saved = pick(d, ["saved", "saves", "metrics.saved"]);
        row.likes = pick(d, ["likes", "data.likes", "metrics.likes", "platforms.0.metrics.likes"]);
        row.comments = pick(d, ["comments", "data.comments", "metrics.comments", "platforms.0.metrics.comments"]);
        row.endpoint = res?.url || null;
      }
    } catch { /* per-post best-effort — one dead endpoint never stops the sweep */ }
    row.sendsPerReach = row.shares != null && row.reach ? +(row.shares / row.reach).toFixed(4) : null;
    row.likesPerReach = row.likes != null && row.reach ? +(row.likes / row.reach).toFixed(4) : null;
    // YouTube retries an empty sweep (Buffer metrics can lag); Zernio rows mark collected regardless —
    // LIVE-PROBED 2026-07-16: Zernio's API exposes NO metrics fields at all (no views/reach/likes on
    // any endpoint), so retrying forever would just append null rows every 6h. If Zernio ships an
    // analytics surface later, drop this and the endpoint probe picks it up.
    const gotData = [row.views, row.reach, row.likes, row.comments].some((v) => v != null);
    appendInsight(row);
    rows.push(row);
    if (gotData || platform !== "youtube") p.collected = [...new Set([...(p.collected || []), ...hoursMarks.filter((h) => h <= mark)])];
  }
  if (rows.length) savePosted(ledger);
  return rows;
}
