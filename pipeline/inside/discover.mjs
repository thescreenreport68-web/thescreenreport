// DISCOVERY (REV 2.1 — owner 2026-07-10: "no boundaries — scour the Hollywood news, find whatever is
// spicy and trending"). THREE signals merged:
//   • HEADLINES — trade RSS (20 feeds) + Google News search: the trending Hollywood TOPICS/moments
//     (a casting shock, a star's claim, a controversy — Elliot Page in the Odyssey, Lupita on Homer).
//     Clustered across outlets: many outlets on one story = trending. THE PRIMARY SIGNAL.
//   • TMDB trending + now-playing = the WORKS people are watching (release-reaction stories).
//   • Reddit hot/top across film/TV subs = raw audience discourse + anchor posts (cloud IPs).
// Rank everything by discourse heat and emit story candidates. No confirmed-event gate — the
// discourse IS the trigger.
import { discoverTMDB } from "../find/sources/tmdb.mjs";
import { discoverReddit } from "../find/sources/reddit.mjs";
import { discoverGoogleNews } from "../find/sources/gnews.mjs";
import { discoverRSS } from "../find/sources/rss.mjs";
import { HEAT, MAX_STORIES_PER_RUN } from "./config.inside.mjs";

const STOP = new Set(["the", "a", "an", "of", "and", "movie", "film", "series", "show", "season", "part", "chapter", "2", "3", "ii", "iii"]);
const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const sigTokens = (title) => norm(title).split(" ").filter((w) => w.length > 2 && !STOP.has(w));

// A reddit post is ABOUT a work when the work's full normalized title appears as a phrase in the post
// title, OR all of the work's significant tokens do (handles "Superman" and "The Odyssey" alike).
function postMatchesWork(post, work) {
  const t = norm(`${post.title} ${post.url || ""}`);
  const wt = norm(work.title);
  if (wt.length >= 4 && t.includes(wt)) return true;
  const toks = sigTokens(work.title);
  return toks.length > 0 && toks.every((tok) => t.includes(tok));
}

const CAT_FOR = { "trending-movie": "movies", "now-playing": "movies", "upcoming": "movies", "trending-tv": "tv" };

// Default HEADLINE source: trade RSS + Google News, merged (both keyless, both already built for
// the news lane). Every failure degrades to [] — discovery never dies on one source.
async function defaultNewsHeadlines() {
  const [rss, gn] = await Promise.all([
    discoverRSS({ freshHours: 48 }).catch(() => []),
    discoverGoogleNews({ freshHours: 48 }).catch(() => []),
  ]);
  return [...rss, ...gn];
}

// Cluster headlines covering the SAME story (shared significant tokens): cluster size across
// distinct outlets = how trending the topic is. Cheap and deterministic — the finder LLM does the
// editorial picking afterwards.
export function clusterHeadlines(items, { minOutlets = 2 } = {}) {
  const entries = (items || [])
    .filter((h) => h?.title)
    .map((h) => ({ h, toks: new Set(sigTokens(h.title)) }))
    .filter((e) => e.toks.size >= 2);
  const clusters = [];
  for (const e of entries) {
    let home = null;
    for (const c of clusters) {
      const inter = [...e.toks].filter((t) => c.toks.has(t)).length;
      const denom = Math.min(e.toks.size, c.toks.size);
      if (denom && inter / denom >= 0.5) { home = c; break; }
    }
    if (home) {
      home.items.push(e.h);
      for (const t of e.toks) home.toks.add(t);
    } else {
      clusters.push({ items: [e.h], toks: new Set(e.toks) });
    }
  }
  return clusters
    .map((c) => {
      const outlets = new Set(c.items.map((h) => h.outlet || h.source).filter(Boolean));
      const best = c.items.reduce((a, b) => ((a.sourceTier || 0) >= (b.sourceTier || 0) ? a : b));
      const freshest = Math.min(...c.items.map((h) => h.ageMin ?? 9999));
      return { headline: best.title, summary: best.summary || "", cats: best.cats || [], outlets: outlets.size, freshMin: freshest, urls: [...new Set(c.items.map((h) => h.url).filter(Boolean))].slice(0, 6) };
    })
    .filter((c) => c.outlets >= minOutlets)
    .sort((a, b) => b.outlets - a.outlets || a.freshMin - b.freshMin);
}

