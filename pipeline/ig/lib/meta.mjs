// DIRECT META GRAPH API (owner 2026-07-24: own app "TSR Publisher", no third-party dependency).
// Publishes Instagram Reels + Facebook Reels straight through Meta's API and reads the insights we
// were blind on (per-reel views/reach/avg-watch-time/likes/comments/SHARES/saves).
//
// SCHEDULING MODEL: the Graph API cannot schedule an IG post for later, so the build-ahead run
// CREATES the media container (valid ~24h, invisible until published) and enqueues it with its slot
// time in data/ig/metaqueue.json; every subsequent run "drains" the queue and publishes whatever is
// due. Drain crons sit just after each LA slot, so posts land within GitHub-cron drift (~5-40min) of
// the slot. Buffer (YouTube) keeps its own native scheduling.
//
// Enabled only when the META_* env vars exist — otherwise every entry point reports disabled and the
// callers fall back to the legacy Zernio path. FAIL-SAFE: nothing here throws surprises upward; every
// function returns {ok:false,error} on failure.
import { fetchWithTimeout, sleep } from "./util.mjs";

const G = "https://graph.facebook.com/v21.0";
const RUP = "https://rupload.facebook.com/video-upload/v21.0";

export function metaEnabled() {
  return Boolean(process.env.META_PAGE_TOKEN && process.env.META_IG_ID && process.env.META_PAGE_ID);
}
const T = () => process.env.META_PAGE_TOKEN;

async function gjson(url, opts = {}, ms = 60000) {
  const res = await fetchWithTimeout(url, opts, ms);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(`meta ${res.status}: ${JSON.stringify(j.error || j).slice(0, 220)}`);
  return j;
}

// ── INSTAGRAM: container → (later) publish ─────────────────────────────────────────
// Create the invisible container at BUILD time. share_to_feed keeps reels on the profile grid.
export async function igCreateContainer({ videoUrl, caption, coverUrl = null }) {
  try {
    const p = new URLSearchParams({
      media_type: "REELS", video_url: videoUrl, caption: caption || "",
      share_to_feed: "true", access_token: T(),
    });
    if (coverUrl) p.set("cover_url", coverUrl);
    const j = await gjson(`${G}/${process.env.META_IG_ID}/media`, { method: "POST", body: p });
    return { ok: true, containerId: j.id };
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
}

export async function igContainerStatus(containerId) {
  try {
    const j = await gjson(`${G}/${containerId}?fields=status_code,status&access_token=${T()}`, {}, 30000);
    return { ok: true, status: j.status_code, detail: j.status };
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
}

// Publish a FINISHED container (called by the drain at slot time). Waits briefly for processing.
export async function igPublish(containerId) {
  try {
    for (let i = 0; i < 20; i++) {
      const st = await igContainerStatus(containerId);
      if (st.status === "FINISHED") break;
      if (st.status === "ERROR" || st.status === "EXPIRED") return { ok: false, error: `container ${st.status}: ${String(st.detail).slice(0, 120)}` };
      await sleep(6000); // still IN_PROGRESS — media processing
    }
    const j = await gjson(`${G}/${process.env.META_IG_ID}/media_publish`, {
      method: "POST", body: new URLSearchParams({ creation_id: containerId, access_token: T() }),
    });
    return { ok: true, mediaId: j.id };
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
}

// The auto-pinned hot-take first comment (impossible via the old bridge — the engagement seeder).
export async function igComment(mediaId, message) {
  try {
    const j = await gjson(`${G}/${mediaId}/comments`, {
      method: "POST", body: new URLSearchParams({ message: String(message).slice(0, 280), access_token: T() }),
    });
    return { ok: true, commentId: j.id };
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
}

// ── FACEBOOK: native REELS (discovery surface — ordinary page videos only reach followers) ────
// Three-phase: start → transfer by hosted URL (Meta pulls it; nothing downloads locally) → finish.
export async function fbReelPublish({ videoUrl, description }) {
  try {
    const start = await gjson(`${G}/${process.env.META_PAGE_ID}/video_reels`, {
      method: "POST", body: new URLSearchParams({ upload_phase: "start", access_token: T() }),
    });
    const vid = start.video_id;
    const up = await fetchWithTimeout(`${RUP}/${vid}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${T()}`, file_url: videoUrl },
    }, 300000);
    const upJ = await up.json().catch(() => ({}));
    if (!up.ok || upJ.success === false) return { ok: false, error: `upload: ${JSON.stringify(upJ).slice(0, 150)}` };
    // poll processing then finish-publish
    for (let i = 0; i < 30; i++) {
      const st = await gjson(`${G}/${vid}?fields=status&access_token=${T()}`, {}, 30000).catch(() => null);
      const phase = st?.status?.uploading_phase?.status;
      if (phase === "complete") break;
      if (st?.status?.uploading_phase?.status === "error") return { ok: false, error: "processing error" };
      await sleep(6000);
    }
    await gjson(`${G}/${process.env.META_PAGE_ID}/video_reels`, {
      method: "POST",
      body: new URLSearchParams({
        upload_phase: "finish", video_id: vid, video_state: "PUBLISHED",
        description: String(description || "").slice(0, 5000), access_token: T(),
      }),
    });
    return { ok: true, videoId: vid };
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
}

// ── INSIGHTS (the un-blinding) ─────────────────────────────────────────────────────
export async function igMediaInsights(mediaId) {
  try {
    const j = await gjson(`${G}/${mediaId}/insights?metric=views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time&access_token=${T()}`, {}, 30000);
    const g = (n) => j.data?.find((d) => d.name === n)?.values?.[0]?.value ?? null;
    return {
      ok: true, views: g("views"), reach: g("reach"), likes: g("likes"), comments: g("comments"),
      shares: g("shares"), saved: g("saved"), totalInteractions: g("total_interactions"),
      avgWatchMs: g("ig_reels_avg_watch_time"),
    };
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
}

export async function fbVideoInsights(videoId) {
  try {
    const j = await gjson(`${G}/${videoId}/video_insights?metric=blue_reels_play_count,post_impressions_unique,post_video_avg_time_watched&access_token=${T()}`, {}, 30000).catch(() => null);
    if (!j) return { ok: false, error: "no insights" };
    const g = (n) => j.data?.find((d) => d.name === n)?.values?.[0]?.value ?? null;
    return { ok: true, views: g("blue_reels_play_count"), reach: g("post_impressions_unique"), avgWatchMs: g("post_video_avg_time_watched") };
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
}

export async function igAccountSnapshot() {
  try {
    const a = await gjson(`${G}/${process.env.META_IG_ID}?fields=followers_count&access_token=${T()}`, {}, 30000);
    const i = await gjson(`${G}/${process.env.META_IG_ID}/insights?metric=reach,accounts_engaged&period=day&metric_type=total_value&access_token=${T()}`, {}, 30000);
    const g = (n) => i.data?.find((d) => d.name === n)?.total_value?.value ?? null;
    return { ok: true, followers: a.followers_count, reachToday: g("reach"), engagedToday: g("accounts_engaged") };
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
}
