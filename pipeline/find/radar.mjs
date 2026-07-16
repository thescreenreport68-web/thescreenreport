// EVENT RADAR (owner 2026-07-16, NEWS_REALTIME_SCALE_PLAN §3) — the autonomous "what should an editor be watching
// right now" list. NO manual pinning, ever: releasing films, airing/returning shows, trending titles and sudden
// public-attention spikes are discovered from live data. Output = data/find/radar.json:
//   { builtAt, hotEntities: [names…], windows: { "<name lower>": { kind, weight, until } } }
// Consumers: findrun (priority boost + tier), the sentinel worker (reads the committed file via
// raw.githubusercontent and treats hot entities as urgent keywords within minutes).
// All sources FREE + live-verified 2026-07-16: TMDB (now_playing/upcoming/trending/on_the_air/next_episode_to_air —
// it already knew House of the Dragon's next episode airs 07-19), TVMaze keyless schedules, Google Trends RSS,
// and the trades' own news sitemaps (per-second timestamps → cross-outlet heat).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RADAR = path.resolve(__dirname, "../../data/find/radar.json");
const TMDB = "https://api.themoviedb.org/3";
const H = () => ({ Authorization: `Bearer ${process.env.TMDB_READ_TOKEN}`, Accept: "application/json", "User-Agent": "TSR-radar/1.0" });
const j = async (url, headers = H(), ms = 10000) => {
  try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; }
};
const txt = async (url, ms = 10000) => {
  try { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TSR-radar)" }, signal: AbortSignal.timeout(ms) }); return r.ok ? await r.text() : ""; } catch { return ""; }
};
const day = 24 * 3600e3;
const iso = (t) => new Date(t).toISOString();

