// Stages 4 + 6 (v2) — DEMAND + PRIORITY ranking on FREE signals only. v1 sorted by TMDB popularity,
// which is broken for breaking news (RSS items have popularity 0 and would sort last). v2 ranks by:
//   recency (the breaking clock) + cross-source corroboration + verification trust + event-type weight.
// This is the free-stack approximation of MASTER_PLAN App-S (demand) + App-N (priority); the GDELT-NGram
// velocity + Wikipedia-pageview spike signals slot in here later (they only raise accuracy, not shape).

// App-S Signal D — article-type weight (static for v1; the learning loop auto-tunes it later).
const TYPE_WEIGHT = {
  death: 1.0, health: 0.95, arrest: 0.95, legal: 0.9, lawsuit: 0.9, scandal: 0.9,
  divorce: 0.8, breakup: 0.8, marriage: 0.8, pregnancy: 0.8, birth: 0.75,
  boxoffice: 0.7, award: 0.7, breakout: 0.7, casting: 0.65, trailer: 0.65, renewal: 0.55, cancellation: 0.6,
  reaction: 0.55, interview: 0.55, review: 0.5, announcement: 0.5, other: 0.4,
};
const STATUS_WEIGHT = { CONFIRMED: 25, DEVELOPING: 18, EVERGREEN: 14, RUMOR: 8, QUEUE: 4, CONFIRMING: 3, "EDITORIAL-HOLD": 1 };

function recencyPts(ageMin) {
  if (ageMin == null) return 7; // TMDB-backbone / evergreen: a flat baseline, not "old"
  if (ageMin <= 15) return 30;
  if (ageMin <= 60) return 24;
  if (ageMin <= 180) return 16;
  if (ageMin <= 360) return 9;
  if (ageMin <= 720) return 4;
  return 1;
}

function corroborationPts(t) {
  const sources = t.sources || [];
  const maxTier = sources.reduce((m, s) => Math.max(m, s.tier || 0), 0);
  const distinct = sources.length;
  // more independent outlets + a higher top-tier = stronger signal (cap ~25)
  return Math.min(25, distinct * 6 + Math.max(0, maxTier - 4) * 2);
}

export function scoreTopics(topics, monitor) {
  for (const t of topics) {
    const rec = recencyPts(t.ageMin);
    const corr = corroborationPts(t);
    const statusW = STATUS_WEIGHT[t.verification?.status] ?? 5;
    const typeW = (TYPE_WEIGHT[t.eventType] ?? 0.4) * 15;
    const popNudge = Math.min(6, Math.log10(1 + (t._cand?.popularity || 0)) * 2); // mild TMDB-backbone tilt
    const breakoutPts = Math.min(10, (t.breakoutVelocity || 0) / 4); // an accelerating indie breakout ranks up
    const priority = Math.round(rec + corr + statusW + typeW + popNudge + breakoutPts);
    t.priority = priority;
    t.signals = { recency: rec, corroboration: corr, status: statusW, type: Math.round(typeW), pop: Math.round(popNudge), breakout: Math.round(breakoutPts) };
  }
  topics.sort((a, b) => b.priority - a.priority);
  if (monitor) monitor.stage("score", `ranked ${topics.length} topics by freshness+corroboration+type (top=${topics[0]?.priority ?? "-"})`);
  return topics;
}

// TREND-PRIORITY SELECTION (rebuild 2026-06-29). The old version hard-capped each subcategory at perSubcatMax=2,
// which DROPPED the 3rd+ top-trending story in a hot subcategory (a scandal day, a music chart event) to make room
// for lower-priority items elsewhere — exactly the "drop a trending story for its shape" the owner forbids. Now we
// pick strictly by PRIORITY, with diversity only a SOFT tiebreak: each already-taken item from a subcategory adds a
// small penalty so near-ties spread out, but a genuinely higher-priority trending story is NEVER displaced. Music,
// box-office, celebrity, every shape compete in this ONE pool (the old music 10% quota / 60-40 lanes are gone —
// topic.tier pop/indie survives only as a downstream WRITING preset). publishableOnly drops held topics.
export function selectDiverse(rankedTopics, { n = 10, spreadPenalty = 6, publishableOnly = true } = {}) {
  const pool = (publishableOnly ? rankedTopics.filter((t) => t.verification?.publishable) : rankedTopics).slice();
  const picked = [];
  const taken = {};
  while (picked.length < n && pool.length) {
    let bestIdx = 0, bestEff = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const k = `${pool[i].category}/${pool[i].subcategory}`;
      const eff = (pool[i].priority || 0) - (taken[k] || 0) * spreadPenalty; // soft diversity nudge, NOT a hard cap
      if (eff > bestEff) { bestEff = eff; bestIdx = i; }
    }
    const t = pool.splice(bestIdx, 1)[0];
    const k = `${t.category}/${t.subcategory}`;
    taken[k] = (taken[k] || 0) + 1;
    picked.push(t);
  }
  return picked;
}
