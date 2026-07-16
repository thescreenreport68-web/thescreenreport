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

// GitHub API JSON call with retry on 5xx/429/network (git Data API endpoints). 4xx throws immediately.
async function ghApi(method, apiPath, body, { tries = 5, timeout = 180000 } = {}) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetchWithTimeout(`${GH_API}${apiPath}`, { method, headers: ghHeaders(), ...(body ? { body: JSON.stringify(body) } : {}) }, timeout);
      if (res.ok) return await res.json();
      const txt = (await res.text().catch(() => "")).slice(0, 150);
      last = new Error(`${method} ${apiPath}: HTTP ${res.status} ${txt}`);
      if (res.status < 500 && res.status !== 429) throw last; // non-transient
    } catch (e) { last = e; if (/HTTP 4\d\d/.test(String(e.message))) throw e; }
    if (attempt < tries) await sleep(Math.min(60000, 5000 * 2 ** (attempt - 1))); // 5,10,20,40,60s
  }
  throw last;
}

// FALLBACK host path via the git Data API (blob → tree → commit → ref). The contents API base64-INLINES
// the whole mp4 and is documented for small files; it intermittently 5xx's on large reels (it dropped a
// fully-built video on 2026-07-15). The blobs API is built for large binaries, so this is a SECOND,
// independent upload path — a built reel is never lost to one endpoint flaking. (owner 2026-07-16)
async function hostViaGitData(owner, repo, rel, contentB64) {
  const base = `/repos/${owner}/${repo}`;
  const blob = await ghApi("POST", `${base}/git/blobs`, { content: contentB64, encoding: "base64" }); // content-addressed → reusable across retries
  // commit + fast-forward the ref; on a concurrent write to tsr-media main (the 14-day pruner / another
  // lane) the PATCH 409/422s non-fast-forward → re-read HEAD and rebuild the tree+commit off the fresh
  // parent so a built reel is never dropped by a harmless race. (review 2026-07-16)
  for (let attempt = 1; attempt <= 4; attempt++) {
    const ref = await ghApi("GET", `${base}/git/ref/heads/main`, null, { timeout: 30000 });
    const baseCommit = await ghApi("GET", `${base}/git/commits/${ref.object.sha}`, null, { timeout: 30000 });
    const tree = await ghApi("POST", `${base}/git/trees`, { base_tree: baseCommit.tree.sha, tree: [{ path: rel, mode: "100644", type: "blob", sha: blob.sha }] });
    const commit = await ghApi("POST", `${base}/git/commits`, { message: `host ${rel}`, tree: tree.sha, parents: [ref.object.sha] });
    try {
      await ghApi("PATCH", `${base}/git/refs/heads/main`, { sha: commit.sha, force: false });
      return;
    } catch (e) {
      if (attempt === 4 || !/HTTP 4(09|22)/.test(String(e.message))) throw e; // only a non-ff conflict is retryable
      await sleep(2000 * attempt);
    }
  }
}

