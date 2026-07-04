// Stage 1 — DISCOVER (2026-07-03 simplification, owner directive): TOP-OUTLET RSS is the ONLY driver. The broad
// Google-News web search and the TMDB "trending backbone" were REMOVED — they dragged in the whole open web
// (Bollywood, anime/game blogs, quiz pages, listicles = the junk). We now surface only the latest stories from the
// major trades' own feeds, and write them faithfully. (gnews.mjs/tmdb.mjs remain in the tree, just not wired here.)
import { discoverRSS } from "./sources/rss.mjs";

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
  // The ONLY source: the top trades' real-time RSS feeds.
  const rss = await discoverRSS(opts.rss || {});
  monitor.stage("discover", `top-outlet RSS → ${rss.length} fresh items`, countBy(rss, "outlet"));

  // intra-run de-dup by candidate key
  const seen = new Set();
  const uniq = [];
  for (const c of rss) {
    const k = candidateKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    c.key = k;
    uniq.push(c);
  }
  monitor.count("discovered", uniq.length);
  monitor.count("rssFresh", rss.length);
  monitor.stage("discover", `${uniq.length} unique candidates (top-outlet RSS only)`);
  return uniq;
}
