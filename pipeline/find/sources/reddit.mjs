// Reddit — the richest source of REAL audience discourse (people arguing, not just headlines). Keyless
// public JSON, modeled on the one Reddit call proven to work in this repo (breakout.mjs redditVelocity):
// a UNIQUE descriptive User-Agent is required (generic UAs get 403/429). Fail-closed (return []) on any
// non-200 so a Reddit outage never crashes a run. Used two ways: (1) DISCOVERY — hot/top across film/TV
// subs → what people are talking about now; (2) HARVEST — search.json per subject → real anchor posts.
const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";
const DEFAULT_SUBS = ["movies", "television", "boxoffice", "marvelstudios", "DC_Cinematic", "StarWars", "Music"];

const strip = (s) => (s || "").replace(/\s+/g, " ").trim();

async function getJson(url, fetchImpl) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    t.unref?.();
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { "User-Agent": UA, accept: "application/json" } });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function mapPost(c, nowMs) {
  const d = c?.data;
  if (!d || d.stickied || d.over_18) return null;
  const ageMin = Math.max(0, Math.round((nowMs - (d.created_utc || 0) * 1000) / 60000));
  return {
    id: d.id,
    subreddit: d.subreddit,
    title: strip(d.title),
    selftext: strip(d.selftext).slice(0, 1200),
    permalink: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
    url: d.url && !/reddit\.com/.test(d.url) ? d.url : null, // the external article the post points to, if any
    score: d.score || 0,
    numComments: d.num_comments || 0,
    createdUtc: d.created_utc || 0,
    ageMin,
  };
}

// DISCOVERY: freshest high-discussion posts across the film/TV subs.
export async function discoverReddit({ subs = DEFAULT_SUBS, limit = 40, freshHours = 72, minComments = 25, fetchImpl = fetch, nowMs = null } = {}) {
  const now = nowMs ?? Date.now();
  const maxAge = freshHours * 60;
  const perSub = await Promise.all(
    subs.map(async (sub) => {
      // hot is flagged occasionally-flaky; top?t=day is reliable and IS "what got discussed today".
      const [hot, top] = await Promise.all([
        getJson(`https://www.reddit.com/r/${sub}/hot.json?limit=${limit}`, fetchImpl),
        getJson(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=${limit}`, fetchImpl),
      ]);
      const posts = [...(hot?.data?.children || []), ...(top?.data?.children || [])];
      return posts.map((c) => mapPost(c, now)).filter(Boolean);
    }),
  );
  const seen = new Set();
  const out = [];
  for (const p of perSub.flat()) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (p.ageMin > maxAge) continue;
    if (p.numComments < minComments) continue; // discussion volume = the real discourse signal
    out.push(p);
  }
  out.sort((a, b) => b.numComments - a.numComments);
  return out;
}

// HARVEST: real audience posts ABOUT a specific subject (anchor posts for a story). search.json is the
// proven-working endpoint. Returns the most-discussed matching posts.
export async function redditSearchPosts(query, { subs = DEFAULT_SUBS, limit = 25, sinceDays = 14, fetchImpl = fetch, nowMs = null } = {}) {
  const now = nowMs ?? Date.now();
  const srList = subs.join("+");
  const q = encodeURIComponent(`"${query}"`);
  const j = await getJson(`https://www.reddit.com/r/${srList}/search.json?q=${q}&restrict_sr=1&sort=top&t=month&limit=${limit}`, fetchImpl);
  const posts = (j?.data?.children || []).map((c) => mapPost(c, now)).filter(Boolean);
  const maxAge = sinceDays * 24 * 60;
  return posts.filter((p) => p.ageMin <= maxAge).sort((a, b) => b.numComments - a.numComments);
}

// Top real comments on a post (the actual "what people are saying" quotes). Comments JSON = the post
// URL + ".json". Returns short, quotable, upvoted comments (verbatim — the harvest wall re-checks them).
export async function redditTopComments(permalink, { limit = 8, maxLen = 280, fetchImpl = fetch } = {}) {
  if (!permalink) return [];
  const j = await getJson(`${permalink.replace(/\/$/, "")}.json?sort=top&limit=${limit}`, fetchImpl);
  const listing = Array.isArray(j) ? j[1] : null;
  const kids = listing?.data?.children || [];
  const out = [];
  for (const c of kids) {
    const d = c?.data;
    if (!d || d.stickied || !d.body || d.body === "[deleted]" || d.body === "[removed]") continue;
    const body = strip(d.body);
    if (body.length < 12 || body.length > maxLen) continue; // short + quotable only
    if (/^https?:\/\//.test(body)) continue;
    out.push({ text: body, score: d.score || 0, author: d.author || "" });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => b.score - a.score);
}