export async function hostFile(localPath, destName) {
  const [owner, repo] = IG.host.repo.split("/");
  const rel = `${IG.host.dir}/${destName}`;
  const url = `${GH_API}/repos/${owner}/${repo}/contents/${rel}`;
  const content = fs.readFileSync(localPath).toString("base64");
  // NEVER lose a fully-built reel to a transient hosting error (owner 2026-07-16: a GitHub 500 threw away a
  // built video — hosting is upstream of EVERY platform). TWO independent upload paths: (1) the contents
  // API PUT with 6 exponential-backoff retries, then (2) a git Data API blob→tree→commit fallback (built
  // for large binaries). Only throw if BOTH fail. Re-read the sha each attempt (a partial write can exist).
  let ok = false;
  for (let attempt = 1; attempt <= 6 && !ok; attempt++) {
    let sha;
    try { const cur = await fetchWithTimeout(url, { headers: ghHeaders() }, 15000); if (cur.ok) sha = (await cur.json()).sha; } catch {}
    try {
      const res = await fetchWithTimeout(url, { method: "PUT", headers: ghHeaders(), body: JSON.stringify({ message: `host ${rel}`, content, branch: "main", ...(sha ? { sha } : {}) }), }, 180000);
      if (res.ok) { ok = true; break; }
      const body = (await res.text().catch(() => "")).slice(0, 150);
      if (res.status < 500 && res.status !== 429) { console.error(`  host ${rel}: HTTP ${res.status} ${body} — trying git-data fallback`); break; } // 4xx → fallback
    } catch (e) { if (attempt === 6) console.error(`  host ${rel}: ${String(e.message).slice(0, 120)}`); }
    if (attempt < 6) await sleep(Math.min(60000, 5000 * 2 ** (attempt - 1))); // 5,10,20,40,60s
  }
  if (!ok) await hostViaGitData(owner, repo, rel, content); // throws only if this INDEPENDENT path also fails
  // Past here the file IS uploaded (both paths throw on real failure). Confirm the raw CDN serves it before
  // handing the URL to the bridge — but a slow CDN warm-up must NOT throw away a fully-built + uploaded reel
  // (recordBuilt already ran, so scout won't rebuild it → permanent loss). Return it either way. (review 2026-07-16)
  const publicUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${rel}`;
  for (let i = 0; i < 10; i++) {
    try {
      const head = await fetchWithTimeout(publicUrl, { method: "HEAD" }, 15000);
      if (head.ok) return publicUrl;
    } catch {}
    await sleep(5000);
  }
  console.warn(`  hosted OK but raw CDN not yet serving ${rel} — returning anyway (upload succeeded; CDN is warming up)`);
  return publicUrl;
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

// FB posts +3h after the IG slot, clamped to 23:30 LA the same day (the 22:00 slot would otherwise
// spill to 01:00 next day — wrong scheduledDay + a dead-hour post). (owner audit 2026-07-16)
export function shiftFbSlot(whenISO, shiftH = 3) {
  const t = new Date(new Date(whenISO).getTime() + shiftH * 3600e3);
  // LA hour of the shifted time — clamp anything past 23:30 LA back to 23:30
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: IG.slots.postTz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(t).reduce((a, p) => ((a[p.type] = p.value), a), {});
  const laMinutes = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  const origParts = new Intl.DateTimeFormat("en-US", { timeZone: IG.slots.postTz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(whenISO)).reduce((a, p) => ((a[p.type] = p.value), a), {});
  const origMinutes = parseInt(origParts.hour, 10) * 60 + parseInt(origParts.minute, 10);
  if (laMinutes < origMinutes || laMinutes > 23 * 60 + 30) {
    // crossed midnight LA (or clamped): cap at 23:30 LA = original + (23:30 − orig)
    return new Date(new Date(whenISO).getTime() + Math.max(0, 23 * 60 + 30 - origMinutes) * 60000).toISOString();
  }
  return t.toISOString();
}

// Fan ONE ALREADY-HOSTED reel out to every enabled platform, error-ISOLATED (one platform failing
// never blocks the others). Takes URLs + metadata directly so the DRAIN path (a built reel recovered
// from a prior run) can post without re-hosting or re-building. (owner audit 2026-07-16)
export async function publishHosted({ id, caption, platformMeta, videoUrl, coverUrl = null, whenISO, live = false }) {
  const enabled = (IG.platforms || ["instagram"]).filter((p) => !platformPaused(p));
  const results = [];
  for (const platform of enabled) {
    try {
      if (platform === "instagram") {
        const post = await postToInstagram({ videoUrl, coverUrl, caption: caption?.full, firstComment: caption?.firstComment, whenISO, live });
        results.push({ platform, id: post.id, ok: Boolean(post.id), paramsHonored: post.paramsHonored });
      } else if (platform === "facebook") {
        const cap = platformMeta?.facebook?.full;
        if (!cap) { results.push({ platform, ok: false, error: "no facebook metadata" }); continue; }
        // FB SLOT SHIFT (owner audit 2026-07-16, per the platform research doc): Facebook's audience
        // peaks EVENINGS, later than IG's — and simultaneous cross-posting reads as syndication.
        // Shift FB +3h from the IG slot, clamped so the 22:00-LA slot lands 23:30 same-day, not 01:00.
        const fbWhenISO = live && whenISO ? shiftFbSlot(whenISO) : whenISO;
        const post = await postToFacebook({ videoUrl, coverUrl, caption: cap, whenISO: fbWhenISO, live });
        results.push({ platform, id: post.id, ok: Boolean(post.id), whenISO: fbWhenISO });
      } else if (platform === "youtube") {
        const yt = platformMeta?.youtube;
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

// Host the video+cover ONCE, then fan out. Instagram posts FIRST and exactly as before (its own
// proven caption); Facebook (Zernio) + YouTube (Buffer) use platformMeta metadata.
export async function publish({ job, mp4, cover, whenISO, live = false }) {
  const videoUrl = await hostFile(mp4, `${job.id}.mp4`);
  // cover is BEST-EFFORT: a thumbnail hosting hiccup must never throw away a fully-built reel (the video
  // is what matters; the platforms accept a null cover and pick their own frame). (review 2026-07-16)
  const coverUrl = cover ? await hostFile(cover, `${job.id}-cover.jpg`).catch((e) => { console.error(`  cover host failed (non-fatal): ${String(e.message).slice(0, 80)}`); return null; }) : null;
  return publishHosted({ id: job.id, caption: job.caption, platformMeta: job.platformMeta, videoUrl, coverUrl, whenISO, live });
}
