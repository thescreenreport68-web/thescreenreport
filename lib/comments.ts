import { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase";

/* Comments data layer (COMMENTS_SYSTEM_PLAN.md). Reads go straight to Supabase
   (anon key + RLS: approved comments, plus your own held ones). The one trusted
   write — posting — goes through the post-comment Edge Function so the moderation
   pipeline can't be bypassed. Likes / reports / deletes are RLS-guarded direct
   writes as the signed-in user. */

export type CommentAuthor = { display_name: string | null; avatar_url: string | null };
export type CommentRow = {
  id: string;
  body: string;
  status: string;
  like_count: number;
  reply_count: number;
  created_at: string;
  parent_id: string | null;
  user_id: string;
  profiles: CommentAuthor | null;
};
export type Thread = CommentRow & { replies: CommentRow[]; likedByMe: boolean };
export type CurrentUser = {
  id: string;
  name: string;
  avatar: string | null;
} | null;

export async function getCurrentUser(): Promise<CurrentUser> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return null;
  const m = u.user_metadata ?? {};
  // The editable profile row is the source of truth for name/avatar (so
  // profile-settings changes show everywhere); fall back to the Google metadata.
  // maybeSingle → a missing/lagging profile row resolves to null with NO error
  // (single() would emit a PGRST116 "no rows" console/network error on first
  // sign-up before the profile trigger has landed).
  const { data: prof } = await supabase
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("id", u.id)
    .maybeSingle();
  return {
    id: u.id,
    name: prof?.display_name ?? m.full_name ?? m.name ?? "Reader",
    avatar: prof?.avatar_url ?? m.avatar_url ?? m.picture ?? null,
  };
}

export async function updateProfile(input: {
  displayName: string;
  avatarUrl?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Unavailable." };
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return { ok: false, error: "Please sign in." };
  const patch: Record<string, unknown> = { display_name: input.displayName.trim().slice(0, 60) };
  if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl;
  const { error } = await supabase.from("profiles").update(patch).eq("id", uid);
  if (error) return { ok: false, error: "Could not save. Try again." };
  window.dispatchEvent(new Event("tsr-auth-changed"));
  return { ok: true };
}

// Upload a profile picture to the avatars bucket → returns its public URL.
export async function uploadAvatar(file: File): Promise<{ url?: string; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { error: "Unavailable." };
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return { error: "Please sign in." };
  if (file.size > 3 * 1024 * 1024) return { error: "Image must be under 3 MB." };
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${uid}/avatar_${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, cacheControl: "3600" });
  if (error) return { error: "Upload failed. Try a smaller image." };
  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  return { url: pub.publicUrl };
}

export async function signOut(): Promise<{ ok: boolean }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: true };
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false }; // don't flip the UI to signed-out if it failed
  window.dispatchEvent(new Event("tsr-auth-changed"));
  return { ok: true };
}

// Fetch all visible comments for an article and assemble threads.
export async function fetchThreads(
  slug: string,
  sort: "top" | "newest",
  meId: string | null,
): Promise<Thread[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("comments")
    .select("id, body, status, like_count, reply_count, created_at, parent_id, user_id")
    .eq("article_slug", slug)
    .neq("status", "rejected")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  const rows = data as unknown as CommentRow[];

  // Attach author profiles with a separate query and merge (comments.user_id and
  // profiles.id both reference auth.users, so PostgREST can't embed the join
  // directly). This is what makes comments show on a fresh page load.
  const uids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const profMap = new Map<string, CommentAuthor>();
  if (uids.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", uids);
    for (const p of (profs ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) {
      profMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
    }
  }
  rows.forEach((r) => {
    r.profiles = profMap.get(r.user_id) ?? null;
  });

  // Which of these did I like?
  let liked = new Set<string>();
  if (meId) {
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      const { data: likes } = await supabase
        .from("comment_likes")
        .select("comment_id")
        .eq("user_id", meId)
        .in("comment_id", ids);
      liked = new Set((likes ?? []).map((l: { comment_id: string }) => l.comment_id));
    }
  }

  const tops = rows.filter((r) => !r.parent_id);
  const repliesByParent = new Map<string, CommentRow[]>();
  for (const r of rows) {
    if (r.parent_id) {
      const arr = repliesByParent.get(r.parent_id) ?? [];
      arr.push(r);
      repliesByParent.set(r.parent_id, arr);
    }
  }
  const threads: Thread[] = tops.map((t) => ({
    ...t,
    likedByMe: liked.has(t.id),
    replies: (repliesByParent.get(t.id) ?? []).map((rp) => ({
      ...rp,
      likedByMe: liked.has(rp.id),
      replies: [],
    })) as unknown as CommentRow[],
  }));
  threads.sort((a, b) =>
    sort === "top"
      ? b.like_count - a.like_count || b.created_at.localeCompare(a.created_at)
      : b.created_at.localeCompare(a.created_at),
  );
  return threads;
}

