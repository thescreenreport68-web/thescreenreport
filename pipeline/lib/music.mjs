// INTERIM non-Wikipedia MUSIC grounding via Deezer (keyless) — until PR6 wires MusicBrainz/Discogs/Last.fm.
// TMDB/OMDb carry NO music data, so music-profile/screen-music + the music-artist notability gate need this.
// Deezer gives artist POPULARITY (nb_fan) + CATALOG (top tracks, albums + dates) keylessly. It does NOT give
// chart positions / certifications / awards — for those the writer stays qualitative until PR6. NON-Wikimedia.
const DEEZER = "https://api.deezer.com";
const clean = (s) => (typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();

async function dz(path) {
  try {
    const r = await fetch(DEEZER + path, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    return j && !j.error ? j : null;
  } catch { return null; }
}

// Resolve an artist + pull a catalog snapshot. Returns null if no clear match.
export async function deezerArtist(name) {
  if (!name) return null;
  const s = await dz(`/search/artist?q=${encodeURIComponent(name)}&limit=1`);
  const a = (s?.data || [])[0];
  if (!a?.id) return null;
  const [top, albums] = await Promise.all([dz(`/artist/${a.id}/top?limit=8`), dz(`/artist/${a.id}/albums?limit=10`)]);
  // de-dupe albums by title, keep release-date order (newest first)
  const seen = new Set();
  const discography = (albums?.data || [])
    .filter((x) => x.record_type === "album" || !x.record_type)
    .map((x) => ({ title: clean(x.title), year: (x.release_date || "").slice(0, 4) }))
    .filter((x) => x.title && !seen.has(x.title.toLowerCase()) && seen.add(x.title.toLowerCase()))
    .sort((p, q) => (q.year || "").localeCompare(p.year || ""))
    .slice(0, 8);
  return {
    id: a.id, name: clean(a.name), nbFan: a.nb_fan || 0, nbAlbum: a.nb_album || 0,
    topTracks: (top?.data || []).map((t) => clean(t.title)).filter(Boolean).slice(0, 6),
    discography,
  };
}

// Notability magnitude for the FIND gate (0 if not found). Deezer fan count cleanly separates real artists
// (Taylor Swift ~12.6M, MJ Lenderman ~3.5K) from nonsense (0).
export async function deezerExists(name) {
  const d = await deezerArtist(name);
  return d ? d.nbFan : 0;
}

// Grounding block the writer uses for a music-profile (catalog/popularity facts ONLY — never a chart/cert claim).
export function deezerBlock(d) {
  if (!d) return "";
  const L = [`${d.name} — MUSIC CATALOG FACTS (Deezer, verified — use ONLY these; Deezer gives catalog + popularity, NOT chart positions/certifications/awards, so never state a chart peak or certification from here — stay qualitative on those until a charted source is provided):`];
  if (d.nbFan) L.push(`Deezer followers: ${d.nbFan.toLocaleString("en-US")} (a popularity signal, not a chart stat)`);
  if (d.discography.length) L.push(`Discography (album — year): ${d.discography.map((a) => `${a.title}${a.year ? ` (${a.year})` : ""}`).join("; ")}`);
  if (d.topTracks.length) L.push(`Most-played tracks (Deezer): ${d.topTracks.join(", ")}`);
  return L.join("\n");
}
