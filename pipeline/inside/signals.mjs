// TRENDING-DISCOURSE SIGNALS (REV 3 — owner 2026-07-10: "find the stories people are ACTUALLY
// crazy about", the Odyssey/Elliot-Page + Lupita/Homer class). Two keyless public feeds + a TMDB
// entertainment check. Everything fails closed to []/null — discovery never dies on a signal.
//   • trendingSearches() — Google Trends "trending now" RSS: literally what people are searching
//     for right now, with the news articles that triggered each term (free harvest seeds).
//   • wikiSpikes() — Wikimedia top-pageviews day-over-day: who everyone is SUDDENLY looking up
//     (live proof at build time: Bonnie Tyler, 1.27M views, rank 2 site-wide).
//   • tmdbMatch() — is this term a film/TV/person entity (the entertainment filter for both).

const UA = { "user-agent": "Mozilla/5.0 (compatible; ScreenReportBot)" };
const to = (ms) => ({ signal: AbortSignal.timeout(ms) });
const unesc = (s) =>
  (s || "").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

export async function trendingSearches({ geo = "US", fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`https://trends.google.com/trending/rss?geo=${geo}`, { headers: UA, ...to(9000) });
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .map((m) => {
        const it = m[1];
        const term = unesc((it.match(/<title>([^<]*)</) || [])[1] || "");
        const traffic = Number(((unesc((it.match(/<ht:approx_traffic>([^<]*)</) || [])[1] || "")).match(/[\d,]+/) || ["0"])[0].replace(/,/g, "")) || 0;
        const news = [...it.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)]
          .map((n) => ({
            title: unesc((n[1].match(/<ht:news_item_title>([^<]*)</) || [])[1] || ""),
            url: unesc((n[1].match(/<ht:news_item_url>([^<]*)</) || [])[1] || ""),
            source: unesc((n[1].match(/<ht:news_item_source>([^<]*)</) || [])[1] || ""),
          }))
          .filter((n) => n.url);
        return { term, traffic, news };
      })
      .filter((t) => t.term);
  } catch {
    return [];
  }
}

const pad = (n) => String(n).padStart(2, "0");
async function topDay(d, fetchImpl) {
  const u = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
  const res = await fetchImpl(u, { headers: UA, ...to(9000) });
  if (!res.ok) return [];
  return (await res.json())?.items?.[0]?.articles || [];
}

// Namespaces, the front page, evergreen list/date pages — never a discourse subject.
const WIKI_JUNK = /^(Main_Page$|Special:|Wikipedia:|Portal:|Help:|Template:|File:|Category:|Deaths_in|List_of|\d{4}(_|$)|.*_\(disambiguation\)$)/;

export async function wikiSpikes({ fetchImpl = fetch, nowMs = null, minViews = 150000, top = 60 } = {}) {
  try {
    const now = nowMs ?? Date.now();
    // The "top" dataset publishes with lag — read D-1 (spiking day) against D-2 (baseline).
    const [a, b] = await Promise.all([
      topDay(new Date(now - 26 * 36e5), fetchImpl),
      topDay(new Date(now - 50 * 36e5), fetchImpl),
    ]);
    if (!a.length) return [];
    const prev = new Map(b.map((x) => [x.article, x.views]));
    return a
      .slice(0, top)
      .filter((x) => x.views >= minViews && !WIKI_JUNK.test(x.article))
      .map((x) => {
        const prevViews = prev.get(x.article) || 0;
        // Not in yesterday's top at all = a brand-new surge (treated as a maximal spike).
        return { name: x.article.replace(/_/g, " "), views: x.views, spike: prevViews ? Math.round((x.views / prevViews) * 10) / 10 : 99 };
      })
      .filter((x) => x.spike >= 2.5);
  } catch {
    return [];
  }
}

// Entertainment check: the term must resolve to a TMDB movie/TV/person whose name actually matches
// (search/multi ranks loosely — we require name↔term containment). null = not entertainment.
export async function tmdbMatch(term, { fetchImpl = fetch } = {}) {
  try {
    if (!process.env.TMDB_READ_TOKEN) return null;
    const res = await fetchImpl(
      `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(term)}&include_adult=false&page=1`,
      { headers: { Authorization: "Bearer " + process.env.TMDB_READ_TOKEN, accept: "application/json" }, ...to(9000) },
    );
    if (!res.ok) return null;
    const nq = term.toLowerCase().trim();
    for (const r of (((await res.json())?.results) || []).slice(0, 3)) {
      const name = (r.title || r.name || "").toLowerCase().trim();
      if (!name) continue;
      if (name === nq || nq.includes(name) || name.includes(nq)) {
        return {
          kind: r.media_type,
          title: r.title || r.name,
          popularity: r.popularity || 0,
          year: (r.release_date || r.first_air_date || "").slice(0, 4) || null,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}
