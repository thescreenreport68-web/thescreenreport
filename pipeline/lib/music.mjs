// INTERIM non-Wikipedia MUSIC grounding via Deezer (keyless) — until PR6 wires MusicBrainz/Discogs/Last.fm.
// TMDB/OMDb carry NO music data, so music-profile/screen-music + the music-artist notability gate need this.
// Deezer gives artist POPULARITY (nb_fan) + CATALOG (top tracks, albums + dates) keylessly. It does NOT give
// chart positions / certifications / awards — for those the writer stays qualitative until PR6. NON-Wikimedia.
const DEEZER = "https://api.deezer.com";
const clean = (s) => (typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();
const norm = (s) => clean(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "");
const UA = "TheScreenReport/1.0 (editor@thescreenreport.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// PR6 — FULL music grounding (NON-Wikimedia): MusicBrainz discography + Last.fm popularity/tags + Discogs
// catalog/labels + Billboard Hot 100 (current chart incl. peak_position). Upgrades the Deezer interim.
// Keys read from env: LASTFM_API_KEY, DISCOGS_CONSUMER_KEY/SECRET. MusicBrainz/Billboard are keyless (UA only).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════

// MusicBrainz — the authoritative open-music-encyclopedia discography. Rate limit 1 req/s (UA mandatory).
let _mbLast = 0;
async function mb(path) {
  const wait = 1100 - (Date.now() - _mbLast); if (wait > 0) await sleep(wait); _mbLast = Date.now();
  try { const r = await fetch(`https://musicbrainz.org/ws/2/${path}`, { headers: { "User-Agent": UA, accept: "application/json" } }); return r.ok ? await r.json() : null; } catch { return null; }
}
export async function musicbrainzArtist(name) {
  if (!name) return null;
  const s = await mb(`artist?query=artist:${encodeURIComponent(`"${name}"`)}&fmt=json&limit=1`);
  const a = (s?.artists || [])[0];
  if (!a?.id) return null;
  const det = await mb(`artist/${a.id}?inc=release-groups&fmt=json`);
  const albums = (det?.["release-groups"] || [])
    .filter((g) => g["primary-type"] === "Album" && !(g["secondary-types"] || []).length) // studio albums only
    .map((g) => ({ title: clean(g.title), year: (g["first-release-date"] || "").slice(0, 4) }))
    .filter((x) => x.title)
    .sort((p, q) => (q.year || "").localeCompare(p.year || ""))
    .slice(0, 10);
  return { mbid: a.id, name: clean(a.name), type: a.type || "", country: a.country || "", beginYear: (a["life-span"]?.begin || "").slice(0, 4), albums };
}

// Last.fm — listeners + total scrobbles + top tags (popularity magnitude, non-Wikimedia).
export async function lastfmArtist(name) {
  const key = process.env.LASTFM_API_KEY;
  if (!key || !name) return null;
  try {
    const r = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${key}&format=json`, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const a = (await r.json())?.artist;
    if (!a) return null;
    return { listeners: Number(a.stats?.listeners) || 0, playcount: Number(a.stats?.playcount) || 0, tags: (a.tags?.tag || []).map((t) => clean(t.name)).filter(Boolean).slice(0, 5) };
  } catch { return null; }
}

// Discogs — catalog cross-check (recent main releases + label). Read-only key/secret auth, mandatory UA.
export async function discogsArtist(name) {
  const k = process.env.DISCOGS_CONSUMER_KEY, sec = process.env.DISCOGS_CONSUMER_SECRET;
  if (!k || !sec || !name) return null;
  const auth = { "User-Agent": UA, accept: "application/json", Authorization: `Discogs key=${k}, secret=${sec}` };
  try {
    const sr = await fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(name)}&type=artist&per_page=1`, { headers: auth });
    const id = ((await sr.json())?.results || [])[0]?.id;
    if (!id) return null;
    const rr = await fetch(`https://api.discogs.com/artists/${id}/releases?sort=year&sort_order=desc&per_page=10`, { headers: auth });
    const releases = ((await rr.json())?.releases || [])
      .filter((x) => x.role === "Main" && x.type === "master")
      .map((x) => ({ title: clean(x.title), year: x.year || null, label: clean(x.label || "") }))
      .slice(0, 6);
    return { id, releases };
  } catch { return null; }
}