export async function discoverStories({
  discoverTMDBImpl = discoverTMDB,
  discoverRedditImpl = discoverReddit,
  discoverNewsImpl = defaultNewsHeadlines,
  max = MAX_STORIES_PER_RUN,
  nowMs = null,
} = {}) {
  const now = nowMs ?? Date.now();
  const [tmdb, reddit, headlines] = await Promise.all([
    discoverTMDBImpl({ limitEach: 15 }).catch(() => []),
    discoverRedditImpl({ nowMs: now }).catch(() => []),
    discoverNewsImpl().catch(() => []),
  ]);

  const works = tmdb.filter((t) => ["trending-movie", "trending-tv", "now-playing", "upcoming"].includes(t.kind));
  const people = tmdb.filter((t) => t.kind === "trending-person");

  const stories = [];

  // ── HEADLINE-TOPIC stories (the primary signal): the trending Hollywood story itself — a casting
  //    shock, a star's claim, a controversy — whatever many outlets are covering right now. The
  //    reddit threads about it (when available) attach as discourse + anchors.
  const CATSET = new Set(["movies", "tv", "celebrity", "music", "streaming", "awards"]);
  for (const c of clusterHeadlines(headlines)) {
    const matched = reddit.filter((p) => {
      const toks = sigTokens(c.headline).slice(0, 4);
      const t = norm(p.title);
      return toks.filter((tok) => t.includes(tok)).length >= 2;
    });
    const comments = matched.reduce((s, p) => s + p.numComments, 0);
    const heat = c.outlets * HEAT.outletCount + comments * HEAT.redditComments + Math.max(0, HEAT.freshness - c.freshMin / 30);
    const cat = (c.cats || []).find((x) => CATSET.has(x)) || "celebrity";
    stories.push({
      storySlug: slugify(c.headline).slice(0, 60),
      kind: "headline",
      primaryEntity: c.headline.replace(/[|:–—-].*$/, "").trim().slice(0, 80) || c.headline.slice(0, 80),
      work: null,
      category: cat,
      released: null,
      overview: c.summary,
      headline: c.headline,
      redditPosts: matched.slice(0, 8),
      sources: c.urls.map((url) => ({ url, outlet: null })),
      popularity: 0,
      discourseHeat: Math.round(heat),
      signals: { outlets: c.outlets, comments, headline: true },
      via: matched.length ? "news+reddit" : "news",
    });
  }

  // ── WORK stories: a trending work + the reddit discourse about it ──
  const usedPosts = new Set();
  for (const w of works) {
    const matched = reddit.filter((p) => postMatchesWork(p, w));
    matched.forEach((p) => usedPosts.add(p.id));
    const comments = matched.reduce((s, p) => s + p.numComments, 0);
    const score = matched.reduce((s, p) => s + p.score, 0);
    const heat =
      comments * HEAT.redditComments +
      score * HEAT.redditScore +
      (w.popularity || 0) * HEAT.tmdbPopularity;
    // Keep a work only if it has real discourse OR is genuinely hot (a top story worth covering).
    if (matched.length === 0 && (w.popularity || 0) < 40) continue;
    stories.push({
      storySlug: slugify(`${w.title}-${w.year || ""}`),
      kind: "work",
      primaryEntity: w.title,
      work: { title: w.title, type: w.mediaType === "tv" ? "tv" : "movie", year: w.year || null },
      category: CAT_FOR[w.kind] || "movies",
      released: w.released,
      overview: w.overview || "",
      redditPosts: matched.slice(0, 8),
      sources: [...new Set(matched.map((p) => p.url).filter(Boolean))].slice(0, 6).map((url) => ({ url, outlet: null })),
      popularity: w.popularity || 0,
      discourseHeat: Math.round(heat),
      signals: { comments, redditPosts: matched.length, popularity: Math.round(w.popularity || 0) },
      via: matched.length ? "tmdb+reddit" : "tmdb",
    });
  }

  // ── PERSON stories: someone everyone's suddenly talking about (breakout-buzz lane) ──
  for (const p of people.slice(0, 6)) {
    const matched = reddit.filter((post) => norm(post.title).includes(norm(p.title)) && !usedPosts.has(post.id));
    const comments = matched.reduce((s, x) => s + x.numComments, 0);
    const heat = comments * HEAT.redditComments + (p.popularity || 0) * HEAT.tmdbPopularity;
    if (matched.length === 0 && (p.popularity || 0) < 15) continue;
    stories.push({
      storySlug: slugify(`${p.title}-buzz`),
      kind: "person",
      primaryEntity: p.title,
      work: null,
      category: "celebrity",
      redditPosts: matched.slice(0, 8),
      sources: [...new Set(matched.map((x) => x.url).filter(Boolean))].slice(0, 6).map((url) => ({ url, outlet: null })),
      popularity: p.popularity || 0,
      discourseHeat: Math.round(heat),
      signals: { comments, redditPosts: matched.length, popularity: Math.round(p.popularity || 0), person: true },
      via: matched.length ? "tmdb+reddit" : "tmdb",
    });
  }

  // ── Orphan reddit stories: a hot argument whose subject isn't in TMDB trending ──
  // (a specific controversy about an older/again-viral title). Subject = cleaned post title.
  for (const post of reddit) {
    if (usedPosts.has(post.id)) continue;
    if (post.numComments < 120) continue; // only genuinely big standalone arguments
    const subject = post.title.replace(/[?!.].*$/, "").slice(0, 80);
    stories.push({
      storySlug: slugify(subject).slice(0, 60),
      kind: "discourse",
      primaryEntity: subject,
      work: null,
      category: post.subreddit && /television|tv/i.test(post.subreddit) ? "tv" : "movies",
      redditPosts: [post],
      sources: post.url ? [{ url: post.url, outlet: null }] : [],
      popularity: 0,
      discourseHeat: post.numComments,
      signals: { comments: post.numComments, redditPosts: 1, orphan: true },
      via: "reddit",
    });
  }

  const seen = new Set();
  const deduped = stories.filter((s) => (seen.has(s.storySlug) ? false : (seen.add(s.storySlug), true)));
  deduped.sort((a, b) => b.discourseHeat - a.discourseHeat);
  return deduped.slice(0, max);
}
