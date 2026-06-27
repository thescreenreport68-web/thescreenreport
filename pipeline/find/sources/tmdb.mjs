// TMDB discovery — the cleanest structured source (every item arrives with a real id/title/type/date,
// so no entity-resolution guesswork). Reads TMDB_READ_TOKEN from env. Free.
const BASE = "https://api.themoviedb.org/3";
const H = () => ({ Authorization: "Bearer " + process.env.TMDB_READ_TOKEN, accept: "application/json" });
async function tget(p) {
  try {
    const r = await fetch(BASE + p, { headers: H() });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Returns a flat list of raw candidates from several TMDB feeds.
export async function discoverTMDB({ limitEach = 12 } = {}) {
  const out = [];
  const today = new Date().toISOString().slice(0, 10);
  // Map a TMDB feed + release date → the evergreen niche it should become (so categorize doesn't default
  // every bare title to "news"). now-playing → box-office; upcoming → trailer; person → profile; etc.
  const released = (date) => date && date <= today;
  const hintFor = (kind, date) => {
    if (kind === "trending-person") return "profile (this person's notable movies & career)";
    if (kind === "now-playing") return "box-office (in theaters now) or review";
    if (kind === "upcoming") return "trailer (not yet released) or a 'what we know' preview — NOT a review";
    if (kind === "trending-tv") return released(date) ? "review or rankings-list" : "news preview or trailer (unreleased)";
    if (kind === "trending-movie") return released(date) ? "review or box-office (already released)" : "trailer or 'what we know' preview (unreleased) — NOT a review/box-office";
    return "news";
  };
  const push = (items, kind, mediaType) => {
    for (const it of (items || []).slice(0, limitEach)) {
      const title = it.title || it.name;
      if (!title) continue;
      // English-Hollywood scope: keep only English-original titles (drops Bollywood/regional like
      // "Cocktail 2"); people carry no language and are filtered by the relevance LLM downstream.
      if (kind !== "trending-person" && it.original_language && it.original_language !== "en") continue;
      const date = it.release_date || it.first_air_date || "";
      out.push({
        source: "tmdb:" + kind,
        kind, // trending-movie | trending-tv | now-playing | upcoming | trending-person
        nicheHint: hintFor(kind, date),
        released: released(date),
        originalLanguage: it.original_language || null,
        mediaType: mediaType || it.media_type || (it.title ? "movie" : "tv"),
        tmdbId: it.id,
        title,
        year: (date || "").slice(0, 4),
        releaseDate: date,
        popularity: it.popularity || 0,
        voteAverage: it.vote_average || 0,
        voteCount: it.vote_count || 0,
        overview: it.overview || "",
        knownForDept: it.known_for_department || null, // people
      });
    }
  };
  const [tm, tt, np, up, tp] = await Promise.all([
    tget("/trending/movie/week"),
    tget("/trending/tv/week"),
    tget("/movie/now_playing?region=US"),
    tget("/movie/upcoming?region=US"),
    tget("/trending/person/week"),
  ]);
  push(tm?.results, "trending-movie", "movie");
  push(tt?.results, "trending-tv", "tv");
  push(np?.results, "now-playing", "movie");
  push(up?.results, "upcoming", "movie");
  push(tp?.results, "trending-person", "person");
  return out;
}
