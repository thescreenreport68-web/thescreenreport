// AGENT 23 — ANALYTICS COLLECTOR (plan §2.2 #23, §5.7): per-reel insights at fixed
// offsets → learning ledger. Zernio's insights surface is a Step-0 capability probe —
// this module tries the plausible endpoints, records what works, and NEVER breaks a run
// (analytics is garnish for publishing, load-bearing only for learning).
import { IG } from "../config.mjs";
import { fetchWithTimeout } from "../lib/util.mjs";
import { loadPosted, savePosted, appendInsight } from "../lib/ledger.mjs";

const zHeaders = () => ({ Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, "Content-Type": "application/json" });

async function tryEndpoints(postId) {
  const candidates = [
    `${IG.zernio.base}/posts/${postId}/analytics`,
    `${IG.zernio.base}/posts/${postId}/insights`,
    `${IG.zernio.base}/analytics/posts/${postId}`,
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
    if (v !== undefined && v !== null) return Number(v);
  }
  return null;
}

export async function collect({ hoursMarks = [3, 24, 72, 168] } = {}) {
  const ledger = loadPosted(); // mutated in place and SAVED at the end (collected marks persist)
  const posted = ledger.posts.filter((p) => p.zernioId && p.mode === "scheduled");
  const now = Date.now();
  const rows = [];
  for (const p of posted) {
    const goLive = new Date(p.whenISO || p.at).getTime();
    if (goLive > now) continue; // still scheduled in the future
    const ageH = (now - goLive) / 3600e3;
    // collect the HIGHEST due mark not yet collected (skips stale lower marks)
    const mark = [...hoursMarks].reverse().find((h) => ageH >= h && !(p.collected || []).includes(h));
    if (!mark) continue;
    const res = await tryEndpoints(p.zernioId);
    const d = res?.data || {};
    const row = {
      slug: p.slug,
      zernioId: p.zernioId,
      mark,
      at: new Date().toISOString(),
      views: pick(d, ["views", "data.views", "metrics.views", "insights.views"]),
      reach: pick(d, ["reach", "data.reach", "metrics.reach"]),
      avgWatchMs: pick(d, ["igReelsAvgWatchTime", "avg_watch_time", "metrics.avgWatchTime"]),
      skipRate: pick(d, ["reelsSkipRate", "skip_rate", "metrics.skipRate"]),
      shares: pick(d, ["shares", "data.shares", "metrics.shares"]),
      saved: pick(d, ["saved", "saves", "metrics.saved"]),
      likes: pick(d, ["likes", "data.likes", "metrics.likes"]),
      comments: pick(d, ["comments", "data.comments", "metrics.comments"]),
      hookStyle: p.hookStyle || null,
      segment: p.segment || null,
      slot: p.slot || null,
      goal: p.goal || null, // engagement ask (comments/saves/sends) — learner input
      endpoint: res?.url || null, // which endpoint worked (capability discovery)
    };
    row.sendsPerReach = row.shares != null && row.reach ? +(row.shares / row.reach).toFixed(4) : null;
    row.likesPerReach = row.likes != null && row.reach ? +(row.likes / row.reach).toFixed(4) : null;
    appendInsight(row);
    rows.push(row);
    // mark all due marks ≤ this one as done (we collected the freshest snapshot)
    p.collected = [...new Set([...(p.collected || []), ...hoursMarks.filter((h) => h <= mark)])];
  }
  if (rows.length) savePosted(ledger);
  return rows;
}
