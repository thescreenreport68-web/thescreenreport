"use client";

import { useEffect, useRef } from "react";
import { getSupabase } from "@/lib/supabase";
import { promptOneTap } from "@/lib/googleAuth";

/* The site-wide One Tap auto-popup (COMMENTS_SYSTEM_PLAN.md §1): appears top-right
   on desktop / bottom sheet on mobile the moment a signed-out reader opens the
   site. Only prompts when there's no existing session. All the GSI wiring lives
   in lib/googleAuth (shared with the comment composer's sign-in button). */
export default function GoogleOneTap() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const supabase = getSupabase();
    if (!supabase) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) promptOneTap();
    })();
  }, []);
  return null;
}
