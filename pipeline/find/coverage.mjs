// COVERAGE MODE — guarantee ONE grounded topic for EVERY subcategory in the taxonomy.
// Normal discovery finds what's BREAKING, so it leaves whole subcategories empty (streaming, awards,
// where-to-watch, reactions). This deliberately fills every (category/subcategory) slot: organic
// discovery first, then an AUTOMATED evergreen-fill backstop (live TMDB + grounded seeds) for any gap.
// Run: cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; node site/pipeline/find/coverage.mjs
import { fileURLToPath } from "node:url";
import { newMonitor, printRunReport, writeJSON } from "./store.mjs";
import { discover } from "./discover.mjs";
import { categorize } from "./categorize.mjs";
import { verify } from "./verify.mjs";
import { scoreTopics } from "./score.mjs";
import { searchTitle } from "../lib/tmdb.mjs";
import { TAXONOMY } from "../config.mjs";

// A fill film/show is only allowed if it clears the TMDB notability floor (NON-Wikipedia, 2026-06-28) — the
// same magnitude gate organic topics pass via lib/resolveEntity, so a fan upload / micro-title can't slip in.
async function notableScreenWork(title) {
  const r = (await searchTitle(title, "movie")) || (await searchTitle(title, "tv"));
  return !!r && ((r.vote_count || 0) >= 50 || (r.popularity || 0) >= 8);
}

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
const key = (c, s) => `${c}/${s}`;
// normalized entity key for cross-slot dedup: "The Bear (TV series)" and "The Bear" → "thebear"
const normEnt = (s) => (s || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/g, "").trim();

// Live-TMDB fills (real, current entities) — used when organic discovery left a slot empty.
const TMDB = "https://api.themoviedb.org/3";
const H = () => ({ Authorization: "Bearer " + process.env.TMDB_READ_TOKEN, accept: "application/json" });
const today = () => new Date().toISOString().slice(0, 10);
async function tget(p) { try { const r = await fetch(TMDB + p, { headers: H() }); return r.ok ? await r.json() : null; } catch { return null; } }
const enOnly = (it) => !it.original_language || it.original_language === "en";

// These return CANDIDATE LISTS (best-first) so fillSlot can skip already-used entities.
async function trendingPeople() {
  const j = await tget("/trending/person/week");
  return (j?.results || []).filter((p) => p.known_for_department === "Acting" && p.name).map((p) => p.name);
}
async function nowPlayingReleased() {
  const j = await tget("/movie/now_playing?region=US");
  return (j?.results || []).filter(enOnly).filter((m) => m.release_date && m.release_date <= today() && m.vote_count > 50).map((m) => m.title);
}
async function upcomingFilms() {
  const j = await tget("/movie/upcoming?region=US");
  return (j?.results || []).filter(enOnly).filter((m) => m.release_date && m.release_date > today()).map((m) => m.title);
}
async function trendingReleasedTV() {
  const j = await tget("/trending/tv/week");
  return (j?.results || []).filter(enOnly).filter((t) => t.first_air_date && t.first_air_date <= today() && t.vote_count > 50).map((t) => t.name);
}
// first notable, not-yet-used title from a candidate list
async function firstNotableUnused(list, used) {
  for (const name of list) {
    if (used.has(normEnt(name))) continue;
    if (await notableScreenWork(name)) return name;
  }
  return null;
}

