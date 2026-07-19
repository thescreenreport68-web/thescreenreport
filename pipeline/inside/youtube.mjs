// YOUTUBE COMMENTS — the reaction co-spine (owner upgrade 2026-07-17, replacing the dead X search).
// The official YouTube Data API v3 with the project's existing YOUTUBE_API_KEY: search the story's
// trailer/announcement video, then pull the TOP audience comments (relevance-ranked, likeCount
// attached — live probe returned real 40k–56k-like trailer comments). This is "popular people
// talking" at a scale X never gave us, free: ~103 quota units per story (search 100 + comments 1-3)
// against a 10,000/day allowance. Comments on the story's OWN video are STRUCTURALLY subject-linked
// (`linked: true` → they skip the text admission gate but still pass spam/classify).
// Fail-soft everywhere: no key, quota exhausted, comments disabled → [] and the other sources carry.
const API = "https://www.googleapis.com/youtube/v3";

const clean = (s) =>
  String(s || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")            // commentThreads returns HTML-ish textDisplay; prefer textOriginal but belt-and-suspenders
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

// ── QUOTA SAFETY (AUTOMATION_REGISTRY §3.25, 2026-07-19) ────────────────────────────────────────
// This lane is the ONLY consumer of the shared 10,000-unit/day pool. A healthy tick publishes on its
// first candidate and spends ~102 units (search 100 + ≤2 comments), i.e. ~12%/day — but the code path
// permits walking 24 candidates, which is 2,448/tick = 294%/day. Nothing bounded that, and worse, a
// 403 quotaExceeded was swallowed by the callers' bare `catch { return [] }` — INDISTINGUISHABLE from
// "no videos found". The lane would silently lose its strongest reaction source with no alarm.
// Two guards, both fail-soft and both per-process (a run = a process, so this is a per-run budget):
const COST = { search: 100, commentThreads: 1 };
const RUN_BUDGET = Number(process.env.INSIDE_YT_RUN_BUDGET) || 1200; // ~12 candidates; a healthy tick uses 102
let spent = 0;
let quotaBlocked = false;
export const ytBudget = () => ({ spent, budget: RUN_BUDGET, quotaBlocked });
export const ytBudgetReset = () => { spent = 0; quotaBlocked = false; }; // tests only

class YtQuotaError extends Error {}

async function yt(fetchImpl, path, params, key) {
  // Once the API says we are out, stop asking — every further call is guaranteed to fail and, if
  // Google charges for rejected calls, actively harmful.
  if (quotaBlocked) throw new YtQuotaError("yt quota exhausted earlier this run");
  const cost = COST[path] ?? 1;
  if (spent + cost > RUN_BUDGET) throw new YtQuotaError(`yt run budget ${RUN_BUDGET} would be exceeded (spent ${spent})`);
  spent += cost;
  const res = await fetchImpl(`${API}/${path}?${new URLSearchParams({ ...params, key }).toString()}`, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) {
    // 403 is the quota/permission status. Read the body so a genuine permission error is not
    // mislabelled, and LOG IT — a silent quota wall was the actual defect.
    if (res.status === 403) {
      const body = await res.text().catch(() => "");
      if (/quota|rateLimit/i.test(body)) {
        quotaBlocked = true;
        console.log(`  ⚠ YouTube QUOTA EXHAUSTED (403) after ${spent} units this run — harvest continues on Bluesky/pages`);
        throw new YtQuotaError("quotaExceeded");
      }
      console.log(`  ⚠ YouTube 403 (not quota): ${body.slice(0, 140)}`);
    }
    throw new Error(`yt ${path} HTTP ${res.status}`);
  }
  return res.json();
}

// Find the story's most relevant videos (trailer/announcement/interview). Returns [{videoId, title,
// channelTitle, publishedAt}]. `query` should already be subject-disambiguated by the caller.
export async function ytSearchVideos(query, { max = 3, key = process.env.YOUTUBE_API_KEY, fetchImpl = fetch, publishedAfterDays = 60, nowMs = null } = {}) {
  if (!key) return [];
  try {
    const after = new Date((nowMs ?? Date.now()) - publishedAfterDays * 864e5).toISOString();
    const data = await yt(fetchImpl, "search", {
      part: "snippet", q: query, type: "video", maxResults: String(Math.min(max * 2, 10)),
      order: "relevance", relevanceLanguage: "en", publishedAfter: after,
    }, key);
    return (data.items || [])
      .map((it) => ({
        videoId: it.id?.videoId,
        title: clean(it.snippet?.title),
        channelTitle: clean(it.snippet?.channelTitle),
        publishedAt: it.snippet?.publishedAt || "",
      }))
      .filter((v) => v.videoId)
      .slice(0, max);
  } catch {
    return [];
  }
}

// Top comments for a video, relevance-ranked (YouTube's own "top comments"), likeCount attached.
export async function ytTopComments(videoId, { max = 40, key = process.env.YOUTUBE_API_KEY, fetchImpl = fetch } = {}) {
  if (!key || !videoId) return [];
  try {
    const data = await yt(fetchImpl, "commentThreads", {
      part: "snippet", videoId, maxResults: String(Math.min(max, 100)), order: "relevance", textFormat: "plainText",
    }, key);
    return (data.items || [])
      .map((it) => {
        const c = it.snippet?.topLevelComment?.snippet || {};
        return {
          text: clean(c.textOriginal || c.textDisplay),
          author: clean(c.authorDisplayName).replace(/^@/, ""),
          likes: c.likeCount || 0,
          createdAt: c.publishedAt || "",
        };
      })
      .filter((c) => c.text.length >= 12 && c.text.length <= 600);
  } catch {
    return []; // comments disabled / quota / key issues — fail soft
  }
}

// One-call story harvest: search the subject's videos, pull top comments from the best `videos` of
// them, merge, rank by likes. The caller passes a DISAMBIGUATED query (subject card applied).
export async function ytStoryComments(query, { videos = 2, perVideo = 30, key = process.env.YOUTUBE_API_KEY, fetchImpl = fetch, nowMs = null } = {}) {
  if (!key) return { comments: [], videos: [] };
  const vids = await ytSearchVideos(query, { max: videos, key, fetchImpl, nowMs });
  const lists = await Promise.all(vids.map((v) => ytTopComments(v.videoId, { max: perVideo, key, fetchImpl })));
  const seen = new Set();
  const comments = lists
    .flatMap((list, i) => list.map((c) => ({ ...c, videoId: vids[i].videoId, videoTitle: vids[i].title })))
    .filter((c) => {
      const k = c.text.toLowerCase().slice(0, 80);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.likes - a.likes);
  return { comments, videos: vids };
}
