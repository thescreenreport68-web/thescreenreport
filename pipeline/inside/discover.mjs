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
import { bskySearchPosts } from "./bsky.mjs";
import { xSearchStats } from "./xsearch.mjs";
import { NO_X } from "./config.inside.mjs";
import { discoverReddit, catForSub } from "../find/sources/reddit.mjs";
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
export const CATSET = new Set(["movies", "tv", "celebrity", "music", "streaming", "awards"]);

// CATEGORY = the STORY'S SUBJECT, never the person's profession (owner 2026-07-12: a musician in a TV/
// movie story is TV/movies, NOT music; an actor's album is music). Two rules that killed the real bugs:
//   1. A TMDB-CONFIRMED work's medium is authoritative (movie→movies, tv→tv) — keywords never override it.
//   2. The text signals are WORK/EVENT words only. Job titles ("singer/rapper/pop star/band") are GONE —
//      they described the person and hijacked screen stories (e.g. "pop star exits AHS Season 13" → music).
//      Screen signals are tested BEFORE music so a musician's film/TV story routes to movies/tv, not music.
const TV_RX = /\b(tv series|television series|streaming series|limited series|mini-?series|netflix series|hbo series|season \d+|(new|next|final|first|latest) season|new episode|showrunner|renewed for|cancell?ed after|series finale|season finale|now streaming)\b/i;
const MOVIE_RX = /\b(film|movie|box office|in theaters|theatrical|opening weekend|sequel|prequel|reboot|casting|directed by|the director|trailer|franchise|screening)\b/i;
const MUSIC_RX = /\b(album|single|mixtape|new song|music video|world tour|concert tour|on tour|tour dates|residency|grammy|billboard (hot|200)|debut record|drops? (a |the |his |her |their )?(album|single|ep|mixtape|song))\b/i;

// work: {type:"movie"|"tv"} when TMDB-confirmed; text: headline/summary for topic stories; hint: the
// news-lane's category guess (used ONLY when the text carries no clear subject signal). Falls to celebrity.
export function categoryFor({ work = null, text = "", hint = null } = {}) {
  if (work?.type === "tv") return "tv";
  if (work?.type === "movie") return "movies";
  const t = text || "";
  if (TV_RX.test(t)) return "tv";
  if (MOVIE_RX.test(t)) return "movies";
  if (MUSIC_RX.test(t)) return "music";
  if (hint && CATSET.has(hint)) return hint;
  return "celebrity";
}

// NON-ENTERTAINMENT deterministic reject (owner audit: a viral POLITICIAN ranked #1). Clear politics/
// government/sports/business/crime markers in the headline/overview drop the story before it can lead;
// the finder LLM is the semantic backstop for name-only cases (e.g. a politician with no keyword).
const NON_ENT_RX = /\b(elect(ion|ed)|politic(s|al|ian)|parliament|MP|senator|congress|governor|president|prime minister|minister|Brexit|Tory|Labour|Republican|Democrat|campaign|policy|referendum|court|trial|verdict|lawsuit indictment|stock|earnings|IPO|quarterly|NFL|NBA|MLB|Premier League|World Cup|golf tournament|championship match|Wimbledon|Olympics|striker|midfielder|goalkeeper|Ballon d.Or|transfer window|Bundesliga|La Liga|Serie A|UEFA|FIFA|Champions League|quarterback|touchdown|Grand Prix|Formula 1|shot and killed|fatally shot|shooting|stabb(ed|ing)|homicide|manslaughter|carjacking|robbery|kidnap|wildfire|hurricane|earthquake|tornado|\bflooding\b|plane crash|road accident)\b/i;
const isEntertainmentTopic = (text) => !NON_ENT_RX.test(text || "");

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
// real audience posts, genuine TMDB heat. <2 families → the story can support an article but never
// lead the run.
const familiesOf = (sig, popularity) =>
  ((sig.outlets || 0) >= 2 ? 1 : 0) + ((sig.comments || 0) > 0 ? 1 : 0) + (sig.trend ? 1 : 0) + (sig.wiki ? 1 : 0) + (((sig.xPopular || 0) >= 3 || (sig.audiencePosts || 0) >= 3) ? 1 : 0) + ((popularity || 0) >= 40 ? 1 : 0) + (sig.redditHot ? 1 : 0);
