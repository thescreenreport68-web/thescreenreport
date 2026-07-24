// BUFFER bridge (self-contained in the IG/YIF lane) — publishes YouTube Shorts via Buffer's GraphQL
// createPost. Adapted from the live-verified video-lane bridge (pipeline/video/post/buffer.mjs,
// 2026-07-05); kept in-lane so nothing imports across lanes. Buffer fetches the video from a PUBLIC
// URL (host it first). Uses BUFFER_API_KEY from the parent .env.
import { IG } from "../config.mjs";

const MUT = `mutation Create($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id } }
    ... on RestProxyError { message code }
    ... on NotFoundError { message }
    ... on UnauthorizedError { message }
    ... on InvalidInputError { message }
    ... on LimitReachedError { message }
    ... on UnexpectedError { message }
  }
}`;

async function gql(query, variables, { retryThrown = true } = {}) {
  // RETRY on a THROWN fetch (network/timeout) for READ queries only. For CREATE mutations the caller
  // passes retryThrown:false and does verify-before-retry — a timeout does NOT prove the post wasn't
  // created, and a blind retry there mints a DUPLICATE (owner root-level mandate 2026-07-18).
  let lastErr;
  for (let attempt = 1; attempt <= (retryThrown ? 3 : 1); attempt++) {
    try {
      const r = await fetch(IG.buffer.base, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.BUFFER_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(60000),
      });
      return r.json().catch(() => ({}));
    } catch (e) {
      lastErr = e;
      if (attempt === 3 || !retryThrown) throw e;
      await new Promise((res) => setTimeout(res, attempt * 3000));
    }
  }
  throw lastErr;
}

// does a post with THIS video already exist on the channel (any status)? — the verify-before-retry
// primitive for createPost, and a general last-line duplicate guard.
export async function bufferFindByVideo(videoUrl) {
  try {
    const j = await gql(
      `query($input:PostsInput!,$first:Int){ posts(input:$input,first:$first){ edges{ node{ id status dueAt assets{ ... on VideoAsset { source } } } } } }`,
      { input: { organizationId: IG.buffer.organizationId }, first: 40 },
    );
    const hit = (j?.data?.posts?.edges || []).map((e) => e.node)
      .find((n) => (n.assets || []).some((a) => a.source === videoUrl) && n.status !== "error");
    return hit ? { id: hit.id, status: hit.status } : null;
  } catch {
    return null;
  }
}

// YouTube Short. title/description already platform-shaped (agent platformMeta). categoryId 24 =
// Entertainment (YouTube requires one). draft=true → Buffer draft (never publishes); immediate=true →
// publish now (shareNow, ignores whenISO); else scheduled to whenISO.
export async function postYouTube({ videoUrl, title, description, whenISO, draft = false, immediate = false }) {
  const input = {
    channelId: IG.buffer.youtubeChannel,
    schedulingType: "automatic", // Buffer auto-publishes (no phone-notification step)
    text: description || "",
    tagIds: [],
    // Buffer (2026-07) REJECTS thumbnailUrl on a video asset; cover is picked via thumbnailOffset.
    assets: [{ video: { url: videoUrl, metadata: { thumbnailOffset: 1200 } } }],
    saveToDraft: !!draft,
    // TRUE, matching metadata.youtube.isAiGenerated (owner audit 2026-07-16): the reel uses AI voice +
    // imagery of real people/events, and from May 2026 YouTube auto-detects undisclosed synthetic
    // content and can strip revenue — honest disclosure carries no reach penalty. The old `false` here
    // was the silent flip that made Buffer store isAiGenerated=false despite our metadata flag.
    aiAssisted: true,
    metadata: {
      youtube: {
        title,
        privacy: "public",
        categoryId: "24", // Entertainment
        madeForKids: false,
        isAiGenerated: true, // honest AI-content disclosure (YouTube policy)
        notifySubscribers: true,
      },
    },
  };
  if (immediate && !draft) input.mode = "shareNow";
  else { input.mode = "customScheduled"; input.dueAt = whenISO; }

  // DUPLICATE-PROOF create (owner root-level mandate 2026-07-18): (1) pre-check — if this exact video
  // already has a non-error post on the channel, DO NOT create another; (2) the create itself never
  // blind-retries a thrown fetch — on timeout we verify whether the post landed before any retry.
  const pre = await bufferFindByVideo(videoUrl);
  if (pre) return { ok: true, id: pre.id, deduped: true };
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const j = await gql(MUT, { input }, { retryThrown: false });
      if (j.errors?.length) return { ok: false, error: j.errors.map((e) => e.message).join("; ") };
      const p = j?.data?.createPost;
      if (p?.__typename === "PostActionSuccess") return { ok: true, id: p.post?.id };
      return { ok: false, error: `${p?.__typename || "no-response"}: ${p?.message || JSON.stringify(j).slice(0, 200)}` };
    } catch (e) {
      lastErr = String(e.message).slice(0, 150); // network/timeout — the post MAY have been created
      const landed = await bufferFindByVideo(videoUrl);
      if (landed) return { ok: true, id: landed.id, recovered: true };
      if (attempt < 3) await new Promise((res) => setTimeout(res, 3000 * attempt));
    }
  }
  return { ok: false, error: `createPost failed after verify-retry: ${lastErr}` };
}

// poll a Buffer post's publish status: draft | scheduled | sent | error | ...
export async function bufferStatus(id) {
  const j = await gql(`query($input: PostInput!){ post(input:$input){ id status dueAt } }`, { input: { id } });
  return j?.data?.post || { error: j?.errors?.[0]?.message };
}

// YouTube post metrics via Buffer (flywheel, owner audit 2026-07-16). Live-probed shape:
// metrics = [{type:"views"|"reactions"|"comments"|"engagementRate", value:number}]. NOTE: Buffer does
// NOT expose YouTube's post-2025 "engagedViews" field — views + engagementRate (interactions/views) is
// the best engagement-quality signal available on this path; the learner records both.
export async function bufferMetrics(id) {
  const j = await gql(
    `query($input: PostInput!){ post(input:$input){ id status metricsUpdatedAt metrics{ type value } } }`,
    { input: { id } },
  );
  const p = j?.data?.post;
  if (!p) return null;
  const get = (t) => p.metrics?.find((m) => m.type === t)?.value ?? null;
  return {
    status: p.status,
    views: get("views"),
    likes: get("reactions"),
    comments: get("comments"),
    engagementRate: get("engagementRate"), // percent: (reactions+comments)/views*100
    updatedAt: p.metricsUpdatedAt || null,
  };
}

// delete a Buffer post/draft by id (test cleanup)
export async function deleteBuffer(id) {
  const j = await gql(`mutation($input: DeletePostInput!){ deletePost(input:$input){ __typename } }`, { input: { id } });
  return j?.data?.deletePost?.__typename === "DeletePostSuccess";
}
