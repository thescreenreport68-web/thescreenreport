"use client";

import { useEffect, useRef, useState } from "react";
import { COMMENTS_ENABLED } from "@/lib/supabase";
import Comments from "./Comments";

/* Lazy mount: the comment island loads when the reader nears it, so it never
   affects article LCP/CWV — with a scroll fallback and a short idle fallback so
   it can't get stuck (deep-links to #comments, IO-blocking extensions, etc.).
   No-op entirely when comments are disabled. */
export default function CommentsMount({ slug }: { slug: string }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!COMMENTS_ENABLED) return;
    const el = ref.current;
    if (!el) return;
    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      setShow(true);
      cleanup();
    };
    const check = () => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight + 800) reveal();
    };
    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((e) => e.isIntersecting)) reveal();
            },
            { rootMargin: "800px" },
          )
        : null;
    const idle = window.setTimeout(reveal, 2000); // last-resort fallback
    function cleanup() {
      io?.disconnect();
      window.removeEventListener("scroll", check);
      window.clearTimeout(idle);
    }
    io?.observe(el);
    window.addEventListener("scroll", check, { passive: true });
    check();
    return cleanup;
  }, []);

  if (!COMMENTS_ENABLED) return null;
  return <div ref={ref}>{show ? <Comments slug={slug} /> : null}</div>;
}
