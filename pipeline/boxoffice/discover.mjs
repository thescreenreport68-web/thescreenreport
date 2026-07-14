// DISCOVERY (deterministic) — the candidate pool of in-theater + trending Hollywood films the
// finder picks from (plan §8 finder input, §17 step-1 discover). Free TMDB now-playing + trending;
// scope-filtered to Hollywood / English-language. The gatherer later pulls the actual trade
// box-office REPORT (via the shared contentFinder), so discovery only needs to surface WHICH films
// are worth a money story right now + a "what's hot" popularity signal.
//
// Uses a lean local TMDB GET (the shared tmdb.mjs keeps its `tmdb()` helper private) — this stays
// inside the lane and reads TMDB_READ_TOKEN from env exactly like the shared lib.
import { scopeOk } from "./config.bo.mjs";

const BASE = "https://api.themoviedb.org/3";
const H = () => ({ Authorization: "Bearer " + process.env.TMDB_READ_TOKEN, accept: "application/json" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdbGet(path, { fetchImpl = fetch } = {}) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetchImpl(BASE + path, { headers: H(), signal: AbortSignal.timeout(10000) });
      if (r.status === 429 || r.status >= 500) { await sleep(700 * (a + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(500 * (a + 1)); }
  }
  return null;
}

const toFilm = (m, via) => ({
  id: m.id,
  title: m.title || m.original_title,
  year: (m.release_date || "").slice(0, 4),
  releaseDate: m.release_date || "",
  popularity: m.popularity || 0,
  voteCount: m.vote_count || 0,
  overview: m.overview || "",
  originalLanguage: m.original_language || "",
  via,
});

// discoverFilms({ region, nowMs }) → scope-filtered candidate films, hottest first, deduped by id.
// Injected fetchImpl keeps the offline suite network-free.
export async function discoverFilms({ region = "US", nowMs = null, fetchImpl = fetch, max = 60 } = {}) {
  // Broaden the in-theater pool so EVERY movie in theaters can be covered (owner: cover them all): two pages
  // of now-playing + the week's trending. Page 2 surfaces the smaller/older-but-still-running releases.
  const [np1, np2, np3, trendWeek, trendDay] = await Promise.all([
    tmdbGet(`/movie/now_playing?region=${region}&page=1`, { fetchImpl }),
    tmdbGet(`/movie/now_playing?region=${region}&page=2`, { fetchImpl }),
    tmdbGet(`/movie/now_playing?region=${region}&page=3`, { fetchImpl }),
    tmdbGet(`/trending/movie/week`, { fetchImpl }),
    tmdbGet(`/trending/movie/day`, { fetchImpl }),
  ]);
  const byId = new Map();
  for (const src of [np1, np2, np3]) for (const m of src?.results || []) if (!byId.has(m.id)) byId.set(m.id, toFilm(m, "now_playing"));
  for (const src of [trendWeek, trendDay]) for (const m of src?.results || []) {
    // trending gives the "what's hot" signal (and trending films tend to have trade coverage → they publish);
    // only merge films that are also plausibly in release.
    if (byId.has(m.id)) { byId.get(m.id).trendingHot = true; continue; }
    const f = toFilm(m, "trending"); f.trendingHot = true;
    if (f.releaseDate) byId.set(m.id, f);
  }
  const films = [...byId.values()]
    .filter((f) => f.title && scopeOk(f))
    .sort((a, b) => (b.trendingHot ? 1 : 0) - (a.trendingHot ? 1 : 0) || b.popularity - a.popularity)
    .slice(0, max);
  return films;
}
