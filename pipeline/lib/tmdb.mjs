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

// Normalize a title for exact-match comparison: lowercase, strip punctuation/accents, collapse spaces.
const normTitle = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Rank TMDB search results so an EXACT-title, popular, year-matching hit wins — never a substring match.
// (Closes the "Atlas" → "Cloud Atlas" collision: TMDB's results[0] was a substring match for a different,
// older film. We prefer exact title, then year-hint match, then popularity, with recency as a tiebreak.)
function pickBest(results, q, year) {
  const nq = normTitle(q);
  let best = null, bestScore = -Infinity;
  for (const r of results || []) {
    const titles = [r.title, r.original_title, r.name, r.original_name].filter(Boolean).map(normTitle);
    const ry = (r.release_date || r.first_air_date || "").slice(0, 4);
    let s = 0;
    if (titles.includes(nq)) s += 1000;                                   // exact title — decisive
    else if (titles.some((t) => t.startsWith(nq) || nq.startsWith(t))) s += 60; // partial, weak
    else s -= 200;                                                        // unrelated substring match (e.g. "Cloud Atlas")
    if (year && ry === year) s += 500;                                    // year hint nails the right edition
    s += Math.min(Number(r.popularity) || 0, 200);                       // current relevance/trending
    if (ry) s += Number(ry) / 100000;                                    // tiny recency tiebreak among equals
    if (s > bestScore) { bestScore = s; best = r; }
  }
  return best;
}