// A genuine AUDIENCE-REACTION family (owner 2026-07-12: a story may only LEAD if PEOPLE are reacting —
// not on coverage/lookup alone). A festival award covered by 8 outlets + a wiki spike has 2 families but
// ZERO reactions; it must not lead. Reddit comments, a hot reddit thread, or real audience posts qualify.
const hasReactionFamily = (sig) => (sig.comments || 0) > 0 || !!sig.redditHot || (sig.audiencePosts || 0) >= 3 || (sig.xPopular || 0) >= 3;

// Anime/manga/game-adaptation detector (owner: "it is anime — we are talking about Hollywood").
// Demoted HARD below: these stories only run on overwhelming real buzz, never as filler.
const ANIME_RX = /\b(anime|manga|naruto|one piece|dragon ball|pok[eé]mon|jujutsu|demon slayer|attack on titan|my hero academia|sailor moon|bleach|ghibli|gundam|zelda|minecraft|street fighter|mortal kombat|video game adaptation)\b/i;

// The short label a person would actually post about (search recall beats precision here).
// Extract the real SUBJECT from a headline (fixes roundup/label headlines whose entity was being
// read as the prefix — "Release Rundown: …" → "Release Rundown", so the X search found nothing).
// A quoted work title wins (most entertainment headlines quote the work); else strip a label prefix.
const ROUNDUP_PREFIX = /^\s*(release rundown|box office|stream|trailer|first look|exclusive|interview|watch|review|recap|roundup|what to watch|new on \S+|weekend box office|opinion|analysis|report|breaking|update|listen)\b[:\-—|]*\s*/i;
// Entertainment headlines are "SUBJECT verbs OBJECT" — cut at the first action verb / preposition so
// the subject (a name or work) leads, which is what the X search and harvest need.
const ACTION_STOP = /\b(exits?|dies?|dead|drops?|sets?|launch(es|ed)?|brings?|praises?|responds?|addresses?|reveals?|confirms?|announces?|joins?|lands?|signs?|makes?|shares?|slams?|defends?|teases?|debuts?|returns?|leaves?|quits?|calls?|says?|talks?|opens?|clears?|hits?|earns?|scores?|breaks?|unveils?|premieres?|renewed|cancell?ed|cast|stars?|is|are|was|were|has|have|to|on|in|at|with|amid|after|as|over|for|from)\b/i;
function headlineEntity(headline, fallback = "") {
  const h = (headline || "").trim();
  const q = h.match(/[‘’“”'"]([^‘’“”'"]{2,60})[‘’“”'"]/);
  if (q && /[A-Za-z]{3}/.test(q[1])) return q[1].trim();               // a quoted work title wins
  const stripped = (h.replace(ROUNDUP_PREFIX, "").trim() || fallback || h);
  const m = stripped.match(ACTION_STOP);
  let ent = m && m.index > 2 ? stripped.slice(0, m.index) : stripped;  // subject before the first verb
  ent = ent.replace(/\s*[|:,–—].*$/, "").trim();
  return ent.slice(0, 60) || stripped.replace(/\s*[|:,–—].*$/, "").trim().slice(0, 60) || (fallback || h).slice(0, 60);
}
const buzzTermOf = (s) => (s.work?.title || headlineEntity(s.headline, s.primaryEntity) || s.primaryEntity || "").split(/[|,]|\s[-]\s/)[0].trim().slice(0, 60);

