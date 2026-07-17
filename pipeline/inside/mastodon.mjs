// MASTODON — third reaction voice (owner upgrade 2026-07-17). Keyless PUBLIC hashtag timelines on the
// big instances (live-verified: /api/v1/timelines/tag/<tag> returns federated posts without auth;
// full-text /api/v2/search is auth-gated so discovery here is HASHTAG-ONLY — works when fandoms tag).
// English-filtered, HTML stripped, likes = favourites. Fail-soft: any error → [].
const INSTANCES = ["https://mastodon.social", "https://mstdn.social"];

const strip = (html) =>
  String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>\s*<p>/gi, " — ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

// Hashtag candidates for a subject: "Toy Story 5" → ToyStory5; a work title beats the bare name.
// An AMBIGUOUS single-token name NEVER becomes a tag (#Beck would collide exactly like the bare
// search did) — no workTitle means no Mastodon for that story, which is the correct fail-closed.
export function tagCandidates(card) {
  const tags = [];
  const toTag = (s) => String(s || "").replace(/[^a-zA-Z0-9 ]+/g, "").trim().split(/\s+/).map((w) => w[0]?.toUpperCase() + w.slice(1)).join("");
  if (card?.workTitle) tags.push(toTag(card.workTitle));
  if (card?.name && !card.ambiguous) tags.push(toTag(card.name));
  return [...new Set(tags.filter((t) => t.length >= 4))].slice(0, 2);
}

export async function mastoTagPosts(tag, { limit = 20, fetchImpl = fetch, sinceDays = 14, nowMs = null } = {}) {
  const now = nowMs ?? Date.now();
  for (const base of INSTANCES) {
    try {
      const res = await fetchImpl(`${base}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${Math.min(limit, 40)}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const posts = (await res.json()) || [];
      const mapped = posts
        .filter((p) => !p.language || p.language === "en")
        .map((p) => ({
          text: strip(p.content),
          author: strip(p.account?.display_name || p.account?.username || ""),
          likes: p.favourites_count || 0,
          createdAt: p.created_at || "",
        }))
        .filter((p) => p.text.length >= 12 && p.text.length <= 600)
        .filter((p) => !p.createdAt || now - Date.parse(p.createdAt) <= sinceDays * 864e5);
      if (mapped.length) return mapped;
    } catch { /* try the next instance */ }
  }
  return [];
}
