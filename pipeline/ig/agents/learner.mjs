// AGENT 24 — STRATEGY LEARNER (plan §2.2 #24, §5.7): weekly pass over the learning
// ledger. ALL thresholds account-relative (trailing medians — platform averages deflate).
// Outputs the weights the Scout + Script writer consume. Deterministic math; no LLM needed.
import { readInsights, loadWeights, saveWeights } from "../lib/ledger.mjs";

const median = (xs) => {
  const a = xs.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};

export function learn({ minSamples = 5 } = {}) {
  const rows = readInsights().filter((r) => r.mark >= 24); // judge on ≥24h data
  const latestPerSlug = new Map();
  for (const r of rows) {
    const cur = latestPerSlug.get(r.slug);
    if (!cur || r.mark > cur.mark) latestPerSlug.set(r.slug, r);
  }
  const data = [...latestPerSlug.values()];
  const weights = loadWeights();
  if (data.length < minSamples) {
    return { updated: false, reason: `only ${data.length} scored reels (need ${minSamples})`, weights };
  }

  const accountViews = median(data.map((r) => r.views));
  const accountSends = median(data.map((r) => r.sendsPerReach));

  const groupScore = (key) => {
    const groups = {};
    for (const r of data) {
      const g = r[key];
      if (!g) continue;
      (groups[g] = groups[g] || []).push(r);
    }
    const out = {};
    for (const [g, rs] of Object.entries(groups)) {
      if (rs.length < 3) continue; // not enough evidence either way
      const v = median(rs.map((r) => r.views));
      const s = median(rs.map((r) => r.sendsPerReach));
      // relative score: 1.0 = account median; kill signal < 0.7 across both
      const rel = ((v && accountViews ? v / accountViews : 1) + (s && accountSends ? s / accountSends : 1)) / 2;
      out[g] = +rel.toFixed(2);
    }
    return out;
  };

  weights.hookStyles = groupScore("hookStyle");
  weights.segments = groupScore("segment");
  weights.slots = groupScore("slot");
  weights.goals = groupScore("goal"); // which engagement ask works (per account, over time)
  weights.accountMedians = { views: accountViews, sendsPerReach: accountSends, samples: data.length };

  // winners: ≥3x trailing median views at 24h+ OR sends/reach ≥1.5%
  weights.winners = data
    .filter((r) => (accountViews && r.views >= 3 * accountViews) || (r.sendsPerReach ?? 0) >= 0.015)
    .map((r) => ({ slug: r.slug, views: r.views, sendsPerReach: r.sendsPerReach }));

  saveWeights(weights);
  return { updated: true, weights };
}
