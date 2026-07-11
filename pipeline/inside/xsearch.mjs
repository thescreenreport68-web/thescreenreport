// X / TWITTER SEARCH via twitterapi.io (REV 5 — owner: "people talking about our content, embedded").
// The keyless syndication CDN can EMBED a known tweet but can't SEARCH; twitterapi.io's advanced
// search finds the real reaction posts, and we hand their IDs to the existing syndication cache so
// each becomes a verbatim, embeddable tweet card — the same proven path page-scanned tweets use.
// Reads TWITTERAPI_KEY (the gossip lane already uses this exact provider); no key → [] (graceful).
const HOST = "https://api.twitterapi.io";

const likesOf = (t) => t.likeCount ?? t.favorite_count ?? t.favoriteCount ?? 0;

async function search(term, { minLikes = 0, fetchImpl }) {
  const key = process.env.TWITTERAPI_KEY;
  if (!key || !term) return [];
  // English, no retweets — KEEP replies (a reply IS a reaction). min_faves:N (owner: "popular people,
  // 100+ likes") makes the search itself return only posts that ALREADY have N+ likes — so we embed
  // real discourse, not fresh 0-like posts by nobodies. queryType=Latest is the one that returns
  // results on twitterapi.io (Top comes back empty, verified 2026-07-11).
  const q = `${term}${minLikes > 0 ? ` min_faves:${minLikes}` : ""} lang:en -filter:retweets`;
  try {
    const r = await fetchImpl(
      `${HOST}/twitter/tweet/advanced_search?query=${encodeURIComponent(q)}&queryType=Latest`,
      { headers: { "X-API-Key": key }, signal: AbortSignal.timeout(12000) },
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (j?.tweets || j?.data?.tweets || j?.data || [])
      .map((t) => ({ id: String(t.id ?? t.id_str ?? ""), likes: likesOf(t) }))
      .filter((t) => /^\d{5,25}$/.test(t.id))
      .sort((a, b) => b.likes - a.likes);
  } catch {
    return [];
  }
}

// Embeddable tweet IDs for a subject, MOST-LIKED first. Prefer posts with ≥minLikes (popular people
// talking); if the story is too fresh to have enough, top up with the most-liked recent posts so a
// genuinely-breaking story is not starved. IDs only — the caller resolves them via cacheTweets().
export async function xSearchIds(term, { max = 12, minLikes = 100, fetchImpl = fetch } = {}) {
  let posts = await search(term, { minLikes, fetchImpl });
  if (posts.length < 3 && minLikes > 0) {
    // too few popular posts — this story is fresh or niche; fall back to the most-liked recent posts.
    const any = await search(term, { minLikes: 0, fetchImpl });
    const seen = new Set(posts.map((p) => p.id));
    posts = [...posts, ...any.filter((p) => !seen.has(p.id))];
  }
  return posts.slice(0, max).map((p) => p.id);
}

// Popularity of a STORY on X (owner: "is the story actually popular — are people with hundreds of
// likes talking?"). Counts posts with ≥minLikes and their peak/total engagement. One paced call.
export async function xSearchStats(term, { minLikes = 100, fetchImpl = fetch } = {}) {
  const posts = await search(term, { minLikes, fetchImpl });
  const likes = posts.map((p) => p.likes);
  return {
    popularPosts: posts.length,                        // how many 100+-like posts about it
    maxLikes: likes.length ? Math.max(...likes) : 0,   // the single most-liked reaction
    sumLikes: likes.reduce((a, b) => a + b, 0),        // total engagement of the popular posts
    topIds: posts.slice(0, 8).map((p) => p.id),
  };
}
