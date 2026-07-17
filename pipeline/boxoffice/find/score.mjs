// P2 FIND — DETERMINISTIC DEMAND SCORING (no LLM, no paid tools — BOX_OFFICE_UPGRADE_PLAN §L2).
// priority = recency + owner-corroboration + event-kind weight + RELEASE-RECENCY (the "Moana beats
// day-62 Obsession" fix — a hard freshness prior) + chart momentum. Free demand proxies only:
// cross-outlet count is the primary search-demand signal (many outlets covering = people searching).

const RECENCY = [[0.25, 30], [1, 24], [3, 16], [6, 10], [12, 6], [24, 3]]; // [maxAgeH, pts]
export const recencyPts = (ageH) => {
  if (!Number.isFinite(ageH) || ageH < 0) return 2;
  for (const [h, p] of RECENCY) if (ageH <= h) return p;
  return 2;
};

export const KIND_PTS = { record: 15, opening: 14, milestone: 13, weekend: 12, "streaming-arrival": 12, viewership: 10, "netflix-top10": 10, "trending-tv": 8, chart: 6, other: 6 };

// Release recency: a film in its FIRST week is what readers are searching; a day-45+ film is a tracker
// footnote. daysInRelease from the chart's own day number (authoritative) or tracked state.
export const releaseRecencyBoost = (days) => {
  if (!Number.isFinite(days)) return 0;
  if (days <= 7) return 12;
  if (days <= 14) return 8;
  if (days <= 30) return 4;
  if (days > 45) return -6;
  return 0;
};

// scoreEvent(ev) → integer priority. `ev`: {kind, ownerGroups, newestMs, daysInRelease?, chartRank?}.
export function scoreEvent(ev, { nowMs = Date.now() } = {}) {
  const ageH = (nowMs - (ev.newestMs || nowMs)) / 3600e3;
  let p = recencyPts(ageH);
  p += Math.min(24, (ev.ownerGroups || 1) * 8);
  p += KIND_PTS[ev.kind] ?? 6;
  p += releaseRecencyBoost(ev.daysInRelease);
  if (Number.isFinite(ev.chartRank) && ev.chartRank <= 3) p += 6; // top of the daily chart = live demand
  return Math.round(p);
}
