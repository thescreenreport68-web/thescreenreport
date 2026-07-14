// POSTER — publish an IMAGE pin to Pinterest via Buffer (GraphQL). The composed card IS the pin image.
import { BUFFER } from "./accounts.mjs";

const MUT = `mutation Create($input: CreatePostInput!){ createPost(input:$input){ __typename
  ... on PostActionSuccess { post { id } }
  ... on RestProxyError { message code } ... on InvalidInputError { message }
  ... on UnauthorizedError { message } ... on LimitReachedError { message } ... on UnexpectedError { message } } }`;

async function gql(query, variables) {
  const r = await fetch(BUFFER.api, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.BUFFER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60000),
  });
  return r.json().catch(() => ({}));
}

// post one image pin. meta = { title, description, articleUrl, boardServiceId }. whenISO=schedule; draft=true→never publishes; immediate→shareNow.
export async function postPin({ imageUrl, meta, whenISO, draft, immediate }) {
  const input = {
    channelId: BUFFER.pinterest,
    schedulingType: "automatic",
    text: meta.description || "",
    tagIds: [],
    assets: [{ image: { url: imageUrl } }],   // a real image pin — the card
    metadata: { pinterest: { title: (meta.title || "").slice(0, 95), url: meta.articleUrl, boardServiceId: meta.boardServiceId } },
    saveToDraft: !!draft,
    aiAssisted: false,
  };
  if (immediate && !draft) input.mode = "shareNow";
  else { input.mode = "customScheduled"; input.dueAt = whenISO; }
  const j = await gql(MUT, { input });
  if (j.errors?.length) return { ok: false, error: j.errors.map((e) => e.message).join("; ") };
  const p = j?.data?.createPost;
  if (p?.__typename === "PostActionSuccess") return { ok: true, id: p.post?.id };
  return { ok: false, error: `${p?.__typename || "no-response"}: ${p?.message || JSON.stringify(j).slice(0, 160)}` };
}

export async function pinStatus(id) {
  const j = await gql(`query($input: PostInput!){ post(input:$input){ id status externalLink } }`, { input: { id } });
  return j?.data?.post || { error: j?.errors?.[0]?.message };
}

export async function deletePin(id) {
  const j = await gql(`mutation($input: DeletePostInput!){ deletePost(input:$input){ __typename } }`, { input: { id } });
  return j?.data?.deletePost?.__typename === "DeletePostSuccess";
}
