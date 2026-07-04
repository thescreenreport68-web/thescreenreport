// Stage 1 — DISCOVER (2026-07-04, NEWS_AUTOMATION_SPEC §6b). TWO free discovery lanes so the finder is never blind to
// a big trending story that scrolled off a 10-item feed:
//   (1) TOP-OUTLET RSS — the major trades' MAIN + SECTION feeds (film / tv / box-office) for topic-concentrated reach.
//   (2) GOOGLE-NEWS SEARCH — trending Hollywood terms (weekend box office, new trailer, big titles), ranked by what's
//       actually trending right now, so a story a day old (the Odyssey trailer, Supergirl's box-office bomb) is found.
// gnews is kept to CREDIBLE outlets (tier>=5 drops tabloid/junk); the scope/editorial gate downstream drops anything
// out-of-scope (games/anime/regional) and the ROUNDUP/RETRO guards drop listicles — so trending discovery is restored
// WITHOUT the open-web junk that made us remove it before.
import { discoverRSS } from "./sources/rss.mjs";
import { discoverGoogleNews } from "./sources/gnews.mjs";

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
  // Two free lanes in parallel: top-outlet RSS (main + section feeds) + Google-News trending search.
  const [rss, gnewsRaw] = await Promise.all([
    discoverRSS(opts.rss || {}),
    discoverGoogleNews(opts.gnews || {}).catch(() => []),
  ]);
  // gnews: keep only CREDIBLE outlets (tier>=5 drops known tabloids/junk; unknowns default to 5 and are kept, then
  // filtered downstream by the scope/editorial gate). This restores trending discovery without the open-web junk.
  const gnews = gnewsRaw.filter((c) => (c.sourceTier || 0) >= 5);
  monitor.stage("discover", `RSS (main+section) → ${rss.length} · Google-News trending → ${gnews.length}`, countBy([...rss, ...gnews], "outlet"));

  // intra-run de-dup by candidate key (RSS first so a story carried by both keeps the top-trade RSS record).
  const seen = new Set();
  const uniq = [];
  for (const c of [...rss, ...gnews]) {
    const k = candidateKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    c.key = k;
    uniq.push(c);
  }
  monitor.count("discovered", uniq.length);
  monitor.count("rssFresh", rss.length);
  monitor.count("gnewsTrending", gnews.length);
  monitor.stage("discover", `${uniq.length} unique candidates (top-outlet RSS + Google-News trending)`);
  return uniq;
}