export async function buildRadar({ now = Date.now() } = {}) {
  const windows = {}; // name(lower) → { kind, weight, until }
  // Name guards (live-test 2026-07-16: TVMaze surfaced NBC's "Today" — a generic word that would match every
  // headline): reject short single generic words + daytime/news staples; an entity must be ≥6 chars or multi-word.
  const NAME_BLOCK = new Set(["today", "tonight", "the view", "the talk", "live", "news", "dateline", "gma", "good morning america", "60 minutes", "the tonight show"]);
  const add = (name, kind, weight, until) => {
    const k = String(name || "").toLowerCase().trim();
    if (k.length < 3 || NAME_BLOCK.has(k) || (k.length < 6 && !k.includes(" "))) return;
    if (!windows[k] || windows[k].weight < weight) windows[k] = { kind, weight, until: iso(until), name };
  };

  // ── movies: releasing/now-playing/trending (the Odyssey case — tops these automatically) ──
  const [nowPlaying, upcoming, trMovie, trTv, onAir] = await Promise.all([
    j(`${TMDB}/movie/now_playing?region=US&page=1`), j(`${TMDB}/movie/upcoming?region=US&page=1`),
    j(`${TMDB}/trending/movie/day`), j(`${TMDB}/trending/tv/day`), j(`${TMDB}/tv/on_the_air?page=1`),
  ]);
  for (const m of (nowPlaying?.results || []).slice(0, 12)) add(m.title, "movie-in-theaters", 14 + Math.min(6, m.popularity / 100), now + 7 * day);
  for (const m of (upcoming?.results || []).slice(0, 15)) {
    const rel = Date.parse(m.release_date || "");
    if (Number.isFinite(rel) && rel - now < 14 * day) add(m.title, "movie-releasing", rel - now < 7 * day ? 18 : 12, rel + 7 * day);
  }
  // trending adds: English-language only (SCOPE_JUNK drops anime/regional candidates anyway, but the radar must
  // not hand the sentinel an off-scope urgency keyword)
  for (const m of (trMovie?.results || []).filter((x) => x.original_language === "en").slice(0, 10)) add(m.title, "movie-trending", 10, now + 2 * day);
  for (const t of (trTv?.results || []).filter((x) => x.original_language === "en").slice(0, 10)) add(t.name, "tv-trending", 10, now + 2 * day);

  // ── TV episodes: airing now/soon (the House-of-the-Dragon case) — next_episode_to_air on the top shows ──
  const topShows = (onAir?.results || []).slice(0, 10);
  const eps = await Promise.all(topShows.map((s) => j(`${TMDB}/tv/${s.id}`)));
  for (const s of eps.filter(Boolean)) {
    const next = Date.parse(s.next_episode_to_air?.air_date || ""), last = Date.parse(s.last_episode_to_air?.air_date || "");
    if (Number.isFinite(next) && next - now < 4 * day) add(s.name, "tv-episode-soon", 16, next + 2 * day);
    else if (Number.isFinite(last) && now - last < 2 * day) add(s.name, "tv-episode-aired", 14, last + 2 * day);
  }
  // TVMaze (keyless): today's US linear + streaming episodes — catches shows TMDB's page-1 misses.
  const today = new Date(now).toISOString().slice(0, 10);
  const [tvmUS, tvmWeb] = await Promise.all([
    j(`https://api.tvmaze.com/schedule?country=US&date=${today}`, { "User-Agent": "TSR-radar/1.0" }),
    j(`https://api.tvmaze.com/schedule/web?date=${today}`, { "User-Agent": "TSR-radar/1.0" }),
  ]);
  for (const e of [...(tvmUS || []), ...(tvmWeb || [])]) {
    const show = e?.show || e?._embedded?.show;
    // Scripted/animation only — talk shows and news programs ("Today", late-night) are not coverage targets.
    if (show?.weight >= 90 && ["Scripted", "Animation"].includes(show.type) && show.language === "English")
      add(show.name, "tv-episode-today", 12, now + 2 * day); // weight = TVMaze popularity 0-100
  }

  // ── sudden public attention: Google Trends RSS, kept only when it matches a known entity ──
  const gt = await txt("https://trends.google.com/trending/rss?geo=US");
  const trendTitles = [...gt.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1].toLowerCase()).slice(1, 25);
  for (const k of Object.keys(windows)) if (trendTitles.some((t) => t.includes(k))) windows[k].weight += 6;

  // ── cross-outlet heat: the trades' news sitemaps (per-second timestamps, trailing 48h) ──
  const maps = await Promise.all([
    txt("https://variety.com/news-sitemap.xml"), txt("https://www.hollywoodreporter.com/news-sitemap.xml"), txt("https://screenrant.com/post_google_news.xml"),
  ]);
  const titles24 = [];
  for (const xml of maps) for (const m of xml.matchAll(/<news:title>([^<]+)<\/news:title>[\s\S]{0,400}?<news:publication_date>([^<]+)</g)) {
    const t = Date.parse(m[2]); if (Number.isFinite(t) && now - t < day) titles24.push(m[1].toLowerCase());
  }
  // also tolerate reversed element order in the sitemap
  for (const xml of maps) for (const m of xml.matchAll(/<news:publication_date>([^<]+)<[\s\S]{0,400}?<news:title>([^<]+)</g)) {
    const t = Date.parse(m[1]); if (Number.isFinite(t) && now - t < day) titles24.push(m[2].toLowerCase());
  }
  for (const k of Object.keys(windows)) {
    const hits = titles24.filter((t) => t.includes(k)).length;
    if (hits >= 3) windows[k].weight += Math.min(10, hits * 2); // the industry is surging on this entity
  }

  const hotEntities = Object.values(windows).sort((a, b) => b.weight - a.weight).slice(0, 40).map((w) => w.name);
  const radar = { builtAt: iso(now), hotEntities, windows };
  fs.mkdirSync(path.dirname(RADAR), { recursive: true });
  fs.writeFileSync(RADAR, JSON.stringify(radar, null, 2));
  return radar;
}

// Read the current radar (never throws); stale/missing → null so callers can rebuild or skip boosts.
export function loadRadar({ maxAgeHours = 6 } = {}) {
  try {
    const r = JSON.parse(fs.readFileSync(RADAR, "utf8"));
    if (Date.now() - Date.parse(r.builtAt) < maxAgeHours * 3600e3) return r;
  } catch {}
  return null;
}

// Priority boost + tier for one topic against the radar. Deterministic; returns { boost, kind } or null.
export function radarBoost(topic, radar) {
  if (!radar?.windows) return null;
  const hay = `${topic?.title || ""} ${topic?.primaryEntity || ""} ${(topic?.entities || []).join(" ")}`.toLowerCase();
  let best = null;
  for (const [k, w] of Object.entries(radar.windows)) {
    if (Date.parse(w.until) < Date.now()) continue;
    // word-boundary match (never substring — "today" must not match "today's premiere" for a different entity)
    const re = new RegExp("(^|[^a-z0-9])" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)");
    if (k.length > 3 && re.test(hay) && (!best || w.weight > best.weight)) best = w;
  }
  return best ? { boost: Math.round(best.weight), kind: best.kind } : null;
}
