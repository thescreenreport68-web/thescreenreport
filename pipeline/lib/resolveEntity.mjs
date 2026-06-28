// NON-Wikipedia entity resolution + notability gate (replaces the wikiSummary page-exists check in FIND
// categorize/coverage). STRICTLY BETTER than "has a Wikipedia page": it confirms identity AND adds a
// notability MAGNITUDE (TMDB vote_count/popularity, Deezer fan count) the binary page-exists never had — and
// it tracks unreleased/fresh films Wikipedia hadn't yet covered. Returns the same {summary:{title}, viaPrimary}
// shape categorize expects, so the caller (which canonicalizes the entity name) is unchanged. NON-Wikimedia.
import { searchTitle, searchPersonNotable } from "./tmdb.mjs";
import { deezerArtist } from "./music.mjs";

const FILM_NICHES = new Set(["review", "box-office", "explainer", "trailer"]);
const PERSON_NICHES = new Set(["profile", "interview"]);
// Notability floors (tested): a released film clears vote_count; an unreleased/fresh one clears popularity.
const TITLE_OK = (r) => r && ((r.vote_count || 0) >= 50 || (r.popularity || 0) >= 8);
const titleNote = (r) => Math.max(r.vote_count || 0, r.popularity || 0);

export async function resolveEntity(t) {
  const cat = (t.category || "").toLowerCase();
  const ft = (t.formatTag || "").toLowerCase();
  const bare = (t.primaryEntity || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  const yr = ((t.title || "").match(/\b(19|20)\d{2}\b/) || [])[0] || null;
  if (!bare) return null;

  // MUSIC artist (not a screen-work niche) → Deezer fan count.
  if (cat === "music" && !FILM_NICHES.has(ft)) {
    const d = await deezerArtist(bare);
    if (d && d.nbFan >= 1000) return { summary: { title: d.name }, viaPrimary: true, type: "music-artist", notability: d.nbFan };
    // a music story may still be about a screen work (screen-music) → fall through to title.
  }

  // PERSON niches → TMDB person with a popularity + known-for floor (nonsense returns 0 results = clean drop).
  if (PERSON_NICHES.has(ft) || cat === "celebrity" || t.tmdbType === "person") {
    const p = await searchPersonNotable(bare);
    if (p && p.popularity >= 0.6 && p.knownFor >= 1) return { summary: { title: p.name }, viaPrimary: true, type: "person", notability: p.popularity, tmdbId: p.id };
    // not a notable person — fall through (the LLM may have mis-typed a title as a person).
  }

  // TITLE (default; FILM_NICHES are strict — a TMDB movie/tv hit IS the screen-work confirmation).
  for (const q of [...new Set([bare, yr ? `${bare} ${yr}` : null].filter(Boolean))]) {
    const r = (await searchTitle(q, t.tmdbType === "tv" ? "tv" : "movie", yr)) || (await searchTitle(q, "tv", yr));
    if (TITLE_OK(r)) return { summary: { title: r.title || r.name }, viaPrimary: true, type: "title", notability: titleNote(r), tmdbId: r.id };
  }

  // NON-strict fallback: a supporting entity (a famous co-star/franchise) keeps fresh news alive for grounding
  // — but the caller does NOT retarget onto it (viaPrimary:false), matching the old behaviour.
  if (!FILM_NICHES.has(ft)) {
    for (const v of [...new Set((t.entities || []).filter(Boolean))]) {
      const r = (await searchTitle(v, "movie")) || (await searchTitle(v, "tv"));
      if (r && ((r.vote_count || 0) >= 30 || (r.popularity || 0) >= 5)) return { summary: { title: r.title || r.name }, viaPrimary: false, type: "title", notability: titleNote(r) };
      const p = await searchPersonNotable(v);
      if (p && p.popularity >= 1 && p.knownFor >= 1) return { summary: { title: p.name }, viaPrimary: false, type: "person", notability: p.popularity };
    }
  }
  return null;
}
