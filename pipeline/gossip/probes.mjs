// GOSSIP — start-of-run dependency probes (Phase 0, mirrors the inside lane's INSIDE_DIAG). When GOSSIP_DIAG=1
// the scheduler logs ONE http-status line per free dependency, so a starved cloud run diagnoses from the Actions
// log in one look (a dead feed is otherwise indistinguishable from a quiet news day). Never throws; ~6s cap each.
const PROBES = [
  ["google-news-rss", "https://news.google.com/rss/search?q=celebrity&hl=en-US&gl=US&ceid=US:en"],
  ["pagesix-rss", "https://pagesix.com/feed/"],
  ["bluesky-api", "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=popbase.bsky.social"],
  ["tmdb", "https://api.themoviedb.org/3/configuration"],
  ["jina-reader", "https://r.jina.ai/https://example.com"],
  ["gdelt", "https://api.gdeltproject.org/api/v2/doc/doc?query=celebrity&mode=artlist&maxrecords=1&format=json"],
];

export async function runProbes({ fetchImpl = fetch, timeoutMs = 6000, log = console.log } = {}) {
  const results = [];
  await Promise.all(PROBES.map(async ([name, url]) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetchImpl(url, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (TSR diag probe)" } });
      results.push({ name, status: res.status, ms: Date.now() - t0 });
    } catch (e) {
      results.push({ name, status: String(e?.name === "AbortError" ? "timeout" : e?.message || "error").slice(0, 40), ms: Date.now() - t0 });
    } finally { clearTimeout(timer); }
  }));
  for (const r of results.sort((a, b) => a.name.localeCompare(b.name))) log(`[diag] ${r.name}: ${r.status} (${r.ms}ms)`);
  return results;
}
