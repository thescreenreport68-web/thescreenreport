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
import { wikiSummary } from "../lib/wikipedia.mjs";
import { TAXONOMY } from "../config.mjs";

// A fill film/show is only allowed if it is Wikipedia-notable (its own page that reads as a screen work)
// — the same gate organic topics pass, so a TMDB-only entry like a fan upload can't slip into a fill.
async function notableScreenWork(title) {
  const s = await wikiSummary(title);
  if (!s?.extract) return false;
  return /\b(film|movie|miniseries|series|television|sitcom|documentary|animated|show)\b/i.test(`${s.type || ""} ${s.extract.slice(0, 400)}`);
}

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
const key = (c, s) => `${c}/${s}`;

// Live-TMDB fills (real, current entities) — used when organic discovery left a slot empty.
const TMDB = "https://api.themoviedb.org/3";
const H = () => ({ Authorization: "Bearer " + process.env.TMDB_READ_TOKEN, accept: "application/json" });
const today = () => new Date().toISOString().slice(0, 10);
async function tget(p) { try { const r = await fetch(TMDB + p, { headers: H() }); return r.ok ? await r.json() : null; } catch { return null; } }
const enOnly = (it) => !it.original_language || it.original_language === "en";

async function trendingPerson() {
  const j = await tget("/trending/person/week");
  return (j?.results || []).find((p) => p.known_for_department === "Acting" && p.name) || null;
}
async function nowPlayingReleased() {
  const j = await tget("/movie/now_playing?region=US");
  return (j?.results || []).filter(enOnly).filter((m) => m.release_date && m.release_date <= today() && m.vote_count > 50)[0] || null;
}
async function upcomingWithDate() {
  const j = await tget("/movie/upcoming?region=US");
  return (j?.results || []).filter(enOnly).filter((m) => m.release_date && m.release_date > today())[0] || null;
}
async function trendingReleasedTV() {
  const j = await tget("/trending/tv/week");
  return (j?.results || []).filter(enOnly).filter((t) => t.first_air_date && t.first_air_date <= today() && t.vote_count > 50)[0] || null;
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
  "awards/predictions": () => ({ title: "2026 Emmy Predictions: The Frontrunners So Far", primaryEntity: "77th Primetime Emmy Awards", primaryKeyword: "2026 emmy predictions", formatTag: "news" }),
};

const FORMAT_BY_SUB = {
  "rankings-lists": "list", explainers: "explainer", trailers: "trailer", reactions: "reaction", news: "news",
  "box-office": "box-office", "best-of-streaming": "guide", "where-to-watch": "guide", "profiles-careers": "profile",
  interviews: "interview", "movie-reviews": "review", "tv-reviews": "review", winners: "awards", predictions: "awards",
};

function mk(cat, sub, o) {
  const ft = o.formatTag || FORMAT_BY_SUB[sub] || "news";
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

async function fillSlot(cat, sub, monitor) {
  const ft = FORMAT_BY_SUB[sub];
  // live-TMDB fills (each film/show must be Wikipedia-notable, or we skip it)
  if (sub === "profiles-careers") { const p = await trendingPerson(); if (p && (await notableScreenWork(p.name))) return mk(cat, sub, { title: `${p.name}'s Movies and Career, Explained`, primaryEntity: p.name, primaryKeyword: `${p.name} movies` }); }
  if (sub === "box-office") { const m = await nowPlayingReleased(); if (m && (await notableScreenWork(m.title))) return mk(cat, sub, { title: `${m.title} Box Office: How It's Performing`, primaryEntity: m.title, primaryKeyword: `${m.title} box office` }); }
  if (sub === "trailers") { const m = await upcomingWithDate(); if (m && (await notableScreenWork(m.title))) return mk(cat, sub, { title: `${m.title} Trailer: Everything to Know`, primaryEntity: m.title, primaryKeyword: `${m.title} trailer`, tmdbType: "movie" }); }
  if (sub === "movie-reviews") { const m = await nowPlayingReleased(); if (m && (await notableScreenWork(m.title))) return mk(cat, sub, { title: `${m.title} Review`, primaryEntity: m.title, primaryKeyword: `${m.title} review` }); }
  if (sub === "tv-reviews") { const t = await trendingReleasedTV(); if (t && (await notableScreenWork(t.name))) return mk(cat, sub, { title: `${t.name} Review`, primaryEntity: t.name, primaryKeyword: `${t.name} review`, tmdbType: "tv" }); }
  // seed fills
  const seed = SEEDS[key(cat, sub)] && SEEDS[key(cat, sub)]();
  if (seed?._hard) { monitor.stage("coverage", `⚠ ${key(cat, sub)} needs live social discovery (reactions) — left for the 'more sources' phase`); return null; }
  if (seed) {
    if (seed.provider) return mk(cat, sub, { ...seed, title: `The Best Movies on ${seed.provider} Right Now`, primaryKeyword: `best movies on ${seed.provider}`, primaryEntity: seed.provider });
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

  // 2) best ORGANIC topic per subcategory
  const byBucket = new Map();
  for (const t of verified) {
    if (!t.verification?.publishable) continue;
    const k = key(t.category, t.subcategory);
    if (!byBucket.has(k) || t.priority > byBucket.get(k).priority) byBucket.set(k, t);
  }

  // 3) for EVERY subcategory: use organic, else evergreen-fill
  const queue = [];
  const filled = [], organic = [], missing = [];
  for (const [cat, subs] of Object.entries(TAXONOMY)) {
    for (const sub of subs) {
      const k = key(cat, sub);
      if (byBucket.has(k)) { queue.push(byBucket.get(k)); organic.push(k); }
      else {
        const f = await fillSlot(cat, sub, monitor);
        if (f) { queue.push(f); filled.push(k); }
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
