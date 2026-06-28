// OMDb — AUTHORITATIVE ratings (Rotten Tomatoes / Metacritic / IMDb) + box office, keyed by IMDb id.
// The Wikipedia-free replacement for "reception" prose (2026-06-28): Wikipedia gave stale/approx scores
// (the test wrote RT 90% when it was 86%). OMDb returns the EXACT current value in one structured call, so
// the writer grounds on it AND the judge verifies against it. Free tier = 1000 req/day; we CACHE per IMDb
// id so the writer's grounding and the judge's verification share a single fetch (well under the cap).
// Reads process.env.OMDB_API_KEY.

const CACHE = new Map(); // imdbId -> parsed object | null (per-process; writer+judge share it within a run)

// "85%" -> 85 ; "67/100" -> 67 ; "7.6/10" -> 7.6
const pctNum = (s) => { const m = (s || "").match(/([\d.]+)/); return m ? Number(m[1]) : null; };

export async function omdb(imdbId) {
  if (!imdbId || !/^tt\d+$/.test(imdbId)) return null;
  if (CACHE.has(imdbId)) return CACHE.get(imdbId);
  const key = process.env.OMDB_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}&tomatoes=true`);
    if (!r.ok) { CACHE.set(imdbId, null); return null; }
    const j = await r.json();
    if (j.Response === "False") { CACHE.set(imdbId, null); return null; }
    const ratings = {};
    for (const x of j.Ratings || []) {
      if (/rotten tomatoes/i.test(x.Source)) ratings.rt = { value: x.Value, num: pctNum(x.Value) };       // {value:"85%", num:85}
      else if (/metacritic/i.test(x.Source)) ratings.metacritic = { value: x.Value, num: pctNum(x.Value) }; // {value:"67/100", num:67}
      else if (/internet movie/i.test(x.Source)) ratings.imdb = { value: x.Value, num: pctNum(x.Value) };   // {value:"7.6/10", num:7.6}
    }
    const na = (v) => (v && v !== "N/A" ? v : null);
    const out = {
      imdbId, title: j.Title, year: j.Year, rated: na(j.Rated), released: na(j.Released), runtime: na(j.Runtime),
      genre: na(j.Genre), director: na(j.Director), writer: na(j.Writer), actors: na(j.Actors), plot: na(j.Plot),
      ratings, boxOffice: na(j.BoxOffice), awards: na(j.Awards), type: j.Type, totalSeasons: na(j.totalSeasons),
      metascore: pctNum(na(j.Metascore)), imdbRating: pctNum(na(j.imdbRating)),
    };
    CACHE.set(imdbId, out);
    return out;
  } catch {
    CACHE.set(imdbId, null);
    return null;
  }
}

// Grounding block for the writer — the EXACT scores/box-office it may cite (with attribution), nothing else.
export function omdbFactBlock(o) {
  if (!o) return "";
  const lines = [`${o.title}${o.year ? ` (${o.year})` : ""} — AUTHORITATIVE RATINGS & BOX OFFICE (OMDb/IMDb, verified — cite these EXACT values WITH attribution, e.g. "according to Rotten Tomatoes"; if a score is absent below, do NOT state one):`];
  if (o.ratings.rt) lines.push(`Rotten Tomatoes (critics): ${o.ratings.rt.value}`);
  if (o.ratings.metacritic) lines.push(`Metacritic: ${o.ratings.metacritic.value}`);
  if (o.ratings.imdb) lines.push(`IMDb: ${o.ratings.imdb.value}`);
  if (o.boxOffice) lines.push(`US domestic box office: ${o.boxOffice}`);
  if (o.rated) lines.push(`Rated: ${o.rated}`);
  if (o.runtime) lines.push(`Runtime: ${o.runtime}`);
  if (o.awards) lines.push(`Awards summary (OMDb): ${o.awards}`);
  return lines.length > 1 ? lines.join("\n") : "";
}
