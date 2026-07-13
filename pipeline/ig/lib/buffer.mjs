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

async function gql(query, variables) {
  const r = await fetch(IG.buffer.base, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.BUFFER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60000),
  });
  return r.json().catch(() => ({}));
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
    aiAssisted: false,
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

  const j = await gql(MUT, { input });
  if (j.errors?.length) return { ok: false, error: j.errors.map((e) => e.message).join("; ") };
  const p = j?.data?.createPost;
  if (p?.__typename === "PostActionSuccess") return { ok: true, id: p.post?.id };
  return { ok: false, error: `${p?.__typename || "no-response"}: ${p?.message || JSON.stringify(j).slice(0, 200)}` };
}

// poll a Buffer post's publish status: draft | scheduled | sent | error | ...
export async function bufferStatus(id) {
  const j = await gql(`query($input: PostInput!){ post(input:$input){ id status dueAt } }`, { input: { id } });
  return j?.data?.post || { error: j?.errors?.[0]?.message };
}

// delete a Buffer post/draft by id (test cleanup)
export async function deleteBuffer(id) {
  const j = await gql(`mutation($input: DeletePostInput!){ deletePost(input:$input){ __typename } }`, { input: { id } });
  return j?.data?.deletePost?.__typename === "DeletePostSuccess";
}
