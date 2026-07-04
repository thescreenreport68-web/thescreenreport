// DISCOVERY (REV 2) — "any top story, any source." Two signals merged:
//   • TMDB trending + now-playing = the WORKS people are watching right now (the subject list).
//   • Reddit hot/top across film/TV subs = the actual DISCOURSE (people arguing) + the anchor posts.
// Match the discourse to the works, rank by discourse heat (comments >> upvotes >> popularity), and
// emit story candidates. Person stories (breakout-buzz) come from TMDB trending-person. No confirmed-
// event gate — the discourse IS the trigger.
import { discoverTMDB } from "../find/sources/tmdb.mjs";
import { discoverReddit } from "../find/sources/reddit.mjs";
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

export async function discoverStories({
  discoverTMDBImpl = discoverTMDB,
  discoverRedditImpl = discoverReddit,
  max = MAX_STORIES_PER_RUN,
  nowMs = null,
} = {}) {
  const now = nowMs ?? Date.now();
  const [tmdb, reddit] = await Promise.all([
    discoverTMDBImpl({ limitEach: 15 }).catch(() => []),
    discoverRedditImpl({ nowMs: now }).catch(() => []),
  ]);

  const works = tmdb.filter((t) => ["trending-movie", "trending-tv", "now-playing", "upcoming"].includes(t.kind));
  const people = tmdb.filter((t) => t.kind === "trending-person");

  const stories = [];

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