// Reddit titles are conversational ("Everyone is losing it over X", "Official Discussion - X [SPOILERS]"),
// not news "SUBJECT verbs OBJECT" — strip the reddit FRAMING to recover the work/subject people react to.
const REDDIT_FRAME = /^\s*(official\s+)?(post-?premiere\s+)?(discussion|megathread|unpopular opinion|hot take|can we (talk about|appreciate)|what did (everyone|you all|people|we) think (of|about)|(everyone|the internet)('?s| is| are)?\s*(talking about|losing it over|obsessed with)|am i the only one who|my (thoughts|review) (on|of)|so,? |just (watched|finished|saw) )\s*[:\-—]*\s*/i;
export function redditSubject(title) {
  let t = String(title || "").replace(REDDIT_FRAME, "").replace(/\s*\[(spoilers?|no spoilers?|discussion|serious)\]\s*/gi, " ").trim();
  t = t.replace(/\?.*$/, "").trim();
  return t.slice(0, 80) || String(title || "").replace(/[?!.].*$/, "").slice(0, 80);
}

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
  bskyCountImpl = bskySearchPosts,
  xStatsImpl = xSearchStats,
  xPaceMs = 5500,
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
  // Declared BEFORE the headline loop so a headline-matched reddit post can't ALSO emit as a reddit-primary
  // story (double-emit fix). Every loop that consumes a post marks it here.
  const usedPosts = new Set();

  // ── HEADLINE-TOPIC stories (the primary signal): the trending Hollywood story itself — a casting
  //    shock, a star's claim, a controversy — whatever many outlets are covering right now. The
  //    reddit threads about it (when available) attach as discourse + anchors.
  for (const c of clusterHeadlines(headlines)) {
    const matched = reddit.filter((p) => {
      const toks = sigTokens(c.headline).slice(0, 4);
      const t = norm(p.title);
      return toks.filter((tok) => t.includes(tok)).length >= 2;
    });
    matched.forEach((p) => usedPosts.add(p.id)); // headline consumes these posts — don't re-emit as reddit-primary
    const comments = matched.reduce((s, p) => s + p.numComments, 0);
    const signals = { outlets: c.outlets, comments, headline: true };
    const buzz = attachSignals(`${c.headline} ${c.summary || ""}`, signals);
    const heat = c.outlets * HEAT.outletCount + comments * HEAT.redditComments + buzz + Math.max(0, HEAT.freshness - c.freshMin / 30);
    const cat = categoryFor({ text: `${c.headline} ${c.summary || ""}`, hint: (c.cats || []).find((x) => CATSET.has(x)) });
    stories.push({
      storySlug: slugify(c.headline).slice(0, 60),
      kind: "headline",
      primaryEntity: headlineEntity(c.headline).slice(0, 80) || c.headline.slice(0, 80),
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
    // Corroborate a bare-name PERSON (owner 2026-07-12: a trending SEARCH person is often a politician/
    // athlete TMDB indexes as "person" from archive/doc credits; keep only one that is IN-NICHE — has
    // film/TV/music reddit discourse OR entertainment keywords in its news). Works are inherently in-niche.
    if (m.kind === "person") { const nt = t.news.map((n) => n.title).join(" "); if (!(matched.length > 0 || MOVIE_RX.test(nt) || TV_RX.test(nt) || MUSIC_RX.test(nt))) return; }
    const signals = { trend: t.traffic || 1, comments, outlets: new Set(t.news.map((n) => n.source).filter(Boolean)).size };
    const wHit = wiki.find((w) => labelMatch(w.name, m.title));
    if (wHit) { usedWiki.add(wHit.name); signals.wiki = wHit.views; }
    const wk = m.kind === "movie" || m.kind === "tv" ? { title: m.title, type: m.kind === "tv" ? "tv" : "movie", year: m.year } : null;
    stories.push({
      storySlug: slugify(t.term).slice(0, 60),
      kind: m.kind === "person" ? "person" : "headline",
      primaryEntity: m.title,
      work: wk,
      category: categoryFor({ work: wk, text: `${m.title} ${t.news.map((n) => n.title).join(" ")}` }),
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
    // A wiki-surge PERSON with no film/TV/music reddit corroboration is likely a politician/athlete — drop
    // (the wiki path has no news text to keyword-check, so reddit discourse is the only in-niche signal).
    if (m.kind === "person" && matched.length === 0) return;
    const wk = m.kind === "movie" || m.kind === "tv" ? { title: m.title, type: m.kind === "tv" ? "tv" : "movie", year: m.year } : null;
    stories.push({
      storySlug: slugify(`${w.name}-surge`).slice(0, 60),
      kind: m.kind === "person" ? "person" : "work",
      primaryEntity: m.title,
      work: wk,
      category: categoryFor({ work: wk, text: `${m.title} ${(w.name || "")}` }),
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

  // ── REDDIT-PRIMARY lane (owner 2026-07-12: the reliable reacted-to supply for 12/day). A HOT
  //    entertainment-sub post IS a trending story AND its comment thread IS hundreds of audience
  //    reactions ready to quote. Every hot post people are actively arguing about (>=40 comments,
  //    >=300 upvotes, <=48h, in-niche, non-anime) becomes a FIRST-CLASS candidate carrying its own
  //    thread as the reaction supply — so the harvest's >=3-fan-post floor is met by construction.
  const REDDIT_MIN_COMMENTS = Number(process.env.INSIDE_REDDIT_MIN_COMMENTS) || 40;
  const REDDIT_MIN_SCORE = Number(process.env.INSIDE_REDDIT_MIN_SCORE) || 300;
  const redditPrimary = reddit
    .filter((post) => !usedPosts.has(post.id)
      && (post.numComments || 0) >= REDDIT_MIN_COMMENTS && (post.score || 0) >= REDDIT_MIN_SCORE && (post.ageMin ?? 0) <= 48 * 60
      && !ANIME_RX.test(post.title) && isEntertainmentTopic(post.title))
    .sort((a, b) => b.numComments - a.numComments)
    .slice(0, 24);
  for (const post of redditPrimary) {
    usedPosts.add(post.id);
    const subject = redditSubject(post.title);
    stories.push({
      storySlug: slugify(subject || post.title).slice(0, 60),
      kind: "discourse",
      primaryEntity: subject,
      work: null,
      category: catForSub(post.subreddit),
      redditPosts: [post],
      sources: post.url ? [{ url: post.url, outlet: null }] : [],
      popularity: 0,
      // Heat led by the discussion volume (real reactions) + a bounded upvote bump — a 300-comment thread
      // outranks a down-weighted trade cluster, and the redditHot family lets it escape the lead cap.
      discourseHeat: Math.round((post.numComments || 0) + Math.min(60, (post.score || 0) / 200)),
      signals: { comments: post.numComments, redditPosts: 1, redditHot: true },
      via: "reddit",
    });
  }

  const seen = new Set();
  let deduped = stories.filter((s) => (seen.has(s.storySlug) ? false : (seen.add(s.storySlug), true)));

  // ── STAGE 1 — CHEAP "is anyone talking?" PRE-FILTER (keyless Bluesky count; free, no QPS). A story
  //    with zero audience posts, zero reddit argument, no search trend and no wiki spike is DROPPED
  //    before we spend a paid X call on it.
  deduped.sort((a, b) => b.discourseHeat - a.discourseHeat);
  // Measure MORE candidates, DEEPER (owner 2026-07-12: boost reaction supply). In free mode Bluesky is
  // the primary audience signal, so it carries the ranking — a story with lots of bsky reactions should
  // outrank a widely-covered trade item with none, and it's the pool the harvest will draw from.
  const preList = deduped.slice(0, Math.max(30, max)); // measure the free reaction signal on the WHOLE surviving pool, not just the top 18 (keyless, no QPS)
  const bskyCounts = await Promise.all(preList.map((st) =>
    bskyCountImpl(buzzTermOf(st), { limit: 40, sort: "latest", nowMs: now }).catch(() => []),
  ));
  preList.forEach((st, i) => {
    const posts = bskyCounts[i] || [];
    st.signals.audiencePosts = posts.length;
    st.signals.audienceEngagement = posts.reduce((sum, p) => sum + (p.likes || 0), 0);
    // FREE MODE: with the paid X measure off, Bluesky post-count + likes IS the popularity signal and now
    // dominates the (down-weighted) outlet heat, so reacted-to stories lead the run.
    // Modest boost (bsky term-counts are noisy — many loose matches aren't genuine reactions; the harvest
    // classify is the real gate). Enough to lift a reacted-to story over a coverage-only one, not so much
    // that raw count crowns noise. ENGAGEMENT (likes) weighted higher — a liked post is likelier genuine.
    if (NO_X) st.discourseHeat += Math.min(70, posts.length * 3 + Math.round(st.signals.audienceEngagement / 25));
  });
  deduped = deduped.filter((st) => {
    const g = st.signals;
    const talking = (g.audiencePosts || 0) > 0 || (g.comments || 0) > 0 || g.trend || g.wiki;
    // ENTERTAINMENT-ONLY (owner audit): a viral politician/athlete/general-news subject is dropped
    // here on clear keywords; the finder LLM rejects the name-only cases downstream.
    const ent = isEntertainmentTopic(`${st.headline || ""} ${st.primaryEntity} ${st.overview || ""}`);
    return talking && ent;
  });

  // ── STAGE 2 — REAL POPULARITY (owner: "make sure POPULAR people are talking — 100+ likes"). For
  //    the top survivors, MEASURE X: how many posts already have ≥100 likes, and their peak/total
  //    engagement. This is the DOMINANT ranking signal and a hard top-tier gate. Serialized with 5.5s
  //    spacing for the free tier's 1-req/5s limit; a story we can't measure keeps its pre-filter heat.
  deduped.sort((a, b) => b.discourseHeat - a.discourseHeat);
  const measure = NO_X ? [] : deduped.slice(0, 8); // FREE MODE: no paid X measurement
  for (let i = 0; i < measure.length; i++) {
    const st = measure[i];
    // NOTE: do NOT unref this timer — we deliberately await the QPS delay; unref would let a
    // discovery-only process (no other active handles) exit early and abandon the await (Node exit 13).
    if (i > 0 && xPaceMs) await new Promise((r) => setTimeout(r, xPaceMs));
    const x = await xStatsImpl(buzzTermOf(st)).catch(() => null);
    if (!x) continue;
    st.signals.xPopular = x.popularPosts;      // # posts about it with 100+ likes
    st.signals.xMaxLikes = x.maxLikes;         // the single most-liked reaction
    st.signals.xSumLikes = x.sumLikes;         // total engagement of the popular posts
    // Popularity dominates heat: each 100+-like post is worth real weight, plus a log-scaled bump for
    // total engagement so a 5,000-like wave outranks a 300-like trickle.
    st.discourseHeat += Math.min(120, x.popularPosts * 12 + Math.round(Math.log10(1 + x.sumLikes) * 20));
  }

  for (const st of deduped) {
    st.signals.families = familiesOf(st.signals, st.popularity);
    if (st.signals.families < 2) st.discourseHeat = Math.min(st.discourseHeat, 45);
    // A story may only LEAD if PEOPLE are reacting (owner 2026-07-12) — a trade item with only
    // outlets+wiki (2 families, ZERO reactions) is capped so it can never crown the run over a
    // reddit thread or Bluesky wave. Reacted-to stories climb; coverage-only ones sink.
    if (!hasReactionFamily(st.signals)) st.discourseHeat = Math.min(st.discourseHeat, 45);
    // TOP-TIER GATE (owner): a story where we MEASURED X and found NOBODY with 100+ likes talking is
    // not top-tier — cap it hard so it can never lead (it may still exist as a minor entry). Stories
    // we never measured (rank > 8) are left as-is; only a measured, proven-unpopular story is capped.
    if (!NO_X && st.signals.xPopular === 0) st.discourseHeat = Math.min(st.discourseHeat, 35);
    // Anime-adjacent: heavy demotion — only overwhelming REAL popularity un-caps it.
    if (ANIME_RX.test(`${st.headline || ""} ${st.primaryEntity} ${st.work?.title || ""} ${st.overview || ""}`)) {
      st.signals.animeAdjacent = true;
      const overwhelming = NO_X ? (st.signals.audiencePosts || 0) >= 15 : ((st.signals.xPopular || 0) >= 10 && (st.signals.xMaxLikes || 0) >= 1000);
      if (!overwhelming) st.discourseHeat = Math.min(Math.round(st.discourseHeat * 0.5), 40);
    }
  }
  deduped.sort((a, b) => b.discourseHeat - a.discourseHeat);
  return deduped.slice(0, max);
}
