// X / TWITTER SEARCH via twitterapi.io (REV 5 — owner: "people talking about our content, embedded").
// The keyless syndication CDN can EMBED a known tweet but can't SEARCH; twitterapi.io's advanced
// search finds the real reaction posts, and we hand their IDs to the existing syndication cache so
// each becomes a verbatim, embeddable tweet card — the same proven path page-scanned tweets use.
// Reads TWITTERAPI_KEY (the gossip lane already uses this exact provider); no key → [] (graceful).
const HOST = "https://api.twitterapi.io";

// Return the IDs of recent, engaged, on-topic reaction tweets for a subject. IDs only — the caller
// resolves them through cacheTweets() (syndication) for verbatim text + the embed. Newest-first from
// the API, we keep the most-liked so the embeds are real discourse, not the first random reply.
export async function xSearchIds(term, { max = 12, minLikes = 0, fetchImpl = fetch } = {}) {
  const key = process.env.TWITTERAPI_KEY;
  if (!key || !term) return [];
  // Standard Twitter search operators: English, no retweets, exclude pure links/spam. "Top" query
  // type biases toward engaged posts (real reactions) over the raw firehose.
  const q = `${term} lang:en -filter:retweets -filter:replies`;
  try {
    const r = await fetchImpl(
      `${HOST}/twitter/tweet/advanced_search?query=${encodeURIComponent(q)}&queryType=Top`,
      { headers: { "X-API-Key": key }, signal: AbortSignal.timeout(12000) },
    );
    if (!r.ok) return [];
    const j = await r.json();
    const tweets = j?.tweets || j?.data?.tweets || j?.data || [];
    return tweets
      .filter((t) => (t.likeCount ?? t.favorite_count ?? 0) >= minLikes)
      .map((t) => ({ id: String(t.id ?? t.id_str ?? ""), likes: t.likeCount ?? t.favorite_count ?? 0 }))
      .filter((t) => /^\d{5,25}$/.test(t.id))
      .sort((a, b) => b.likes - a.likes)
      .slice(0, max)
      .map((t) => t.id);
  } catch {
    return [];
  }
}
