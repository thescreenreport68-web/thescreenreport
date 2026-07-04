"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { updateProfile, uploadAvatar, type CurrentUser } from "@/lib/comments";

/* A small profile-settings popup: change display name + profile picture, save.
   Renders in a portal so it's always above the page. */
export default function ProfileSettings({
  me,
  onClose,
}: {
  me: NonNullable<CurrentUser>;
  onClose: () => void;
}) {
  const [name, setName] = useState(me.name);
  const [preview, setPreview] = useState<string | null>(me.avatar);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const pick = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Please enter a display name.");
      return;
    }
    setBusy(true);
    setError(null);
    let avatarUrl: string | undefined;
    if (file) {
      const up = await uploadAvatar(file);
      if (up.error) {
        setError(up.error);
        setBusy(false);
        return;
      }
      avatarUrl = up.url;
    }
    const res = await updateProfile({ displayName: name, avatarUrl });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save.");
      return;
    }
    onClose();
  };

  if (!mounted) return null;

  const initial = (name || "R").trim().charAt(0).toUpperCase();

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-ink/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm border border-ink bg-paper p-6">
        <div className="flex items-baseline justify-between border-b-2 border-ink pb-2">
          <h2 className="sect-head text-xl lg:text-xl">Your Profile</h2>
          <button onClick={onClose} aria-label="Close" className="meta-mono text-slate hover:text-red">
            Close
          </button>
        </div>

        <div className="mt-5 flex items-center gap-4">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt=""
              width={56}
              height={56}
              referrerPolicy="no-referrer"
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ink font-sans text-lg font-bold text-paper">
              {initial}
            </span>
          )}
          <div>
            <button
              onClick={() => fileRef.current?.click()}
              className="btn-label border border-hair px-3 py-2 text-slate transition-colors duration-150 hover:border-red hover:text-red"
            >
              Change Photo
            </button>
            <p className="meta-mono mt-1.5 text-gray">PNG or JPG, under 3 MB</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
        </div>

        <label className="mt-5 block">
          <span className="byline text-ink">Display name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            className="mt-1.5 w-full border border-hair px-3 py-2 font-body text-base text-ink focus:border-ink focus:outline-none"
          />
        </label>

        {error ? <p className="meta-mono mt-3 text-red">{error}</p> : null}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="btn-label px-3 py-2 text-slate hover:text-ink">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="btn-label bg-red px-5 py-2 text-paper transition-colors duration-150 hover:bg-red-dark disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
