// DISCOVERY (REV 3 — owner 2026-07-10 evening: "find the stories people are ACTUALLY crazy about").
// FIVE signals merged; AUDIENCE-BUZZ signals (search trends, wiki spikes, reddit argument) now
// dominate the heat; TMDB popularity is a tie-break; a story needs ≥2 independent signal families
// to lead a run (single-signal stories are heat-capped — trade coverage alone can't crown a story):
//   • HEADLINES — trade RSS (20 feeds) + Google News search: the trending Hollywood TOPICS/moments
//     (a casting shock, a star's claim, a controversy — Elliot Page in the Odyssey, Lupita on Homer).
//     Clustered across outlets: many outlets on one story = trending. THE PRIMARY SIGNAL.
//   • TMDB trending + now-playing = the WORKS people are watching (release-reaction stories).
//   • Reddit hot/top across film/TV subs = raw audience discourse + anchor posts (cloud IPs).
// Rank everything by discourse heat and emit story candidates. No confirmed-event gate — the
// discourse IS the trigger.
import { discoverTMDB } from "../find/sources/tmdb.mjs";
import { trendingSearches, wikiSpikes, tmdbMatch } from "./signals.mjs";
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

// Signal→heat boosts. Sized so a real audience-buzz hit outranks any coverage-only story:
// trade cluster of 8 outlets = 48 heat; a 100k+ search trend alone = 70.
const trendBoost = (traffic) => (traffic >= 500000 ? 90 : traffic >= 100000 ? 70 : traffic >= 50000 ? 55 : traffic >= 20000 ? 40 : traffic >= 5000 ? 28 : 15);
const wikiBoost = (views) => Math.min(80, Math.round(views / 10000));
// term↔label match: containment either way, or every significant token of the term in the label.
const labelMatch = (term, label) => {
  const T = norm(term), L = norm(label);
  if (!T || !L) return false;
  if (L.includes(T) || T.includes(L)) return true;
  const tt = sigTokens(term);
  return tt.length > 0 && tt.every((x) => L.includes(x));
};
// Independent signal families: cross-outlet coverage, reddit argument, search trend, wiki spike,
// genuine TMDB heat. <2 families → the story can support an article but never lead the run.
const familiesOf = (sig, popularity) =>
  ((sig.outlets || 0) >= 2 ? 1 : 0) + ((sig.comments || 0) > 0 ? 1 : 0) + (sig.trend ? 1 : 0) + (sig.wiki ? 1 : 0) + ((popularity || 0) >= 40 ? 1 : 0);

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
  trendsImpl = trendingSearches,
  wikiImpl = wikiSpikes,
  tmdbMatchImpl = tmdbMatch,
  max = MAX_STORIES_PER_RUN,
  nowMs = null,
} = {}) {
  const now = nowMs ?? Date.now();
  const [tmdb, reddit, headlines, trends, wiki] = await Promise.all([
    discoverTMDBImpl({ limitEach: 15 }).catch(() => []),
    discoverRedditImpl({ nowMs: now }).catch(() => []),
    discoverNewsImpl().catch(() => []),
    trendsImpl({}).catch(() => []),
    wikiImpl({ nowMs: now }).catch(() => []),
  ]);
  const usedTrend = new Set();
  const usedWiki = new Set();
  // A story's buzz signals attach by label match; leftovers become standalone candidates below.
  const attachSignals = (label, signals) => {
    let boost = 0;
    const tHit = trends.find((t) => labelMatch(t.term, label));
    if (tHit) { usedTrend.add(tHit.term); signals.trend = tHit.traffic || 1; boost += trendBoost(tHit.traffic); }
    const wHit = wiki.find((w) => labelMatch(w.name, label));
    if (wHit) { usedWiki.add(wHit.name); signals.wiki = wHit.views; boost += wikiBoost(wHit.views); }
    return boost;
  };

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
    const signals = { outlets: c.outlets, comments, headline: true };
    const buzz = attachSignals(`${c.headline} ${c.summary || ""}`, signals);
    const heat = c.outlets * HEAT.outletCount + comments * HEAT.redditComments + buzz + Math.max(0, HEAT.freshness - c.freshMin / 30);
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
      signals,
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
    const wSignals = { comments, redditPosts: matched.length, popularity: Math.round(w.popularity || 0) };
    const wBuzz = attachSignals(w.title, wSignals);
    const heat =
      comments * HEAT.redditComments +
      score * HEAT.redditScore +
      wBuzz +
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
      signals: wSignals,
      via: matched.length ? "tmdb+reddit" : "tmdb",
    });
  }

  // ── PERSON stories: someone everyone's suddenly talking about (breakout-buzz lane) ──
  for (const p of people.slice(0, 6)) {
    const matched = reddit.filter((post) => norm(post.title).includes(norm(p.title)) && !usedPosts.has(post.id));
    const comments = matched.reduce((s, x) => s + x.numComments, 0);
    const pSignals = { comments, redditPosts: matched.length, popularity: Math.round(p.popularity || 0), person: true };
    const pBuzz = attachSignals(p.title, pSignals);
    const heat = comments * HEAT.redditComments + pBuzz + (p.popularity || 0) * HEAT.tmdbPopularity;
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
      signals: pSignals,
      via: matched.length ? "tmdb+reddit" : "tmdb",
    });
  }

  // ── STANDALONE SIGNAL stories: a search trend / pageview spike about an entertainment entity
  //    that no cluster covered — the "everyone is suddenly searching this" lane. Entertainment-
  //    verified via TMDB (name↔term containment) so tennis players and politicians never enter.
  const leftoverTrends = trends.filter((t) => !usedTrend.has(t.term)).slice(0, 8);
  const leftoverWiki = wiki.filter((w) => !usedWiki.has(w.name)).slice(0, 8);
  const [trendEnts, wikiEnts] = await Promise.all([
    Promise.all(leftoverTrends.map((t) => tmdbMatchImpl(t.term).catch(() => null))),
    Promise.all(leftoverWiki.map((w) => tmdbMatchImpl(w.name).catch(() => null))),
  ]);
  leftoverTrends.forEach((t, i) => {
    const m = trendEnts[i];
    if (!m) return;
    const matched = reddit.filter((p) => labelMatch(m.title, p.title));
    const comments = matched.reduce((s, x) => s + x.numComments, 0);
    const signals = { trend: t.traffic || 1, comments, outlets: new Set(t.news.map((n) => n.source).filter(Boolean)).size };
    const wHit = wiki.find((w) => labelMatch(w.name, m.title));
    if (wHit) { usedWiki.add(wHit.name); signals.wiki = wHit.views; }
    stories.push({
      storySlug: slugify(t.term).slice(0, 60),
      kind: m.kind === "person" ? "person" : "headline",
      primaryEntity: m.title,
      work: m.kind === "movie" || m.kind === "tv" ? { title: m.title, type: m.kind === "tv" ? "tv" : "movie", year: m.year } : null,
      category: m.kind === "person" ? "celebrity" : m.kind === "tv" ? "tv" : "movies",
      released: null,
      overview: t.news.map((n) => n.title).filter(Boolean).join(" · ").slice(0, 300),
      headline: t.news[0]?.title || null,
      redditPosts: matched.slice(0, 8),
      sources: t.news.slice(0, 4).map((n) => ({ url: n.url, outlet: n.source || null })),
      popularity: m.popularity || 0,
      discourseHeat: Math.round(trendBoost(t.traffic) + (signals.wiki ? wikiBoost(signals.wiki) : 0) + comments * HEAT.redditComments),
      signals,
      via: "trends",
    });
  });
  leftoverWiki.forEach((w, i) => {
    if (usedWiki.has(w.name)) return;
    const m = wikiEnts[i];
    if (!m) return;
    const matched = reddit.filter((p) => labelMatch(m.title, p.title));
    const comments = matched.reduce((s, x) => s + x.numComments, 0);
    stories.push({
      storySlug: slugify(`${w.name}-surge`).slice(0, 60),
      kind: m.kind === "person" ? "person" : "work",
      primaryEntity: m.title,
      work: m.kind === "movie" || m.kind === "tv" ? { title: m.title, type: m.kind === "tv" ? "tv" : "movie", year: m.year } : null,
      category: m.kind === "person" ? "celebrity" : m.kind === "tv" ? "tv" : "movies",
      released: null,
      overview: "",
      headline: null,
      redditPosts: matched.slice(0, 8),
      sources: [...new Set(matched.map((x) => x.url).filter(Boolean))].slice(0, 4).map((url) => ({ url, outlet: null })),
      popularity: m.popularity || 0,
      discourseHeat: Math.round(wikiBoost(w.views) + comments * HEAT.redditComments),
      signals: { wiki: w.views, wikiSpike: w.spike, comments },
      via: "wiki",
    });
  });

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
  // ≥2 INDEPENDENT SIGNAL FAMILIES TO LEAD (owner: trade coverage alone crowned the wrong story) —
  // single-signal stories stay eligible but heat-capped below any genuine multi-signal story.
  for (const st of deduped) {
    st.signals.families = familiesOf(st.signals, st.popularity);
    if (st.signals.families < 2) st.discourseHeat = Math.min(st.discourseHeat, 45);
  }
  deduped.sort((a, b) => b.discourseHeat - a.discourseHeat);
  return deduped.slice(0, max);
}
