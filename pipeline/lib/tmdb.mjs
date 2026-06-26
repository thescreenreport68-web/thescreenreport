// TMDB live streaming-availability (where-to-watch) — the live data that lets streaming guides
// publish ACCURATE current availability instead of the model guessing. Reads TMDB_READ_TOKEN from env.
const BASE = "https://api.themoviedb.org/3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = () => ({ Authorization: "Bearer " + process.env.TMDB_READ_TOKEN, accept: "application/json" });

async function tmdb(path) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(BASE + path, { headers: H() });
      if (r.status === 429 || r.status >= 500) { await sleep(800 * (a + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      await sleep(600 * (a + 1));
    }
  }
  return null;
}

export async function searchTitle(name, type) {
  // Use the year (from "(2021 film)" or anywhere) to disambiguate; strip suffixes from the query text.
  const ym = name.match(/\b(19|20)\d{2}\b/);
  const year = ym ? ym[0] : null;
  const q = name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\b(19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim();
  const yp = year ? (type === "movie" ? `&year=${year}` : `&first_air_date_year=${year}`) : "";
  const j = await tmdb(`/search/${type}?query=${encodeURIComponent(q)}${yp}&include_adult=false`);
  return j?.results?.[0] || null;
}

// Clean provider names (drop "Amazon Channel"/"Apple TV Channel"/"with Ads" variants, dedup).
const clean = (arr) => {
  const seen = new Set();
  const out = [];
  for (const p of arr || []) {
    const n = p.provider_name.replace(/ (Amazon|Apple TV|Roku) Channel$/i, "").replace(/ with Ads$/i, "").trim();
    if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
};

export async function watchProviders(id, type, region = "US") {
  const j = await tmdb(`/${type}/${id}/watch/providers`);
  const r = j?.results?.[region];
  if (!r) return null;
  return { stream: clean(r.flatrate), rent: clean(r.rent), buy: clean(r.buy), link: r.link };
}

// For a list of titles, resolve each (movie, then TV) and fetch current US availability.
export async function getWhereToWatch(titles, region = "US") {
  const out = [];
  for (const t of titles || []) {
    if (!t) continue;
    let res = await searchTitle(t, "movie");
    let type = "movie";
    if (!res) { res = await searchTitle(t, "tv"); type = "tv"; }
    if (!res) continue;
    const wp = await watchProviders(res.id, type, region);
    out.push({
      title: res.title || res.name,
      year: (res.release_date || res.first_air_date || "").slice(0, 4),
      type,
      providers: wp || { stream: [], rent: [], buy: [] },
    });
    await sleep(120);
  }
  return out;
}

// A plain-text facts block to ground the writer.
export function factBlock(list) {
  return list
    .map((w) => {
      const p = w.providers;
      const parts = [];
      if (p.stream?.length) parts.push("Stream: " + p.stream.join(", "));
      if (p.rent?.length) parts.push("Rent: " + p.rent.slice(0, 4).join(", "));
      if (p.buy?.length) parts.push("Buy: " + p.buy.slice(0, 3).join(", "));
      return `${w.title} (${w.year}): ${parts.join("; ") || "not on major US streaming"}`;
    })
    .join("\n");
}

// Resolve a streaming provider's TMDB id by name (e.g. "Max", "Netflix").
export async function resolveProvider(name, region = "US") {
  const j = await tmdb(`/watch/providers/movie?watch_region=${region}`);
  const list = j?.results || [];
  const n = name.toLowerCase();
  const p =
    list.find((x) => x.provider_name.toLowerCase() === n) ||
    list.find((x) => x.provider_name.toLowerCase().includes(n));
  return p?.provider_id || null;
}

// Discover the top-rated films actually streaming on a provider — a real, substantial pool to rank.
export async function discoverTop(providerName, region = "US", count = 12) {
  const pid = await resolveProvider(providerName, region);
  if (!pid) return { providerName, titles: [] };
  const j = await tmdb(
    `/discover/movie?watch_region=${region}&with_watch_providers=${pid}&with_watch_monetization_types=flatrate&sort_by=vote_average.desc&vote_count.gte=2000&page=1`
  );
  const titles = (j?.results || [])
    .slice(0, count)
    .map((m) => ({ title: m.title, year: (m.release_date || "").slice(0, 4), rating: m.vote_average, votes: m.vote_count }));
  return { providerName, providerId: pid, titles };
}

export function discoverFactBlock(d) {
  return (
    `TOP FILMS CURRENTLY STREAMING ON ${d.providerName} (US, ranked by audience/critic rating, via TMDB — ALL confirmed available now):\n` +
    d.titles.map((t, i) => `${i + 1}. ${t.title} (${t.year}) — rating ${t.rating?.toFixed(1)}/10`).join("\n")
  );
}

// The structured whereToWatch[] for the table — built directly from TMDB (deterministic, accurate).
export function toWhereToWatch(list) {
  return list.map((w) => {
    const p = w.providers;
    if (p.stream?.length) return { title: w.title, platform: p.stream.slice(0, 3).join(", "), type: "Stream", year: w.year };
    if (p.rent?.length) return { title: w.title, platform: p.rent.slice(0, 3).join(", "), type: "Rent / Buy", year: w.year };
    return { title: w.title, platform: "Not on major US streaming", type: "", year: w.year };
  });
}
