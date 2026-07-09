// BUFFER bridge — publishes to YouTube (Shorts) and Pinterest. GraphQL createPost.
// One call per channel (each channel gets its own tailored title/description + its own scheduled time).
// Buffer fetches the video from a public URL (assets[].video.url), so host it first (host.mjs).
import { BUFFER } from "./accounts.mjs";

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

async function gql(input) {
  const r = await fetch(BUFFER.api, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.BUFFER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query: MUT, variables: { input } }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (j.errors?.length) return { ok: false, error: j.errors.map((e) => e.message).join("; ") };
  const p = j?.data?.createPost;
  if (p?.__typename === "PostActionSuccess") return { ok: true, id: p.post?.id };
  return { ok: false, error: `${p?.__typename || "no-response"}: ${p?.message || JSON.stringify(j).slice(0, 200)}` };
}

// shared builder. whenISO = ISO instant to publish; draft=true → Buffer draft (never publishes);
// immediate=true → publish right now (shareNow, ignores whenISO).
function baseInput({ channelId, videoUrl, thumbnailUrl, text, whenISO, draft, immediate }) {
  const input = {
    channelId,
    schedulingType: "automatic", // Buffer auto-publishes (no phone-notification step)
    text: text || "",
    tagIds: [],
    // Buffer (2026-07 change) REJECTS thumbnailUrl on a video asset ("never sent to the network").
    // Cover frame is picked via metadata.video.thumbnailOffset; Pinterest adds a separate image asset below.
    assets: [{ video: { url: videoUrl, metadata: { thumbnailOffset: 1200 } } }],
    saveToDraft: !!draft,
    aiAssisted: false,
  };
  if (immediate && !draft) { input.mode = "shareNow"; }
  else { input.mode = "customScheduled"; input.dueAt = whenISO; }
  return input;
}

// YouTube Shorts. caps.youtube = { title, description }. categoryId 24 = Entertainment (YouTube requires one)
export function postYouTube({ videoUrl, thumbnailUrl, caps, whenISO, draft, immediate }) {
  const input = baseInput({ channelId: BUFFER.youtube, videoUrl, thumbnailUrl, text: caps.description, whenISO, draft, immediate });
  input.metadata = {
    youtube: {
      title: caps.title,
      privacy: "public",
      categoryId: "24", // Entertainment
      madeForKids: false,
      isAiGenerated: true, // honest AI-content disclosure (YouTube policy)
      notifySubscribers: true,
    },
  };
  return gql(input);
}

// Pinterest video pin. caps.pinterest = { title, description }; board routed by category; url = article link.
// Buffer requires an IMAGE asset for Pinterest (the pin cover) alongside the video → send both.
export function postPinterest({ videoUrl, thumbnailUrl, caps, articleUrl, boardServiceId, whenISO, draft, immediate }) {
  const input = baseInput({ channelId: BUFFER.pinterest, videoUrl, thumbnailUrl, text: caps.description, whenISO, draft, immediate });
  // Pinterest needs a real image asset (the pin cover); the video asset must NOT carry thumbnailUrl (Buffer rejects it)
  input.assets = [{ image: { url: thumbnailUrl } }, { video: { url: videoUrl, metadata: { thumbnailOffset: 1200 } } }];
  input.metadata = { pinterest: { title: caps.title, url: articleUrl, boardServiceId } };
  return gql(input);
}

// poll a Buffer post's publish status: draft | scheduled | sent | error | ...
export async function bufferStatus(id) {
  try {
    const r = await fetch(BUFFER.api, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.BUFFER_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ query: `query($input: PostInput!){ post(input:$input){ id status dueAt } }`, variables: { input: { id } } }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json().catch(() => ({}));
    return j?.data?.post || { error: j?.errors?.[0]?.message };
  } catch (e) { return { error: String(e.message || e) }; }
}

// delete a Buffer post/draft by id (verification cleanup + future use)
export async function deleteBuffer(id) {
  try {
    const r = await fetch(BUFFER.api, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.BUFFER_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ query: `mutation($input: DeletePostInput!){ deletePost(input:$input){ __typename } }`, variables: { input: { id } } }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json().catch(() => ({}));
    return j?.data?.deletePost?.__typename === "DeletePostSuccess";
  } catch { return false; }
}
