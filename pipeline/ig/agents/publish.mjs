// AGENT 21 — PUBLISHER (plan §2.2 #21): host the mp4+cover publicly (tsr-media repo),
// post via Zernio with the FULL parameter set, then VERIFY LIVE. Draft-safe by default —
// real publishing requires the orchestrator's explicit --live flag.
// Fresh implementation (no imports from the old lane).
import fs from "node:fs";
import path from "node:path";
import { IG } from "../config.mjs";
import { fetchWithTimeout, sleep } from "../lib/util.mjs"; // sleep used by verifyLive + host HEAD-poll
import { postYouTube } from "../lib/buffer.mjs"; // YouTube Shorts via Buffer (multi-platform 2026-07-13)

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
  // PUT with RETRY (owner 2026-07-14): the GitHub contents API intermittently 5xx's on large mp4
  // uploads, and a single 500 here threw and lost the WHOLE post (hosting is upstream of every
  // platform — that's why a built reel never posted). Retry transient 5xx/429/network with backoff;
  // 4xx fails fast. Re-read the sha each attempt (a partial write can create the blob).
  let data;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let sha;
    try { const cur = await fetchWithTimeout(url, { headers: ghHeaders() }, 15000); if (cur.ok) sha = (await cur.json()).sha; } catch {}
    try {
      const res = await fetchWithTimeout(
        url,
        { method: "PUT", headers: ghHeaders(), body: JSON.stringify({ message: `host ${rel}`, content, branch: "main", ...(sha ? { sha } : {}) }) },
        180000,
      );
      if (res.ok) { data = await res.json(); break; }
      const body = (await res.text().catch(() => "")).slice(0, 200);
      if (res.status < 500 && res.status !== 429) throw new Error(`host ${rel}: HTTP ${res.status} ${body}`); // non-transient
      if (attempt === 4) throw new Error(`host ${rel}: HTTP ${res.status} after 4 tries ${body}`);
    } catch (e) {
      if (attempt === 4) throw e;
    }
    await sleep(attempt * 4000); // backoff 4s / 8s / 12s
  }
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

// Create a Zernio post with RETRY — a transient 5xx/429 was dropping a single platform (Bam's IG
// failed while FB went through). 4xx fails fast (a real bad request). (owner 2026-07-14)
async function zernioCreate(body, label = "") {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetchWithTimeout(`${IG.zernio.base}/posts`, { method: "POST", headers: zHeaders(), body: JSON.stringify(body) }, 60000);
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if (res.status < 500 && res.status !== 429) throw new Error(`zernio${label} ${res.status}: ${JSON.stringify(data).slice(0, 250)}`);
    if (attempt === 3) throw new Error(`zernio${label} ${res.status} after 3 tries: ${JSON.stringify(data).slice(0, 200)}`);
    await sleep(attempt * 3000);
  }
}

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
  const data = await zernioCreate(body, "");
  // capability discovery (plan agent 21): which of our reels params did the bridge echo back?
  const echoed = JSON.stringify(data);
  const paramsHonored = ["isAiGenerated", "audioName", "shareToFeed", "instagramThumbnail", "firstComment"].filter((k) => echoed.includes(k));
  // Zernio returns the post id as `_id` (Mongo-style) — verified live 2026-07-13; the older
  // id/post.id/data.id guesses all missed it, so zernioId came back undefined and verifyLive/tracking
  // couldn't run. `_id` first now.
  return { id: data._id || data.id || data.post?._id || data.post?.id || data.data?._id || data.data?.id, paramsHonored, raw: data };
}

// Facebook via Zernio — same bridge as Instagram, platform "facebook" + the FB Page account. Kept
// SEPARATE from postToInstagram so the live IG path is never touched. Its own caption (platformMeta).
export async function postToFacebook({ videoUrl, coverUrl, caption, whenISO, live = false }) {
  const body = {
    content: caption,
    status: live ? "scheduled" : "draft",
    ...(live && whenISO ? { scheduledFor: whenISO, timezone: IG.slots.postTz } : {}),
    platforms: [{ accountId: IG.zernio.fbAccountId, platform: "facebook" }],
    mediaItems: [{ type: "video", url: videoUrl, ...(coverUrl ? { thumbnail: coverUrl } : {}) }],
    isAiGenerated: IG.zernio.isAiGenerated,
    shareToFeed: true,
  };
  const data = await zernioCreate(body, "(fb)");
  return { id: data._id || data.id || data.post?._id || data.post?.id || data.data?._id || data.data?.id };
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

// per-platform kill switch: data/ig/PAUSED_INSTAGRAM | PAUSED_FACEBOOK | PAUSED_YOUTUBE
function platformPaused(platform) {
  return fs.existsSync(path.join(IG.dataDir, `PAUSED_${platform.toUpperCase()}`));
}

// Fan ONE build out to every enabled platform. Host the video+cover ONCE, then post to each,
// error-ISOLATED (one platform failing never blocks the others). Instagram posts FIRST and exactly as
// before (its own proven caption); Facebook (Zernio) + YouTube (Buffer) use platformMeta metadata.
export async function publish({ job, mp4, cover, whenISO, live = false }) {
  const videoUrl = await hostFile(mp4, `${job.id}.mp4`);
  const coverUrl = cover ? await hostFile(cover, `${job.id}-cover.jpg`) : null;
  const enabled = (IG.platforms || ["instagram"]).filter((p) => !platformPaused(p));
  const results = [];
  for (const platform of enabled) {
    try {
      if (platform === "instagram") {
        const post = await postToInstagram({ videoUrl, coverUrl, caption: job.caption.full, firstComment: job.caption.firstComment, whenISO, live });
        results.push({ platform, id: post.id, ok: Boolean(post.id), paramsHonored: post.paramsHonored });
      } else if (platform === "facebook") {
        const cap = job.platformMeta?.facebook?.full;
        if (!cap) { results.push({ platform, ok: false, error: "no facebook metadata" }); continue; }
        const post = await postToFacebook({ videoUrl, coverUrl, caption: cap, whenISO, live });
        results.push({ platform, id: post.id, ok: Boolean(post.id) });
      } else if (platform === "youtube") {
        const yt = job.platformMeta?.youtube;
        if (!yt?.title) { results.push({ platform, ok: false, error: "no youtube metadata" }); continue; }
        const post = await postYouTube({ videoUrl, title: yt.title, description: yt.description, whenISO, draft: !live });
        results.push({ platform, id: post.id, ok: post.ok, error: post.error });
      }
    } catch (e) {
      results.push({ platform, ok: false, error: String(e.message || e).slice(0, 200) });
    }
  }
  return { videoUrl, coverUrl, mode: live ? "scheduled" : "draft", whenISO: live ? whenISO : null, results };
}
