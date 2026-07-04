"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabase } from "@/lib/supabase";
import { renderGoogleButton } from "@/lib/googleAuth";
import { getCurrentUser, signOut, type CurrentUser } from "@/lib/comments";
import ProfileSettings from "./ProfileSettings";

/* The always-visible account control in the header (every device). The dropdown
   renders in a PORTAL with fixed positioning so it's never clipped by the
   collapsing masthead (which is overflow-hidden) or stacked behind the page.
   Signed out → Google button; signed in → Edit profile + Sign out. */

function PersonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

export default function HeaderAuth() {
  const [me, setMe] = useState<CurrentUser>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const gbtn = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const refresh = async () => {
    if (!getSupabase()) return;
    setMe(await getCurrentUser());
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

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    setOpen((v) => !v);
  };

  // Close on scroll (fixed dropdown would drift from the button) + Escape.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Render the Google button into the (portal) dropdown once it's open + signed out.
  useEffect(() => {
    if (open && !me && gbtn.current) {
      const t = setTimeout(() => gbtn.current && renderGoogleButton(gbtn.current), 30);
      return () => clearTimeout(t);
    }
  }, [open, me]);

  const doSignOut = async () => {
    setOpen(false);
    await signOut(); // hardened: only flips UI when the session actually cleared
  };

  if (!getSupabase()) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-1.5 text-ink transition-colors duration-150 hover:text-red"
      >
        {me?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.avatar} alt="" width={24} height={24} referrerPolicy="no-referrer" className="h-6 w-6 rounded-full object-cover" />
        ) : (
          <PersonIcon />
        )}
        <span className="nav-link hidden text-[11px] sm:inline">
          {me ? me.name.split(" ")[0] : "Sign In"}
        </span>
      </button>

      {mounted && open && pos
        ? createPortal(
            <>
              <div className="fixed inset-0 z-[99]" onMouseDown={() => setOpen(false)} />
              <div
                className="fixed z-[100] w-64 border border-ink bg-paper p-4 shadow-lg"
                style={{ top: pos.top, right: pos.right }}
              >
                {me ? (
                  <div>
                    <div className="flex items-center gap-2.5">
                      {me.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={me.avatar} alt="" width={32} height={32} referrerPolicy="no-referrer" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink font-sans text-sm font-bold text-paper">
                          {me.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="byline text-ink">{me.name}</span>
                    </div>
                    <button
                      onClick={() => {
                        setEditing(true);
                        setOpen(false);
                      }}
                      className="btn-label mt-4 w-full border border-hair py-2 text-slate transition-colors duration-150 hover:border-red hover:text-red"
                    >
                      Edit Profile
                    </button>
                    <button
                      onClick={doSignOut}
                      className="btn-label mt-2 w-full border border-hair py-2 text-slate transition-colors duration-150 hover:border-red hover:text-red"
                    >
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="dek text-sm leading-snug">Sign in to comment and join the conversation.</p>
                    <div ref={gbtn} className="mt-3 flex justify-center" />
                  </div>
                )}
              </div>
            </>,
            document.body,
          )
        : null}

      {editing && me ? <ProfileSettings me={me} onClose={() => setEditing(false)} /> : null}
    </>
  );
}
