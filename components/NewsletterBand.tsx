"use client";

import { useState } from "react";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";

// One newsletter spec (spec §F6): white ground, 2px ink rules top and bottom,
// display-caps title + italic serif cadence line, hairline input, red button.
// Wired to the `subscribe` edge function (double opt-in). A hidden honeypot field
// ("company") catches bots; real users never see or fill it.
export default function NewsletterBand({ source = "footer" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "loading") return;
    setState("loading");
    setMsg("");
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, source, company }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        setState("done");
        setMsg(data.message ?? "Almost there! Check your inbox to confirm.");
      } else {
        setState("error");
        setMsg(data.error ?? data.message ?? "Something went wrong. Please try again.");
      }
    } catch {
      setState("error");
      setMsg("Couldn't reach the server. Please try again.");
    }
  }

  return (
    <section id="newsletter" className="my-12 border-y-2 border-ink py-8">
      <div className="grid items-center gap-6 lg:grid-cols-2">
        <div>
          <h2 className="sect-head">The Screen Report Daily</h2>
          <p className="sect-tag mt-2">
            Every story that matters in film and TV, each morning.
          </p>
        </div>

        {state === "done" ? (
          <p className="font-sans text-sm leading-relaxed text-ink lg:justify-self-end lg:text-right">
            <span className="text-red">✓</span> {msg}
          </p>
        ) : (
          <form
            onSubmit={onSubmit}
            className="w-full max-w-md lg:justify-self-end"
            aria-label="Newsletter signup"
          >
            <div className="flex">
              {/* honeypot — visually hidden, off-screen, not tabbable */}
              <input
                type="text"
                name="company"
                tabIndex={-1}
                autoComplete="off"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                aria-hidden
                className="absolute left-[-9999px] h-0 w-0 opacity-0"
              />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email address"
                className="w-full border border-ink px-3 py-2.5 font-sans text-sm text-ink placeholder:text-gray focus:outline-none"
              />
              <button
                type="submit"
                disabled={state === "loading"}
                className="btn-label whitespace-nowrap bg-red px-5 py-2.5 text-paper transition-colors duration-150 hover:bg-red-dark disabled:opacity-60"
              >
                {state === "loading" ? "…" : "Sign Up"}
              </button>
            </div>
            {state === "error" && msg ? (
              <p className="mt-2 font-sans text-xs text-red">{msg}</p>
            ) : (
              <p className="mt-2 font-sans text-xs text-gray">
                Free. Unsubscribe anytime. We'll email you to confirm.
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