// Billboard Hot 100 — the CURRENT chart (GitHub mirror, cached per process). Entries carry this_week +
// peak_position + weeks_on_chart, so we can ground REAL chart facts for songs currently on the chart.
// Historical peaks for off-chart songs aren't free → the writer stays qualitative on those.
let _bb = null;
async function billboardHot100() {
  if (_bb) return _bb;
  try { const r = await fetch("https://raw.githubusercontent.com/mhollingshead/billboard-hot-100/main/recent.json", { headers: { "User-Agent": UA } }); _bb = r.ok ? await r.json() : { data: [] }; } catch { _bb = { data: [] }; }
  return _bb;
}
export async function billboardEntry(artist, song = null) {
  const c = await billboardHot100();
  const na = norm(artist);
  if (!na) return null;
  const hit = (c.data || []).find((e) => norm(e.artist).includes(na) && (!song || norm(e.song).includes(norm(song))));
  return hit ? { thisWeek: hit.this_week, peak: hit.peak_position, weeks: hit.weeks_on_chart, song: hit.song, artist: hit.artist, date: c.date } : null;
}

// Merge all sources into one authoritative music-artist fact set (used by groundFacts for music topics).
export async function musicArtistFacts(name) {
  if (!name) return null;
  const [mbA, lf, dz] = await Promise.all([musicbrainzArtist(name), lastfmArtist(name), deezerArtist(name)]);
  if (!mbA && !lf && !dz) return null;
  const [dc, bb] = await Promise.all([discogsArtist(name).catch(() => null), billboardEntry(name).catch(() => null)]);
  return { name: mbA?.name || dz?.name || name, mb: mbA, lf, discogs: dc, deezer: dz, billboard: bb };
}

// The full music-profile grounding block — every number is sourced; the writer stays qualitative on anything
// absent (and NEVER invents a chart peak or certification).
export function musicFactsBlock(f) {
  if (!f) return "";
  const L = [`${f.name} — AUTHORITATIVE MUSIC FACTS (MusicBrainz + Last.fm + Discogs + Billboard, verified — cite ONLY these; for any chart position, certification, or award NOT listed here, stay qualitative and NEVER invent one):`];
  if (f.mb) {
    if (f.mb.type || f.mb.country || f.mb.beginYear) L.push(`Artist (MusicBrainz): ${[f.mb.type, f.mb.country, f.mb.beginYear ? `since ${f.mb.beginYear}` : ""].filter(Boolean).join(", ")}`);
    if (f.mb.albums.length) L.push(`Studio discography (MusicBrainz — album — year): ${f.mb.albums.map((a) => `${a.title}${a.year ? ` (${a.year})` : ""}`).join("; ")}`);
  }
  if (f.lf) {
    if (f.lf.listeners || f.lf.playcount) L.push(`Last.fm: ${f.lf.listeners.toLocaleString("en-US")} listeners, ${f.lf.playcount.toLocaleString("en-US")} scrobbles (a popularity signal, NOT a chart/sales stat)`);
    if (f.lf.tags.length) L.push(`Genre tags (Last.fm, factual association — not a sound description): ${f.lf.tags.join(", ")}`);
  }
  if (f.discogs?.releases?.length) L.push(`Recent releases (Discogs — title, year, label): ${f.discogs.releases.map((r) => `${r.title}${r.year ? ` (${r.year}` : ""}${r.label ? `, ${r.label})` : r.year ? ")" : ""}`).join("; ")}`);
  if (f.billboard) L.push(`Billboard Hot 100 (current chart, ${f.billboard.date}): "${f.billboard.song}" is at #${f.billboard.thisWeek} (peak #${f.billboard.peak}, ${f.billboard.weeks} week(s) on chart) — this is the ONLY chart figure you may state; do not state any other chart position.`);
  else L.push(`Billboard: no current Hot 100 entry found for this artist — do NOT state a Hot 100 position; speak qualitatively about chart success.`);
  if (f.deezer?.topTracks?.length) L.push(`Most-played tracks (Deezer): ${f.deezer.topTracks.join(", ")}`);
  return L.join("\n");
}