// Grounded evergreen seeds (famous, rich-Wikipedia entities → reliable grounding) for slots TMDB can't fill.
const ROTATE = (arr) => arr[new Date().getUTCDate() % arr.length]; // rotates daily, deterministic (no Math.random)
const SEEDS = {
  "movies/rankings-lists": () => ROTATE([
    { title: "The Best Heist Movies of All Time, Ranked", primaryEntity: "Heat (1995 film)", primaryKeyword: "best heist movies", entities: ["Inside Man", "The Town (2010 film)", "Heat (1995 film)"] },
    { title: "The Best Psychological Thrillers, Ranked", primaryEntity: "Se7en", primaryKeyword: "best psychological thrillers", entities: ["Prisoners (2013 film)", "Zodiac (film)"] },
  ]),
  "movies/explainers": () => ROTATE([
    { title: "Inception's Ending, Explained", primaryEntity: "Inception", primaryKeyword: "inception ending explained", entities: ["Christopher Nolan"] },
    { title: "The Prestige's Twist, Explained", primaryEntity: "The Prestige (film)", primaryKeyword: "the prestige ending explained", entities: ["Christopher Nolan"] },
  ]),
  "tv/rankings-lists": () => ROTATE([
    { title: "The Best Sci-Fi TV Shows of All Time, Ranked", primaryEntity: "Battlestar Galactica (2004 TV series)", primaryKeyword: "best sci-fi tv shows", entities: ["The Expanse (TV series)", "Severance (TV series)"] },
    { title: "The Best Crime Dramas on TV, Ranked", primaryEntity: "Breaking Bad", primaryKeyword: "best crime dramas", entities: ["The Wire", "Better Call Saul"] },
  ]),
  "streaming/best-of-streaming": () => ({ provider: ROTATE(["Netflix", "Max", "Hulu"]), formatTag: "guide" }),
  "streaming/where-to-watch": () => ROTATE([
    { title: "Where to Watch the Harry Potter Movies", primaryEntity: "Harry Potter (film series)", primaryKeyword: "where to watch harry potter", entities: ["Harry Potter and the Philosopher's Stone (film)"] },
    { title: "Where to Watch the Lord of the Rings Movies", primaryEntity: "The Lord of the Rings (film series)", primaryKeyword: "where to watch lord of the rings", entities: ["The Lord of the Rings: The Fellowship of the Ring"] },
  ]),
  "movies/reactions": () => ({ _hard: true }), // needs live social discovery — flagged, not faked
  "tv/reactions": () => ({ _hard: true }),
  "awards/winners": () => ({ title: "Every Winner at the 97th Academy Awards", primaryEntity: "97th Academy Awards", primaryKeyword: "2025 oscars winners", formatTag: "awards" }),
  "awards/predictions": () => ({ title: "2026 Emmy Predictions: The Frontrunners So Far", primaryEntity: "77th Primetime Emmy Awards", primaryKeyword: "2026 emmy predictions", formatTag: "predictions" }),
  // MUSIC fills (grounded on rich Wikipedia pages; mk() assigns the music-* formatTag by category).
  "music/news": () => ROTATE([
    { title: "Cowboy Carter: Inside Beyoncé's Genre-Bending Album", primaryEntity: "Cowboy Carter", primaryKeyword: "beyonce cowboy carter", entities: ["Beyoncé"] },
    { title: "The Tortured Poets Department: Inside Taylor Swift's Album", primaryEntity: "The Tortured Poets Department", primaryKeyword: "tortured poets department", entities: ["Taylor Swift"] },
  ]),
  "music/awards": () => ROTATE([
    { title: "Every Winner at the 2025 Grammy Awards", primaryEntity: "67th Annual Grammy Awards", primaryKeyword: "2025 grammy winners" },
    { title: "Every Winner at the 2024 Grammy Awards", primaryEntity: "66th Annual Grammy Awards", primaryKeyword: "2024 grammy winners" },
  ]),
  "music/profiles-artists": () => ROTATE([
    { title: "Bad Bunny: The Career That Rewired Pop", primaryEntity: "Bad Bunny", primaryKeyword: "bad bunny career", entities: ["Bad Bunny"] },
    { title: "Olivia Rodrigo's Career So Far, Explained", primaryEntity: "Olivia Rodrigo", primaryKeyword: "olivia rodrigo career" },
  ]),
  "music/screen-music": () => ROTATE([
    { title: "How 'Running Up That Hill' Took Over Stranger Things", primaryEntity: "Running Up That Hill", primaryKeyword: "running up that hill stranger things", entities: ["Stranger Things", "Kate Bush"] },
    { title: "Inside the Barbie Soundtrack", primaryEntity: "Barbie the Album", primaryKeyword: "barbie soundtrack", entities: ["Barbie (film)"] },
  ]),
};

// Category-aware formatTag overrides for the new forms (PR1) — these slots are unambiguous by cat+sub.
const MUSIC_FT = { news: "music-news", awards: "music-awards", "profiles-artists": "music-profile", "screen-music": "screen-music" };
function formatFor(cat, sub, o) {
  if (cat === "music") return MUSIC_FT[sub] || "music-news";
  if (cat === "streaming" && sub === "where-to-watch") return "watchguide";
  if (cat === "awards" && sub === "predictions") return "predictions";
  return o.formatTag || FORMAT_BY_SUB[sub] || "news";
}

const FORMAT_BY_SUB = {
  "rankings-lists": "list", explainers: "explainer", trailers: "trailer", reactions: "reaction", news: "news",
  "box-office": "box-office", "best-of-streaming": "guide", "where-to-watch": "guide", "profiles-careers": "profile",
  interviews: "interview", "movie-reviews": "review", "tv-reviews": "review", winners: "awards", predictions: "awards",
};

function mk(cat, sub, o) {
  const ft = formatFor(cat, sub, o);
  return {
    id: `${ft}-${slugify(o.primaryKeyword || o.title || cat + "-" + sub)}`.slice(0, 80),
    slug: slugify(o.title || o.primaryKeyword),
    title: o.title,
    contentType: ft, formatTag: ft, category: cat, subcategory: sub,
    primaryKeyword: o.primaryKeyword, primaryEntity: o.primaryEntity || o.title,
    entities: o.entities || [], angle: o.angle || "", tmdbType: o.tmdbType || (cat === "tv" ? "tv" : "movie"),
    provider: o.provider, eventType: "other", sensitivity: "normal",
    _fill: true,
  };
}

