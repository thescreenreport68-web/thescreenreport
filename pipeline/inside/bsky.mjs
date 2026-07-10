// BLUESKY — the keyless raw-fan-post source (REV 3.1). Reddit ended self-serve API keys
// (Responsible Builder Policy, 2026) and keyless reddit JSON is 403 from datacenter IPs, so the
// lane's "real posts by normal people" supply for BREAKING stories comes from Bluesky's public
// AppView search — no credentials, no approval, public posts only. Verbatim by construction
// (the post text IS the quote); the harvest wall + relevance classify still gate every post.
const UA = { "user-agent": "Mozilla/5.0 (compatible; ScreenReportBot)" };

export async function bskySearchPosts(query, { limit = 20, sort = "top", sinceDays = 14, fetchImpl = fetch, nowMs = null } = {}) {
  try {
    const res = await fetchImpl(
      `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=${limit}&sort=${sort}`,
      { headers: UA, signal: AbortSignal.timeout(9000) },
    );
    if (!res.ok) return [];
    const now = nowMs ?? Date.now();
    const maxAgeMs = sinceDays * 864e5;
    return (((await res.json())?.posts) || [])
      .map((p) => {
        const text = (p?.record?.text || "").replace(/\s+/g, " ").trim();
        const createdAt = p?.record?.createdAt || "";
        const rkey = (p?.uri || "").split("/").pop();
        return {
          text,
          handle: p?.author?.handle || "",
          displayName: (p?.author?.displayName || "").trim(),
          createdAt,
          likes: p?.likeCount || 0,
          url: rkey && p?.author?.did ? `https://bsky.app/profile/${p.author.handle || p.author.did}/post/${rkey}` : null,
          atUri: p?.uri || null, // at://did/app.bsky.feed.post/rkey — the official embed's key
        };
      })
      .filter((p) => p.text.length >= 12 && p.text.length <= 600)
      .filter((p) => !p.createdAt || now - Date.parse(p.createdAt) <= maxAgeMs)
      .sort((a, b) => b.likes - a.likes);
  } catch {
    return [];
  }
}
