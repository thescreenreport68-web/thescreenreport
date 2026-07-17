// HACKER NEWS (Algolia) — niche fourth voice (owner upgrade 2026-07-17). Keyless full-text comment
// search (live-verified), wired ONLY for tech-adjacent entertainment stories (AI-in-film, streaming
// platform moves, studio/tech business) where HN genuinely reacts; useless for celebrity/music, so
// the caller gates on TECH_RX. Fail-soft → [].
export const TECH_RX = /\b(AI|artificial intelligence|streaming|platform|algorithm|Netflix|studio tech|VFX|CGI|deepfake|machine learning|tech|startup|subscription|password sharing|box office data)\b/i;

export async function hnComments(query, { limit = 15, fetchImpl = fetch, sinceDays = 14, nowMs = null } = {}) {
  try {
    const now = nowMs ?? Date.now();
    const since = Math.floor((now - sinceDays * 864e5) / 1000);
    const res = await fetchImpl(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=comment&numericFilters=created_at_i>${since}&hitsPerPage=${Math.min(limit, 30)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/\s+/g, " ").trim();
    return ((await res.json())?.hits || [])
      .map((h) => ({ text: strip(h.comment_text), author: h.author || "", likes: h.points || 0, createdAt: h.created_at || "" }))
      .filter((c) => c.text.length >= 20 && c.text.length <= 600);
  } catch {
    return [];
  }
}
