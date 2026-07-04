"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { renderGoogleButton } from "@/lib/googleAuth";

/* The always-visible account control in the header (every device). Signed out:
   a "Sign In" button that opens a dropdown with the official Google button —
   the universal path that works on phones too, unlike the auto-popup (which
   iOS Safari can't show). Signed in: avatar + a sign-out menu. */

type Me = { name: string; avatar: string | null } | null;

function PersonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

export default function HeaderAuth() {
  const [me, setMe] = useState<Me>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const gbtn = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    const u = data.user;
    setMe(
      u
        ? {
            name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? "Account",
            avatar: u.user_metadata?.avatar_url ?? u.user_metadata?.picture ?? null,
          }
        : null,
    );
    setReady(true);
  };

  useEffect(() => {
    refresh();
    const onAuth = () => {
      refresh();
      setOpen(false);
    };
    window.addEventListener("tsr-auth-changed", onAuth);
    return () => window.removeEventListener("tsr-auth-changed", onAuth);
  }, []);

  // Render the Google button into the dropdown when it opens (signed out).
  useEffect(() => {
    if (open && !me && gbtn.current) renderGoogleButton(gbtn.current);
  }, [open, me]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const signOut = async () => {
    await getSupabase()?.auth.signOut();
    window.dispatchEvent(new Event("tsr-auth-changed"));
    setOpen(false);
  };

  if (!getSupabase() || !ready) return null;

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-1.5 text-ink transition-colors duration-150 hover:text-red"
      >
        {me?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={me.avatar}
            alt=""
            width={24}
            height={24}
            referrerPolicy="no-referrer"
            className="h-6 w-6 rounded-full object-cover"
          />
        ) : (
          <PersonIcon />
        )}
        <span className="nav-link hidden text-[11px] sm:inline">
          {me ? me.name.split(" ")[0] : "Sign In"}
        </span>
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 border border-ink bg-paper p-4 shadow-lg">
          {me ? (
            <div>
              <p className="byline text-ink">{me.name}</p>
              <button
                onClick={signOut}
                className="btn-label mt-3 w-full border border-hair py-2 text-slate transition-colors duration-150 hover:border-red hover:text-red"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div>
              <p className="dek text-sm leading-snug">
                Sign in to comment and join the conversation.
              </p>
              <div ref={gbtn} className="mt-3 flex justify-center" />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
