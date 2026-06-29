// Stage 1 — DISCOVER (v2: real-time feeds are the DRIVER; TMDB is the entity/calendar backbone).
import { discoverRSS } from "./sources/rss.mjs";
import { discoverGoogleNews } from "./sources/gnews.mjs";
import { discoverTMDB } from "./sources/tmdb.mjs";

export function candidateKey(c) {
  if (c.tmdbId) return (c.mediaType || "x") + ":" + c.tmdbId;
  return "rss:" + (c.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
}
function countBy(arr, k) {
  const o = {};
  for (const x of arr) o[x[k]] = (o[x[k]] || 0) + 1;
  return o;
}

export async function discover(monitor, opts = {}) {
  const all = [];

  // PRIMARY: real-time news feeds (the breaking driver) + Google News search (cross-outlet corroboration breadth —
  // the same trending story from MANY outlets, so a single-outlet item crosses the 2-independent-owner bar).
  const [rss, gnews] = await Promise.all([discoverRSS(opts.rss || {}), discoverGoogleNews(opts.gnews || {})]);
  monitor.stage("discover", `RSS (real-time) → ${rss.length} fresh items`, countBy(rss, "outlet"));
  all.push(...rss);
  monitor.stage("discover", `Google News search → ${gnews.length} items (cross-outlet corroboration)`);
  all.push(...gnews);

  // BACKBONE: TMDB structured entity/calendar feed (evergreen + release data, NOT the breaking driver)
  const tmdb = await discoverTMDB(opts.tmdb || {});
  monitor.stage("discover", `TMDB (backbone) → ${tmdb.length} candidates`, countBy(tmdb, "kind"));
  all.push(...tmdb);

  // intra-run de-dup by candidate key
  const seen = new Set();
  const uniq = [];
  for (const c of all) {
    const k = candidateKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    c.key = k;
    uniq.push(c);
  }
  monitor.count("discovered", uniq.length);
  monitor.count("rssFresh", rss.length);
  monitor.stage("discover", `${uniq.length} unique candidates (${rss.length} RSS + ${gnews.length} Google News + ${tmdb.length} backbone)`);
  return uniq;
}
