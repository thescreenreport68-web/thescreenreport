// INDIE-BREAKOUT detector (zero-key, NON-Wikimedia — owner rule 2026-06-28: no Wikipedia anywhere). The 4%
// indie music lane is for an under-the-radar artist/track that UNEXPECTEDLY broke out. The core rule: a
// breakout is a DELTA, not a LEVEL — a pop star always has high absolute numbers; a real indie breakout is a
// small/under-the-radar artist getting sudden buzz. We confirm it from TWO independent FREE signals (mirrors
// verify.mjs's corroboration posture, so one noisy signal can't fake a breakout), with NO API keys:
//   1. Deezer follower count — the popularity LEVEL (a LOW fan base = genuinely under-the-radar; a high one =
//      an established act that is NOT an indie breakout). Replaces the former Wikipedia-pageviews signal.
//   2. Reddit JSON (r/indieheads + r/popheads + r/listentothis) — fresh post velocity = "people are posting
//      this name right now" (the spike). An established act (high Deezer base) stays "popular" regardless.
// Everything fails SAFE: any network hiccup just leaves the LLM's musicTier heuristic in place.
import { deezerExists } from "../../lib/music.mjs";

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";
const ESTABLISHED_FANS = 500000; // high Deezer base → established act → POPULAR (delta-not-level)
const LOW_BASELINE_FANS = 50000; // under this = under-the-radar; a Reddit spike on top = indie breakout

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
  const fans = await deezerExists(name); // Deezer follower count = the popularity LEVEL (non-Wikimedia)
  // High established base → definitively POPULAR (delta-not-level: a star isn't an indie breakout).
  if (fans >= ESTABLISHED_FANS) {
    topic.tier = "popular";
    topic.breakoutVelocity = 0;
    return { name, lane: "popular", reason: `established (${fans.toLocaleString("en-US")} Deezer fans)`, fans };
  }
  const lowBaseline = fans > 0 && fans < LOW_BASELINE_FANS; // a real, under-the-radar artist (exists, but small)
  const reddit = await redditVelocity(name);
  const redditHot = reddit >= 4;
  // TWO independent signals required (corroboration) → a genuine indie breakout: a LOW Deezer base + a Reddit spike.
  if (lowBaseline && redditHot) {
    topic.tier = "indie";
    topic.breakoutVelocity = Math.round(reddit * 5 + 10);
    return { name, lane: "indie", reason: `breakout: low Deezer base (${fans.toLocaleString("en-US")} fans) + ${reddit} reddit posts/wk`, fans, reddit };
  }
  return { name, lane: topic.tier || "popular", reason: "no corroborated breakout", fans, reddit };
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
