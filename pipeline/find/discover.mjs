// Stage 1 — DISCOVER (v2: real-time feeds are the DRIVER; TMDB is the entity/calendar backbone).
import { discoverRSS } from "./sources/rss.mjs";
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

  // PRIMARY: real-time news feeds (the breaking driver)
  const rss = await discoverRSS(opts.rss || {});
  monitor.stage("discover", `RSS (real-time) → ${rss.length} fresh items`, countBy(rss, "outlet"));
  all.push(...rss);

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
  monitor.stage("discover", `${uniq.length} unique candidates (${rss.length} breaking-feed + ${tmdb.length} backbone)`);
  return uniq;
}
