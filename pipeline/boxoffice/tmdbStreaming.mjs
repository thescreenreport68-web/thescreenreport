// STREAMING SUPPLY BEYOND NETFLIX (2026-07-19). The owner's mix is 15 box-office + 5 streaming/day, but
// Netflix's Top 10 refreshes WEEKLY with ~25 distinct English titles — 3.6/day at absolute best, and only
// if every single one publishes. 5/day is arithmetically impossible from Netflix alone.
//
// This adds the other platforms using TMDB /discover filtered by watch provider (free, keyless beyond the
// TMDB token the lane already uses, US region, subscription/flatrate only). It yields what is REAL and
// verifiable: the title, the CONFIRMED platform it streams on, its popularity/rating, cast and premise.
// It deliberately yields NO viewership figure — only Netflix publishes hours, and the watch-hours guard
// stays exactly as strict as it was. A story here is "what's actually trending to watch on Prime/Max/
// Disney+ right now", grounded in TMDB's own trending signal, never an invented audience number.
import { scopeOk } from "./config.bo.mjs";

// Conversion floors, set from the first live run's failures (see discoverByProvider). A title below these
// has no published coverage to ground an article in, so it dies at the walls after paying for a draft.
const MIN_POPULARITY = Number(process.env.BOXOFFICE_STREAM_MIN_POP) || 80;
const MIN_VOTES = Number(process.env.BOXOFFICE_STREAM_MIN_VOTES) || 200;
const MIN_OVERVIEW_CHARS = 140;

const BASE = "https://api.themoviedb.org/3";
const H = () => ({ Authorization: "Bearer " + process.env.TMDB_READ_TOKEN, accept: "application/json" });

// TMDB watch-provider ids (US). Netflix is intentionally EXCLUDED — the Netflix lane already covers it
// with first-party hours, which is strictly better material than a trending rank.
export const PROVIDERS = [
  { id: 9, name: "Prime Video" },
  { id: 337, name: "Disney+" },
  { id: 1899, name: "HBO Max" },
  { id: 15, name: "Hulu" },
  { id: 350, name: "Apple TV+" },
  { id: 386, name: "Peacock" },
  { id: 531, name: "Paramount+" },
];

async function tmdbGet(path, { fetchImpl = fetch } = {}) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetchImpl(BASE + path, { headers: H(), signal: AbortSignal.timeout(10000) });
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 600 * (a + 1))); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await new Promise((s) => setTimeout(s, 400 * (a + 1))); }
  }
  return null;
}

// discoverByProvider(kind) → titles currently streaming on each platform, most-popular first.
// `kind` is "tv" or "movie". Recency-bounded so we surface what is NEW to a service, not its back catalogue.
export async function discoverByProvider(kind = "tv", { fetchImpl = fetch, perProvider = 4, nowMs = Date.now(), windowDays = 120 } = {}) {
  const since = new Date(nowMs - windowDays * 86400000).toISOString().slice(0, 10);
  const dateField = kind === "tv" ? "first_air_date.gte" : "primary_release_date.gte";
  const out = [];
  for (const p of PROVIDERS) {
    const q = `/discover/${kind}?watch_region=US&with_watch_monetization_types=flatrate&with_watch_providers=${p.id}`
      + `&sort_by=popularity.desc&with_original_language=en&${dateField}=${since}&page=1`;
    const data = await tmdbGet(q, { fetchImpl });
    for (const r of (data?.results || []).slice(0, perProvider)) {
      const title = r.name || r.title || "";
      if (!title || !scopeOk({ title, overview: r.overview, originalLanguage: r.original_language })) continue;
      // SUPPLY MUST BE ABLE TO CONVERT. The first live run of this source attempted 12 obscure titles and
      // published NONE — Off Campus (pop 60), Ride or Die (pop 30), The Westies (pop 30) each died on
      // "unverified claims", the word floor or the engagement floor, because nobody has written about them
      // and there is no honest way to reach 180 engaging words. Quantity that cannot clear the quality bar
      // is not volume, it is spend. Require a real audience signal AND enough premise to write from.
      const audience = (r.popularity || 0) >= MIN_POPULARITY || (r.vote_count || 0) >= MIN_VOTES;
      if (!audience) continue;
      if (String(r.overview || "").length < MIN_OVERVIEW_CHARS) continue;
      out.push({
        id: r.id,
        title,
        kind,
        platform: p.name,          // CONFIRMED by the provider filter itself — this is the whole point
        popularity: r.popularity || 0,
        voteAverage: r.vote_average || null,
        voteCount: r.vote_count || 0,
        overview: r.overview || "",
        date: r.first_air_date || r.release_date || "",
      });
    }
  }
  // Most popular first, de-duplicated by title (a title on two services keeps the more popular row).
  const byTitle = new Map();
  for (const t of out.sort((a, b) => b.popularity - a.popularity)) {
    const k = t.title.toLowerCase();
    if (!byTitle.has(k)) byTitle.set(k, t);
  }
  return [...byTitle.values()];
}
