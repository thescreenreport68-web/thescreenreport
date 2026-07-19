"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/* On-site search — D1 FTS5 via the tsr-search worker at /api/search (Phase 1 of
   ARCHITECTURE_MIGRATION_PLAN.md; replaced Pagefind's static index, which shipped
   ~1 file per article in the deploy bundle). Server-side BM25 ranking, snippet
   highlighting via <mark>; the snippet is our own indexed article text. */

type Hit = {
  slug: string;
  category: string;
  title: string;
  dek: string;
  date: string;
  image?: string;
  snippet: string;
};

export default function SearchBox() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  // support /search/?q=… deep links and keep the URL shareable
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q") ?? "";
    if (initial) {
      setQ(initial);
      run(initial);
    }
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function run(query: string) {
    const mine = ++seq.current;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    setFailed(false);
    fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
      .then((r) => r.json())
      .then((d) => {
        if (mine !== seq.current) return; // a newer keystroke superseded this request
        setHits(d.results ?? []);
        setFailed(Boolean(d.error));
        setBusy(false);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setHits([]);
        setFailed(true);
        setBusy(false);
      });
  }

  function onChange(v: string) {
    setQ(v);
    const url = new URL(window.location.href);
    if (v.trim()) url.searchParams.set("q", v.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(v), 250);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search The Screen Report…"
        aria-label="Search articles"
        className="w-full border-2 border-ink bg-paper px-4 py-3 font-sans text-lg text-ink outline-none placeholder:text-gray focus:border-red"
      />
      <div className="mt-6" aria-live="polite">
        {busy ? <p className="dek">Searching…</p> : null}
        {!busy && failed ? (
          <p className="dek">Search is momentarily unavailable — please try again.</p>
        ) : null}
        {!busy && !failed && hits && hits.length === 0 && q.trim().length >= 2 ? (
          <p className="dek">
            No stories match &ldquo;{q.trim()}&rdquo; yet.
          </p>
        ) : null}
        {!busy && hits && hits.length > 0 ? (
          <ol className="border-t-2 border-ink">
            {hits.map((h) => (
              <li key={h.slug} className="border-b border-dotted border-gray py-4">
                <div className="flex items-baseline gap-2.5">
                  <Link href={`/${h.category}/`} className="kicker">
                    {h.category}
                  </Link>
                  <time dateTime={h.date} className="meta-mono">
                    {String(h.date).slice(0, 10)}
                  </time>
                </div>
                <h3 className="hed-s mt-1.5 transition-colors duration-150 hover:text-red">
                  <Link href={`/${h.category}/${h.slug}/`}>{h.title}</Link>
                </h3>
                <p
                  className="dek mt-1 text-sm leading-snug [&_mark]:bg-transparent [&_mark]:font-bold [&_mark]:text-red"
                  dangerouslySetInnerHTML={{ __html: h.snippet }}
                />
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