export async function searchTitle(name, type, yearHint = null) {
  // Use the year (from "(2021 film)", anywhere in the name, or an explicit hint) to disambiguate; strip
  // suffixes from the query text, then rank results so an exact-title popular match wins (not results[0]).
  const ym = name.match(/\b(19|20)\d{2}\b/);
  const year = yearHint || (ym ? ym[0] : null);
  const q = name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\b(19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim();
  // Search WITHOUT the year filter so we always see all editions, then rank (year is a strong signal, not a hard filter).
  const j = await tmdb(`/search/${type}?query=${encodeURIComponent(q)}&include_adult=false`);
  return pickBest(j?.results, q, year) || null;
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

// The official YouTube trailer + verified film context for the TRAILER niche.
// We embed the trailer (never re-host) and ground the preview ONLY on the synopsis/cast/release here.
export async function getTrailer(name, type = "movie") {
  let res = await searchTitle(name, type);
  let kind = type;
  if (!res) { const alt = type === "movie" ? "tv" : "movie"; res = await searchTitle(name, alt); kind = alt; }
  if (!res) return null;
  const [vid, det, cred, rel] = await Promise.all([
    tmdb(`/${kind}/${res.id}/videos`),
    tmdb(`/${kind}/${res.id}`),
    tmdb(`/${kind}/${res.id}/credits`),
    kind === "movie" ? tmdb(`/movie/${res.id}/release_dates`) : Promise.resolve(null),
  ]);
  // Exclude accessibility/localized/promo variants — we want the main trailer a reader expects.
  const EXCLUDE = /sign language|\basl\b|audio describ|described|foreign|subtitle|dubbed|in concert|featurette|clip|behind the scenes|bloopers|interview|spot/i;
  const vids = (vid?.results || [])
    .filter((v) => v.site === "YouTube" && v.key && !EXCLUDE.test(v.name || ""))
    .sort((a, b) => (b.official === a.official ? 0 : b.official ? 1 : -1));
  const trailer =
    vids.find((v) => v.official && /official trailer/i.test(v.name || "")) ||
    vids.find((v) => /official trailer/i.test(v.name || "")) ||
    vids.find((v) => v.official && /trailer/i.test(v.type)) ||
    vids.find((v) => /trailer/i.test(v.type)) ||
    vids.find((v) => v.official && /teaser/i.test(v.type)) ||
    vids.find((v) => /teaser/i.test(v.type)) ||
    vids.find((v) => v.official) ||
    vids[0];
  if (!trailer) return null;
  const director =
    (cred?.crew || []).find((c) => c.job === "Director")?.name ||
    (cred?.crew || []).find((c) => c.department === "Directing")?.name || "";
  const cast = (cred?.cast || []).slice(0, 6).map((c) => c.name);
  // Prefer the canonical US THEATRICAL date (type 3) — TMDB's top-level release_date is often a premiere/intl date.
  let releaseDate = det?.release_date || det?.first_air_date || res.release_date || res.first_air_date || "";
  const us = (rel?.results || []).find((r) => r.iso_3166_1 === "US");
  if (us?.release_dates?.length) {
    const byType = (t) => us.release_dates.find((d) => d.type === t)?.release_date;
    const usDate = byType(3) || byType(2) || byType(1) || us.release_dates[0]?.release_date;
    if (usDate) releaseDate = usDate.slice(0, 10);
  }
  return {
    youtubeId: trailer.key,
    videoName: trailer.name || "Official Trailer",
    title: det?.title || det?.name || res.title || res.name,
    year: (releaseDate || "").slice(0, 4),
    releaseDate,
    overview: det?.overview || res.overview || "",
    genres: (det?.genres || []).map((g) => g.name),
    runtime: det?.runtime || (det?.episode_run_time || [])[0] || null,
    director,
    cast,
    type: kind,
  };
}

// Plain-text grounding block for the trailer writer (synopsis/cast/release — NOT shot descriptions).
export function trailerFactBlock(t) {
  const lines = [`Title: ${t.title}${t.year ? ` (${t.year})` : ""}`];
  if (t.director) lines.push(`Director: ${t.director}`);
  if (t.cast?.length) lines.push(`Main cast: ${t.cast.join(", ")}`);
  if (t.genres?.length) lines.push(`Genre: ${t.genres.join(", ")}`);
  if (t.releaseDate) lines.push(`Release date: ${t.releaseDate}`);
  if (t.overview) lines.push(`Official synopsis: ${t.overview}`);
  lines.push(`Trailer title: "${t.videoName}". IMPORTANT: you have NOT watched the trailer — never describe specific shots, edits, dialogue or a runtime; write the preview only from the synopsis, cast and release above.`);
  return lines.join("\n");
}

// Box-office niche: verified worldwide gross + budget from TMDB (the model must never invent figures).
function fmtUSD(n) {
  if (!n || n <= 0) return null;
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(n >= 1e10 ? 1 : 2) + " billion";
  if (n >= 1e6) return "$" + Math.round(n / 1e6) + " million";
  return "$" + n.toLocaleString("en-US");
}
export async function getBoxOffice(name, type = "movie") {
  const res = await searchTitle(name, "movie");
  if (!res) return null;
  const [det, rel] = await Promise.all([tmdb(`/movie/${res.id}`), tmdb(`/movie/${res.id}/release_dates`)]);
  if (!det) return null;
  let releaseDate = det.release_date || "";
  const us = (rel?.results || []).find((r) => r.iso_3166_1 === "US");
  if (us?.release_dates?.length) {
    const byType = (t) => us.release_dates.find((d) => d.type === t)?.release_date;
    const usDate = byType(3) || byType(2) || byType(1) || us.release_dates[0]?.release_date;
    if (usDate) releaseDate = usDate.slice(0, 10);
  }
  return {
    title: det.title,
    year: (releaseDate || det.release_date || "").slice(0, 4),
    worldwideRaw: det.revenue || 0,
    budgetRaw: det.budget || 0,
    worldwide: fmtUSD(det.revenue),
    budget: fmtUSD(det.budget),
    releaseDate,
  };
}
export function boxOfficeFactBlock(b) {
  const lines = [`Title: ${b.title} (${b.year})`];
  if (b.budget) lines.push(`Production budget: ${b.budget} (before marketing)`);
  if (b.worldwide) lines.push(`Worldwide gross: ${b.worldwide} (TMDB, verified — use this EXACT figure as the worldwide total)`);
  if (b.releaseDate) lines.push(`US release date: ${b.releaseDate}`);
  lines.push("RULE: use ONLY box-office figures that appear in these facts or the Wikipedia box-office section. NEVER invent a number, an opening-weekend figure, a domestic/international split, or a record. When comparing across different eras, note figures are 'not adjusted for inflation'.");
  return lines.join("\n");
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

// ── PEOPLE (profiles) — the authoritative, dated, role-by-role filmography so the writer NEVER invents
// a credit/year/role. TMDB person endpoints are free + structured (the gap that caused profile fabrication).
export async function searchPerson(name) {
  const j = await tmdb(`/search/person?query=${encodeURIComponent(name)}&include_adult=false`);
  const p = (j?.results || []).filter((x) => x.known_for_department === "Acting" || x.known_for_department === "Directing")[0] || j?.results?.[0];
  return p ? { id: p.id, name: p.name } : null;
}

// Returns a clean, deduped, release-ordered list of MAJOR credits {year, title, character, type}.
export async function getPersonCredits(id, max = 18) {
  const [j, ext] = await Promise.all([tmdb(`/person/${id}/combined_credits`), tmdb(`/person/${id}/external_ids`)]);
  const cast = (j?.cast || [])
    .filter((c) => (c.title || c.name) && (c.release_date || c.first_air_date))
    .filter((c) => (c.vote_count || 0) >= 20 || (c.popularity || 0) >= 5) // drop obscure/uncredited noise
    .map((c) => ({
      title: c.title || c.name,
      year: (c.release_date || c.first_air_date || "").slice(0, 4),
      character: (c.character || "").replace(/\s*\(.*?\)\s*/g, "").trim(),
      type: c.media_type === "tv" ? "TV" : "Film",
      pop: c.popularity || 0,
    }));
  // dedup by title+year, keep the most popular, then sort newest-first
  const seen = new Map();
  for (const c of cast) { const k = `${c.title}|${c.year}`; if (!seen.has(k) || seen.get(k).pop < c.pop) seen.set(k, c); }
  const credits = [...seen.values()].sort((a, b) => (b.year || "").localeCompare(a.year || "")).slice(0, max);
  return { credits, wikidata: ext?.wikidata_id || null, imdb: ext?.imdb_id || null };
}

export function personFactBlock(name, credits) {
  if (!credits?.length) return "";
  const rows = credits.map((c) => `${c.year || "—"} — ${c.title} (${c.type})${c.character ? ` as ${c.character}` : ""}`);
  return `${name} — VERIFIED FILMOGRAPHY (TMDB, structured; use ONLY these credits/years/roles — do NOT add any film/role/year not in this list):\n${rows.join("\n")}`;
}

// ── AUTHORITATIVE TITLE FACTS (the Wikipedia-free structured spine, 2026-06-28). One combined call gives
// the imdb_id (to chain to OMDb), credits, typed US release dates (theatrical type-3 vs digital type-4),
// current watch-providers, and revenue/budget — so the writer grounds on structured truth and the judge
// can DIFF the article's platform/cast/dates/box-office against it. Also detects straight-to-streaming (OTT).
export async function getTitleFacts(name, type = "movie", yearHint = null) {
  let res = await searchTitle(name, type, yearHint);
  let kind = type;
  if (!res) { const alt = type === "movie" ? "tv" : "movie"; res = await searchTitle(name, alt, yearHint); kind = alt; }
  if (!res) return null;
  const append = kind === "movie" ? "credits,release_dates,external_ids,watch/providers,keywords" : "credits,external_ids,watch/providers,content_ratings,keywords";
  const det = await tmdb(`/${kind}/${res.id}?append_to_response=${encodeURIComponent(append)}`);
  if (!det) return null;
  const cred = det.credits || {};
  const director =
    (cred.crew || []).find((c) => c.job === "Director")?.name ||
    (kind === "tv" ? (det.created_by || []).map((c) => c.name).filter(Boolean).join(", ") : "") ||
    (cred.crew || []).find((c) => c.department === "Directing")?.name || "";
  const cast = (cred.cast || []).slice(0, 10).map((c) => ({ name: c.name, character: (c.character || "").replace(/\s*\(.*?\)\s*/g, "").trim() }));
  let theatrical = null, digital = null, premiere = null;
  if (kind === "movie") {
    const us = (det.release_dates?.results || []).find((r) => r.iso_3166_1 === "US");
    if (us) { const byType = (t) => us.release_dates.find((d) => d.type === t)?.release_date?.slice(0, 10); theatrical = byType(3); digital = byType(4); premiere = byType(1); }
  }
  const wp = det["watch/providers"]?.results?.US;
  const providers = wp ? { stream: clean(wp.flatrate), rent: clean(wp.rent), buy: clean(wp.buy) } : { stream: [], rent: [], buy: [] };
  // Straight-to-streaming (movie): no theatrical date but available on a flatrate provider (or has a digital date).
  const isOTT = kind === "movie" && !theatrical && (providers.stream.length > 0 || !!digital);
  // Thematic keywords (TMDB) — the non-Wikipedia depth layer for explainers/trailers/reviews.
  const keywords = ((det.keywords?.keywords || det.keywords?.results || []).map((k) => k.name)).slice(0, 16);
  return {
    keywords,
    id: res.id, type: kind, imdbId: det.external_ids?.imdb_id || null,
    title: det.title || det.name, year: (det.release_date || det.first_air_date || "").slice(0, 4),
    director, cast, genres: (det.genres || []).map((g) => g.name), runtime: det.runtime || (det.episode_run_time || [])[0] || null,
    theatrical, digital, premiere, firstAir: det.first_air_date || null,
    providers, revenueRaw: det.revenue || 0, budgetRaw: det.budget || 0, isOTT, status: det.status || "", overview: det.overview || "",
  };
}

// The AUTHORITATIVE structured grounding block (the writer cites these verbatim; the judge diffs against them).
export function titleFactBlock(t) {
  if (!t) return "";
  const L = [`${t.title}${t.year ? ` (${t.year})` : ""} — AUTHORITATIVE FACTS (TMDB, structured & verified — cite ONLY these; do NOT add a fact not listed here):`];
  if (t.director) L.push(`Director/creator: ${t.director}`);
  if (t.cast.length) L.push(`Cast: ${t.cast.map((c) => c.character ? `${c.name} as ${c.character}` : c.name).join(", ")}`);
  if (t.genres.length) L.push(`Genre: ${t.genres.join(", ")}`);
  if (t.runtime) L.push(`Runtime: ${t.runtime} min`);
  if (t.theatrical) L.push(`US theatrical release: ${t.theatrical}`);
  if (t.digital) L.push(`US digital/streaming release: ${t.digital}`);
  if (t.firstAir) L.push(`First aired: ${t.firstAir}`);
  const onStream = t.providers.stream.length ? t.providers.stream.join(", ") : null;
  if (onStream) L.push(`CURRENTLY STREAMING (US, TMDB/JustWatch — this is the ONLY correct platform; do NOT name a different one): ${onStream}`);
  else if (t.providers.rent.length) L.push(`Available to rent/buy (US): ${t.providers.rent.slice(0, 4).join(", ")}`);
  if (t.isOTT) L.push(`RELEASE TYPE: STREAMING-ORIGINAL (no theatrical run) — this film has NO box office; do NOT write a box-office number, opening weekend, or theatrical gross.`);
  else if (t.theatrical) L.push(`RELEASE TYPE: theatrical.`);
  if (t.revenueRaw > 0 && !t.isOTT) L.push(`Worldwide box office (TMDB): ${fmtUSD(t.revenueRaw)}`);
  if (t.budgetRaw > 0) L.push(`Budget: ${fmtUSD(t.budgetRaw)}`);
  if (t.overview) L.push(`Premise (TMDB logline — the verified plot summary; expand on it but never contradict it): ${t.overview}`);
  if (t.keywords?.length) L.push(`Themes/keywords (TMDB — factual thematic tags, use for analysis only, not as plot events): ${t.keywords.join(", ")}`);
  return L.join("\n");
}

// ── PERSON FACTS (the Wikipedia-bio replacement, 2026-06-28) — TMDB /person gives a real paragraph bio +
// birth/death + known-for + a dated filmography, so a profile/interview/celebrity-news piece grounds on
// structured truth instead of Wikipedia prose. No Wikimedia.
export async function getPersonFacts(name) {
  const p = await searchPerson(name);
  if (!p) return null;
  const [det, cr] = await Promise.all([
    tmdb(`/person/${p.id}?append_to_response=external_ids`),
    getPersonCredits(p.id),
  ]);
  if (!det) return null;
  const strip = (s) => (s || "").replace(/\s+/g, " ").trim();
  return {
    id: p.id, name: det.name || p.name, imdbId: det.external_ids?.imdb_id || cr?.imdb || null,
    bio: strip(det.biography || ""), born: det.birthday || null, died: det.deathday || null,
    birthplace: strip(det.place_of_birth || ""), knownFor: det.known_for_department || "",
    alsoKnownAs: (det.also_known_as || []).slice(0, 3),
    credits: cr?.credits || [],
  };
}

// Deathday-only lookup for the hoax/death recheck (an authoritative, time-unbounded death confirm).
export async function personDeathday(name) {
  const p = await searchPerson(name);
  if (!p) return null;
  const det = await tmdb(`/person/${p.id}`);
  return det?.deathday || null;
}

export function personFactsBlock(p) {
  if (!p) return "";
  const L = [`${p.name} — AUTHORITATIVE PERSON FACTS (TMDB, verified — cite ONLY these; never invent a birth date, role, or credit):`];
  if (p.born) L.push(`Born: ${p.born}${p.birthplace ? `, ${p.birthplace}` : ""}`);
  if (p.died) L.push(`Died: ${p.died}`);
  if (p.knownFor) L.push(`Known for: ${p.knownFor}`);
  if (p.bio) L.push(`Biography (TMDB): ${p.bio.slice(0, 1200)}`);
  if (p.credits?.length) L.push(personFactBlock(p.name, p.credits));
  return L.join("\n");
}
