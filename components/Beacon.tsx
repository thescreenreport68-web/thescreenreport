"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { BEACON_URL } from "@/lib/beacon";

/* One aggregate pageview ping per navigation (HOMEPAGE_PROGRAMMING_PLAN.md
   Phase 2). Cookieless, no identifiers, fire-and-forget; honors Do Not Track;
   no-ops entirely while BEACON_URL is unset. */
export default function Beacon() {
  const pathname = usePathname();

  useEffect(() => {
    if (!BEACON_URL) return;
    if (typeof navigator !== "undefined" && navigator.doNotTrack === "1") return;
    try {
      fetch(BEACON_URL, {
        method: "POST",
        body: JSON.stringify({ p: pathname }),
        keepalive: true,
        mode: "cors",
        headers: { "Content-Type": "text/plain" },
      }).catch(() => {});
    } catch {
      /* never let analytics break the page */
    }
  }, [pathname]);

  return null;
}
