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

// Diverse selection: fill the queue round-robin across (category/subcategory) buckets so no single
// subcategory starves the rest — the owner wants coverage across every category + subcategory, not 10
// near-identical news items. publishableOnly drops held topics (CONFIRMING/QUEUE/EDITORIAL-HOLD).
export function selectDiverse(rankedTopics, { n = 10, perSubcatMax = 2, publishableOnly = true } = {}) {
  const pool = publishableOnly ? rankedTopics.filter((t) => t.verification?.publishable) : rankedTopics;
  const buckets = new Map();
  for (const t of pool) {
    const k = `${t.category}/${t.subcategory}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  // bucket order = best topic in each bucket, descending (so the strongest subcategory leads each round)
  const order = [...buckets.entries()].sort((a, b) => (b[1][0]?.priority || 0) - (a[1][0]?.priority || 0)).map(([k]) => k);
  const picked = [];
  const taken = {};
  let round = 0;
  while (picked.length < n && round < perSubcatMax) {
    let advanced = false;
    for (const k of order) {
      if (picked.length >= n) break;
      const idx = taken[k] || 0;
      if (idx < Math.min(perSubcatMax, buckets.get(k).length)) {
        picked.push(buckets.get(k)[idx]);
        taken[k] = idx + 1;
        advanced = true;
      }
    }
    if (!advanced) break;
    round++;
  }
  return picked;
}

// MUSIC 60/40 LANE ALLOCATION (owner 2026-06-28): inside music's 10% share, 60% POPULAR-trending + 40%
// INDIE-breakout. The two pools are filled SEPARATELY (each still round-robined across the music subcats),
// so high-volume pop news can't starve the indie lane. If the indie pool underfills (no genuine breakout
// cleared the detector that day), we DO NOT backfill it with pop — we ship fewer music items rather than
// dilute the lane or fake a breakout. Returns the merged music picks; the caller fills the rest non-music.
export function selectMusicLanes(musicTopics, { popN = 0, indieN = 0, perSubcatMax = 2 } = {}) {
  const pub = (musicTopics || []).filter((t) => t.verification?.publishable);
  const pop = pub.filter((t) => (t.tier || "popular") !== "indie");
  const indie = pub.filter((t) => t.tier === "indie");
  const popPicks = popN > 0 ? selectDiverse(pop, { n: popN, perSubcatMax, publishableOnly: false }) : [];
  const indiePicks = indieN > 0 ? selectDiverse(indie, { n: indieN, perSubcatMax, publishableOnly: false }) : [];
  return { picks: [...popPicks, ...indiePicks], popPicked: popPicks.length, indiePicked: indiePicks.length };
}

// Compute the music lane quotas for a target queue size n: music = 10% of n, split 60/40 pop/indie.
export function musicQuota(n) {
  const musicN = Math.max(0, Math.round(n * 0.1));
  const popN = Math.round(musicN * 0.6);
  return { musicN, popN, indieN: musicN - popN };
}
