"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Turnstile from "./Turnstile";
import { renderGoogleButton } from "@/lib/googleAuth";
import { formatRelative } from "@/lib/format";
import {
  fetchThreads,
  getCurrentUser,
  postComment,
  toggleLike,
  reportComment,
  deleteComment,
  signOut,
  type Thread,
  type CommentRow,
  type CurrentUser,
} from "@/lib/comments";

/* "THE CONVERSATION" — the comment island (COMMENTS_SYSTEM_PLAN.md §5). YouTube-
   grade behavior (sign-in, threaded replies, likes, sort) in our design system.
   Lazy-mounted below the article so it never touches article load speed. */

function Avatar({ src, name, size = 36 }: { src: string | null; name: string; size?: number }) {
  const initial = (name || "R").trim().charAt(0).toUpperCase();
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-ink font-sans text-sm font-bold text-paper"
      style={{ width: size, height: size }}
    >
      {initial}
    </span>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.5 1.1-1a5.5 5.5 0 0 0 0-7.9Z" />
    </svg>
  );
}

function GoogleSignInButton() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) renderGoogleButton(ref.current);
  }, []);
  return <div ref={ref} />;
}

type Me = CurrentUser;

function Composer({
  me,
  slug,
  parentId,
  placeholder,
  onPosted,
  onCancel,
  compact,
}: {
  me: Me;
  slug: string;
  parentId?: string | null;
  placeholder: string;
  onPosted: (row: CommentRow, held: boolean, authorName: string, authorAvatar: string | null, parentId: string | null) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [body, setBody] = useState("");
  const [token, setToken] = useState("");
  const [tsNonce, setTsNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!me) {
    return (
      <div className="border border-hair p-4">
        <p className="dek text-base">Sign in to join the conversation.</p>
        <div className="mt-3">
          <GoogleSignInButton />
        </div>
      </div>
    );
  }

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    if (!token) {
      setError("Please wait a moment for verification, then try again.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await postComment({ slug, body: text, parentId, turnstileToken: token });
    setBusy(false);
    setTsNonce((n) => n + 1); // fresh Turnstile token for next time
    setToken("");
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBody("");
    if (res.held) {
      setNotice("Thanks — your comment is held for review and will appear once approved.");
    } else {
      onPosted(res.comment, res.held, me.name, me.avatar, parentId ?? null);
    }
  };

  return (
    <div className={compact ? "" : "border-b border-hair pb-6"}>
      <div className="flex gap-3">
        <Avatar src={me.avatar} name={me.name} />
        <div className="min-w-0 flex-1">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            rows={compact ? 2 : 3}
            placeholder={placeholder}
            className="w-full resize-y border border-hair px-3 py-2 font-body text-[1.02rem] leading-snug text-ink placeholder:text-gray focus:border-ink focus:outline-none"
          />
          <Turnstile onVerify={setToken} nonce={tsNonce} />
          {error ? <p className="meta-mono mt-2 text-red">{error}</p> : null}
          {notice ? <p className="meta-mono mt-2 text-ink">{notice}</p> : null}
          <div className="mt-2 flex items-center gap-3">
            <span className="meta-mono text-gray">{body.length}/2000</span>
            <div className="ml-auto flex items-center gap-2">
              {onCancel ? (
                <button onClick={onCancel} className="btn-label px-3 py-2 text-slate hover:text-ink">
                  Cancel
                </button>
              ) : null}
              <button
                onClick={submit}
                disabled={busy || !body.trim()}
                className="btn-label bg-red px-4 py-2 text-paper transition-colors duration-150 hover:bg-red-dark disabled:opacity-40"
              >
                {busy ? "Posting…" : parentId ? "Reply" : "Post"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommentView({
  c,
  me,
  slug,
  isReply,
  onReplyPosted,
}: {
  c: CommentRow & { likedByMe?: boolean };
  me: Me;
  slug: string;
  isReply?: boolean;
  onReplyPosted: (row: CommentRow, parentId: string) => void;
}) {
  const [likes, setLikes] = useState(c.like_count);
  const [liked, setLiked] = useState(!!c.likedByMe);
  const [replying, setReplying] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [reported, setReported] = useState(false);
  const name = c.profiles?.display_name ?? "Reader";
  const avatar = c.profiles?.avatar_url ?? null;
  const mine = me?.id === c.user_id;

  if (removed) return null;

  const like = async () => {
    if (!me) return;
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    await toggleLike(c.id, me.id, next);
  };

  return (
    <article className="flex gap-3 py-4">
      <Avatar src={avatar} name={name} size={isReply ? 30 : 36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2.5">
          <span className="font-sans text-sm font-bold text-ink">{name}</span>
          <time dateTime={c.created_at} className="meta-mono">
            {formatRelative(c.created_at)}
          </time>
          {c.status !== "approved" && mine ? (
            <span className="meta-mono text-red">Pending review</span>
          ) : null}
        </div>
        <p className="mt-1 whitespace-pre-wrap font-body text-[1.05rem] leading-snug text-ink">
          {c.body}
        </p>
        <div className="mt-2 flex items-center gap-4">
          <button
            onClick={like}
            disabled={!me}
            aria-pressed={liked}
            className={`flex items-center gap-1.5 transition-colors duration-150 ${liked ? "text-red" : "text-slate hover:text-red"} disabled:opacity-50`}
          >
            <HeartIcon filled={liked} />
            <span className="meta-mono">{likes > 0 ? likes : ""}</span>
          </button>
          {!isReply && me ? (
            <button onClick={() => setReplying((v) => !v)} className="btn-label text-slate hover:text-red">
              Reply
            </button>
          ) : null}
          {mine ? (
            <button
              onClick={async () => {
                await deleteComment(c.id);
                setRemoved(true);
              }}
              className="btn-label text-slate hover:text-red"
            >
              Delete
            </button>
          ) : me && !reported ? (
            <button
              onClick={async () => {
                await reportComment(c.id, me.id);
                setReported(true);
              }}
              className="btn-label text-slate hover:text-red"
            >
              Report
            </button>
          ) : reported ? (
            <span className="meta-mono text-gray">Reported</span>
          ) : null}
        </div>
        {replying ? (
          <div className="mt-3">
            <Composer
              me={me}
              slug={slug}
              parentId={c.id}
              placeholder={`Reply to ${name}…`}
              compact
              onCancel={() => setReplying(false)}
              onPosted={(row) => {
                setReplying(false);
                onReplyPosted(row, c.id);
              }}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ThreadView({
  t,
  me,
  slug,
}: {
  t: Thread;
  me: Me;
  slug: string;
}) {
  const [replies, setReplies] = useState<CommentRow[]>(t.replies);
  const [open, setOpen] = useState(false);
  const addReply = (row: CommentRow) => {
    setReplies((r) => [...r, row]);
    setOpen(true);
  };
  return (
    <div className="border-b border-dotted border-gray">
      <CommentView c={t} me={me} slug={slug} onReplyPosted={addReply} />
      {replies.length ? (
        <div className="ml-12">
          <button
            onClick={() => setOpen((v) => !v)}
            className="btn-label py-1 text-red hover:text-red-dark"
          >
            {open ? "Hide" : "View"} {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </button>
          {open ? (
            <div className="divide-y divide-dotted divide-hair">
              {replies.map((r) => (
                <CommentView
                  key={r.id}
                  c={r}
                  me={me}
                  slug={slug}
                  isReply
                  onReplyPosted={() => {}}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function Comments({ slug }: { slug: string }) {
  const [me, setMe] = useState<Me>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [sort, setSort] = useState<"top" | "newest">("top");
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    setMe(user);
    const t = await fetchThreads(slug, sort, user?.id ?? null);
    setThreads(t);
    setCount(t.reduce((n, x) => n + 1 + x.replies.length, 0));
    setLoading(false);
  }, [slug, sort]);

  useEffect(() => {
    load();
    const onAuth = () => load();
    window.addEventListener("tsr-auth-changed", onAuth);
    return () => window.removeEventListener("tsr-auth-changed", onAuth);
  }, [load]);

  const onPosted = (row: CommentRow, _held: boolean, name: string, avatar: string | null) => {
    const newThread: Thread = {
      ...row,
      profiles: { display_name: name, avatar_url: avatar },
      likedByMe: false,
      replies: [],
    };
    setThreads((t) => [newThread, ...t]);
    setCount((n) => n + 1);
  };

  return (
    <section className="mt-12" id="comments">
      <div className="mb-5 flex items-baseline gap-3 border-b-2 border-ink pb-2">
        <h2 className="sect-head text-2xl lg:text-2xl">The Conversation</h2>
        <span className="meta-mono">{count > 0 ? `${count} comment${count === 1 ? "" : "s"}` : ""}</span>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setSort("top")}
            className={`btn-label ${sort === "top" ? "text-red" : "text-slate hover:text-ink"}`}
          >
            Top
          </button>
          <span className="text-hair" aria-hidden>|</span>
          <button
            onClick={() => setSort("newest")}
            className={`btn-label ${sort === "newest" ? "text-red" : "text-slate hover:text-ink"}`}
          >
            Newest
          </button>
        </div>
      </div>

      <div className="mb-2">
        <Composer
          me={me}
          slug={slug}
          placeholder="Add a comment…"
          onPosted={onPosted}
        />
        {me ? (
          <div className="mt-2 text-right">
            <button onClick={signOut} className="meta-mono text-gray hover:text-red">
              Signed in as {me.name} · Sign out
            </button>
          </div>
        ) : null}
      </div>

      {loading ? (
        <p className="meta-mono py-8 text-center text-gray">Loading the conversation…</p>
      ) : threads.length === 0 ? (
        <p className="dek py-8 text-center text-base">
          No comments yet. Be the first to share what you think.
        </p>
      ) : (
        <div>
          {threads.map((t) => (
            <ThreadView key={t.id} t={t} me={me} slug={slug} />
          ))}
        </div>
      )}
    </section>
  );
}
