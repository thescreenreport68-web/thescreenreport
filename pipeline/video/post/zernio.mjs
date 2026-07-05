// ZERNIO bridge — publishes to Facebook (Page) and Instagram (Business). REST.
// One call per platform (each gets its own caption + own scheduled time so we can stagger them).
// Zernio fetches the video from a public URL (mediaItems[].url), so host it first (host.mjs).
import { ZERNIO } from "./accounts.mjs";

// platform = "facebook" | "instagram"; whenISO = ISO instant to publish; draft=true → saved as draft (never publishes)
export async function postZernio({ platform, videoUrl, caption, whenISO, draft }) {
  const accountId = ZERNIO[platform];
  if (!accountId) return { ok: false, error: `unknown platform ${platform}` };
  const body = {
    content: caption || "",
    status: draft ? "draft" : "scheduled",
    timezone: "America/Los_Angeles",
    platforms: [{ accountId, platform }],
    mediaItems: [{ type: "video", url: videoUrl }],
  };
  // a future scheduledFor makes Zernio auto-promote draft→scheduled; only send it when actually scheduling
  if (!draft) body.scheduledFor = whenISO;
  let r, j;
  try {
    r = await fetch(`${ZERNIO.api}/posts`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  if (!r.ok) return { ok: false, error: `${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
  const id = j?.post?._id;
  return id ? { ok: true, id } : { ok: false, error: JSON.stringify(j).slice(0, 200) };
}

// poll a Zernio post's status: draft | scheduled | publishing | published | failed
export async function zernioStatus(id) {
  try {
    const r = await fetch(`${ZERNIO.api}/posts/${id}`, { headers: { authorization: `Bearer ${process.env.ZERNIO_API_KEY}` }, signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({}));
    const p = j.post || j;
    return { status: p.status, platformStatus: p.platforms?.[0]?.status, error: p.platforms?.[0]?.error || p.error, url: p.platforms?.[0]?.publishedUrl || p.platforms?.[0]?.postUrl };
  } catch (e) { return { error: String(e.message || e) }; }
}

// delete a Zernio post/draft by id (used by verification cleanup)
export async function deleteZernio(id) {
  try {
    const r = await fetch(`${ZERNIO.api}/posts/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${process.env.ZERNIO_API_KEY}` }, signal: AbortSignal.timeout(30000) });
    return r.ok;
  } catch { return false; }
}
