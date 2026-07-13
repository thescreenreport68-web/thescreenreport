// AGENT 21 — PUBLISHER (plan §2.2 #21): host the mp4+cover publicly (tsr-media repo),
// post via Zernio with the FULL parameter set, then VERIFY LIVE. Draft-safe by default —
// real publishing requires the orchestrator's explicit --live flag.
// Fresh implementation (no imports from the old lane).
import fs from "node:fs";
import path from "node:path";
import { IG } from "../config.mjs";
import { fetchWithTimeout, sleep } from "../lib/util.mjs"; // sleep used by verifyLive + host HEAD-poll

const GH_API = "https://api.github.com";
const ghHeaders = () => ({
  Authorization: `Bearer ${process.env.TSR_GH_TOKEN || process.env.GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "tsr-ig",
});

export async function hostFile(localPath, destName) {
  const [owner, repo] = IG.host.repo.split("/");
  const rel = `${IG.host.dir}/${destName}`;
  const url = `${GH_API}/repos/${owner}/${repo}/contents/${rel}`;
  const content = fs.readFileSync(localPath).toString("base64");
  // existing sha (idempotent re-host)
  let sha;
  try {
    const cur = await fetchWithTimeout(url, { headers: ghHeaders() }, 15000);
    if (cur.ok) sha = (await cur.json()).sha;
  } catch {}
  const res = await fetchWithTimeout(
    url,
    {
      method: "PUT",
      headers: ghHeaders(),
      body: JSON.stringify({ message: `host ${rel}`, content, branch: "main", ...(sha ? { sha } : {}) }),
    },
    180000,
  );
  if (!res.ok) throw new Error(`host ${rel}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const publicUrl = data?.content?.download_url || `https://raw.githubusercontent.com/${owner}/${repo}/main/${rel}`;
  // the bridge fetches this URL — confirm it actually serves before handing it over
  for (let i = 0; i < 6; i++) {
    try {
      const head = await fetchWithTimeout(publicUrl, { method: "HEAD" }, 15000);
      if (head.ok) return publicUrl;
    } catch {}
    await sleep(5000);
  }
  throw new Error(`hosted URL never became reachable: ${publicUrl}`);
}

const zHeaders = () => ({ Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, "Content-Type": "application/json" });

export async function postToInstagram({ videoUrl, coverUrl, caption, firstComment, whenISO, live = false }) {
  const body = {
    content: caption,
    status: live ? "scheduled" : "draft",
    ...(live && whenISO ? { scheduledFor: whenISO, timezone: IG.slots.postTz } : {}),
    platforms: [{ accountId: IG.zernio.igAccountId, platform: "instagram" }],
    mediaItems: [{ type: "video", url: videoUrl, ...(coverUrl ? { thumbnail: coverUrl } : {}) }],
    // reels extras per docs.zernio.com (unknown fields are tolerated; we log what sticks)
    isAiGenerated: IG.zernio.isAiGenerated,
    audioName: IG.zernio.audioName,
    shareToFeed: true,
    ...(coverUrl ? { instagramThumbnail: coverUrl } : {}),
    ...(firstComment ? { firstComment } : {}),
  };
  const res = await fetchWithTimeout(`${IG.zernio.base}/posts`, { method: "POST", headers: zHeaders(), body: JSON.stringify(body) }, 60000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`zernio ${res.status}: ${JSON.stringify(data).slice(0, 250)}`);
  // capability discovery (plan agent 21): which of our reels params did the bridge echo back?
  const echoed = JSON.stringify(data);
  const paramsHonored = ["isAiGenerated", "audioName", "shareToFeed", "instagramThumbnail", "firstComment"].filter((k) => echoed.includes(k));
  // Zernio returns the post id as `_id` (Mongo-style) — verified live 2026-07-13; the older
  // id/post.id/data.id guesses all missed it, so zernioId came back undefined and verifyLive/tracking
  // couldn't run. `_id` first now.
  return { id: data._id || data.id || data.post?._id || data.post?.id || data.data?._id || data.data?.id, paramsHonored, raw: data };
}

export async function zernioStatus(postId) {
  const res = await fetchWithTimeout(`${IG.zernio.base}/posts/${postId}`, { headers: zHeaders() }, 30000);
  const data = await res.json().catch(() => ({}));
  const p = data.platforms?.[0] || data.post?.platforms?.[0] || {};
  return { status: p.status || data.status, permalink: p.url || p.permalink || null, raw: data };
}

// Verify-live loop (plan §4 publish rule): confirm published within ~15 min of the slot.
export async function verifyLive(postId, { timeoutMin = 15, everySec = 60 } = {}) {
  const until = Date.now() + timeoutMin * 60000;
  let last = null;
  while (Date.now() < until) {
    last = await zernioStatus(postId).catch(() => null);
    if (last?.status === "published") return { live: true, permalink: last.permalink };
    if (last?.status === "failed") return { live: false, failed: true, raw: last.raw };
    await sleep(everySec * 1000);
  }
  return { live: false, timedOut: true, last };
}

export async function publish({ job, mp4, cover, whenISO, live = false }) {
  const videoUrl = await hostFile(mp4, `${job.id}.mp4`);
  const coverUrl = cover ? await hostFile(cover, `${job.id}-cover.jpg`) : null;
  const caption = job.caption.full;
  const post = await postToInstagram({ videoUrl, coverUrl, caption, firstComment: job.caption.firstComment, whenISO, live });
  return { videoUrl, coverUrl, zernioId: post.id, paramsHonored: post.paramsHonored, mode: live ? "scheduled" : "draft", whenISO: live ? whenISO : null };
}
