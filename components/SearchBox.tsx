"use client";

import { useEffect, useRef } from "react";

/* On-site search — Pagefind's static index (generated post-build over out/,
   article bodies only via data-pagefind-body). Zero servers, instant results.
   The UI script is loaded from /pagefind/ which exists only in the built site;
   if the index is missing (fresh dev), we show a quiet notice instead. */
export default function SearchBox() {
  const ref = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/pagefind/pagefind-ui.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "/pagefind/pagefind-ui.js";
    script.onload = () => {
      // @ts-expect-error PagefindUI is a global from the loaded script
      new PagefindUI({
        element: "#search",
        showImages: false,
        showSubResults: false,
        pageSize: 10,
        translations: {
          placeholder: "Search The Screen Report…",
          zero_results: "No stories match “[SEARCH_TERM]” yet.",
        },
      });
      const input = ref.current?.querySelector<HTMLInputElement>("input");
      input?.focus();
    };
    script.onerror = () => {
      if (ref.current) {
        ref.current.innerHTML =
          '<p class="dek">Search is being indexed — try again in a moment.</p>';
      }
    };
    document.body.appendChild(script);
  }, []);

  return <div id="search" ref={ref} className="search-shell" />;
}