async function fillSlot(cat, sub, monitor, used) {
  // live-TMDB fills (each film/show must be Wikipedia-notable + not already used in another slot)
  if (sub === "profiles-careers") { const n = await firstNotableUnused(await trendingPeople(), used); if (n) return mk(cat, sub, { title: `${n}'s Movies and Career, Explained`, primaryEntity: n, primaryKeyword: `${n} movies` }); }
  if (sub === "box-office") { const n = await firstNotableUnused(await nowPlayingReleased(), used); if (n) return mk(cat, sub, { title: `${n} Box Office: How It's Performing`, primaryEntity: n, primaryKeyword: `${n} box office` }); }
  if (sub === "trailers") { const n = await firstNotableUnused(await upcomingFilms(), used); if (n) return mk(cat, sub, { title: `${n} Trailer: Everything to Know`, primaryEntity: n, primaryKeyword: `${n} trailer`, tmdbType: "movie" }); }
  if (sub === "movie-reviews") { const n = await firstNotableUnused(await nowPlayingReleased(), used); if (n) return mk(cat, sub, { title: `${n} Review`, primaryEntity: n, primaryKeyword: `${n} review` }); }
  if (sub === "tv-reviews") { const n = await firstNotableUnused(await trendingReleasedTV(), used); if (n) return mk(cat, sub, { title: `${n} Review`, primaryEntity: n, primaryKeyword: `${n} review`, tmdbType: "tv" }); }
  // seed fills
  const seed = SEEDS[key(cat, sub)] && SEEDS[key(cat, sub)]();
  if (seed?._hard) { monitor.stage("coverage", `⚠ ${key(cat, sub)} needs live social discovery (reactions) — left for the 'more sources' phase`); return null; }
  if (seed) {
    if (seed.provider) return mk(cat, sub, { ...seed, title: `The Best Movies on ${seed.provider} Right Now`, primaryKeyword: `best movies on ${seed.provider}`, primaryEntity: seed.provider });
    if (used.has(normEnt(seed.primaryEntity))) return null; // seed entity already used elsewhere
    return mk(cat, sub, seed);
  }
  return null;
}

export async function buildCoverageQueue(monitor) {
  // 1) organic discovery
  const candidates = await discover(monitor, {});
  const fresh = candidates.filter((c) => c.ageMin != null).sort((a, b) => a.ageMin - b.ageMin);
  const backbone = candidates.filter((c) => c.ageMin == null).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const shortlist = [...fresh.slice(0, 50), ...backbone.slice(0, 30)];
  const topics = await categorize(shortlist, monitor);
  const verified = verify(topics, monitor);
  scoreTopics(verified, monitor);

  // 2) organic publishable topics per subcategory, best-first (a LIST, so we can skip used entities)
  const byBucket = new Map();
  for (const t of verified) {
    if (!t.verification?.publishable) continue;
    const k = key(t.category, t.subcategory);
    if (!byBucket.has(k)) byBucket.set(k, []);
    byBucket.get(k).push(t);
  }
  for (const list of byBucket.values()) list.sort((a, b) => b.priority - a.priority);

  // 3) for EVERY subcategory: best UNUSED organic topic, else a notability+dedup-checked evergreen-fill.
  //    used = entities already placed → no entity (Toy Story, The Bear, Minions) appears in two slots.
  const queue = [];
  const filled = [], organic = [], missing = [];
  const used = new Set();
  const entKey = (t) => normEnt(t.primaryEntity || t.title);
  for (const [cat, subs] of Object.entries(TAXONOMY)) {
    for (const sub of subs) {
      const k = key(cat, sub);
      const organicPick = (byBucket.get(k) || []).find((t) => !used.has(entKey(t)));
      if (organicPick) { used.add(entKey(organicPick)); queue.push(organicPick); organic.push(k); }
      else {
        const f = await fillSlot(cat, sub, monitor, used);
        if (f) { used.add(entKey(f)); queue.push(f); filled.push(k); }
        else missing.push(k);
      }
    }
  }
  monitor.stage("coverage", `${queue.length}/${Object.values(TAXONOMY).flat().length} subcategories covered — ${organic.length} organic + ${filled.length} evergreen-fill; ${missing.length} unfilled`, { organic, filled, missing });
  return { queue, organic, filled, missing };
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const runId = "coverage-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const monitor = newMonitor(runId);
  console.log(`\n=== COVERAGE MODE · ${runId} ===`);
  const { queue, missing } = await buildCoverageQueue(monitor);
  writeJSON("queue.json", { runId, builtAt: new Date().toISOString(), count: queue.length, topics: queue });
  printRunReport(monitor.finish(queue.length));
  console.log("\n── COVERAGE QUEUE (one per subcategory) ──");
  for (const t of queue) console.log(`  [${t.category}/${t.subcategory}] ${t._fill ? "(fill) " : ""}${t.formatTag} · "${t.title}"`);
  if (missing.length) console.log(`\n⚠ UNFILLED (need more sources): ${missing.join(", ")}`);
}