export type PostResult =
  | { ok: true; held: boolean; comment: CommentRow; author: CommentAuthor }
  | { ok: false; error: string; code?: "TURNSTILE" | "AUTH" };

async function callPostFn(token: string, input: {
  slug: string;
  body: string;
  parentId?: string | null;
  turnstileToken: string;
}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/functions/v1/post-comment`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      article_slug: input.slug,
      body: input.body,
      parent_id: input.parentId ?? null,
      turnstile_token: input.turnstileToken,
    }),
  });
}

// Post a comment (or reply) through the moderation Edge Function.
export async function postComment(input: {
  slug: string;
  body: string;
  parentId?: string | null;
  turnstileToken: string;
}): Promise<PostResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Comments are unavailable." };
  const { data } = await supabase.auth.getSession();
  let token = data.session?.access_token;
  if (!token) return { ok: false, error: "Please sign in to comment.", code: "AUTH" };
  try {
    let res = await callPostFn(token, input);
    // Stale token (e.g. a long-idle / backgrounded tab) → refresh once and retry
    // transparently before telling the reader to sign in.
    if (res.status === 401) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      const fresh = refreshed.session?.access_token;
      if (fresh && fresh !== token) {
        token = fresh;
        res = await callPostFn(token, input);
      }
    }
    let json: { error?: string; message?: string; code?: string; held?: boolean; comment?: CommentRow; author?: CommentAuthor } = {};
    try {
      json = await res.json();
    } catch {
      return { ok: false, error: "Could not post your comment. Please try again." };
    }
    if (!res.ok) {
      const code: "TURNSTILE" | "AUTH" | undefined =
        json.code === "TURNSTILE" ? "TURNSTILE" : res.status === 401 ? "AUTH" : undefined;
      return { ok: false, error: json.message ?? json.error ?? "Could not post your comment.", code };
    }
    // Validate the shape so a malformed 200 can't crash the optimistic render.
    if (!json.held && (!json.comment || !json.author)) {
      return { ok: false, error: "Could not post your comment. Please try again." };
    }
    return {
      ok: true,
      held: !!json.held,
      comment: json.comment as CommentRow,
      author: (json.author ?? { display_name: null, avatar_url: null }) as CommentAuthor,
    };
  } catch {
    return { ok: false, error: "Network error — please try again." };
  }
}

// These return { ok } so callers can roll back the optimistic UI on failure
// (a failed like/delete previously desynced the UI from the DB until reload —
// the "intermittent glitch"). A like that hits the unique constraint (double
// click) is treated as success (the like already exists).
export async function toggleLike(commentId: string, meId: string, on: boolean): Promise<{ ok: boolean }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false };
  if (on) {
    const { error } = await supabase.from("comment_likes").insert({ comment_id: commentId, user_id: meId });
    return { ok: !error || error.code === "23505" }; // 23505 = already liked
  }
  const { error } = await supabase
    .from("comment_likes")
    .delete()
    .eq("comment_id", commentId)
    .eq("user_id", meId);
  return { ok: !error };
}

export async function reportComment(commentId: string, meId: string): Promise<{ ok: boolean }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false };
  const { error } = await supabase
    .from("comment_reports")
    .insert({ comment_id: commentId, reporter_id: meId, reason: "user_report" });
  return { ok: !error || error.code === "23505" }; // already reported
}

export async function deleteComment(commentId: string): Promise<{ ok: boolean }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false };
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  return { ok: !error };
}
