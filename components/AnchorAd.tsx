"use client";

import { useState } from "react";

/* Bottom anchor/adhesion ad (THR-style, upgraded per the owner's spec):
   - expanded on page load, exactly one, bottom edge only;
   - a chevron TAB notched above the bar's top-right corner collapses it
     (bar slides down via transform — zero layout shift) and stays visible
     so the reader can re-expand at any time;
   - policy-compliant: dismissible, ≤100px tall, never overlaps content
     (layout.tsx reserves a constant spacer), label always visible;
   - transform/opacity-only animation, motion-reduce safe, iOS safe-area aware;
   - z-40: above content, below header dropdowns (z-99+) and modals (z-120),
     so an open modal always covers the ad. Real ad tags drop into the inner
     reserved box later; heights stay constant so swaps can't shift layout. */

function Chevron({ down }: { down: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 motion-reduce:transition-none ${down ? "" : "rotate-180"}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function AnchorAd() {
  const [open, setOpen] = useState(true);

  return (
    <div
      role="complementary"
      aria-label="Advertisement"
      className={`fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ease-out motion-reduce:transition-none ${
        open ? "translate-y-0" : "translate-y-full"
      }`}
    >
      {/* The collapse/expand tab — notched above the bar's top-right corner
          (THR's affordance, with the chevron the owner asked for). It rides
          with the bar, so when the bar slides down the tab stays reachable
          at the bottom edge of the screen. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Hide advertisement" : "Show advertisement"}
        className="absolute -top-7 right-3 flex h-7 w-11 items-center justify-center border border-b-0 border-hair bg-paper text-slate transition-colors duration-150 hover:text-red"
      >
        <Chevron down={open} />
      </button>

      <div
        className="border-t border-hair bg-paper/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="mx-auto flex h-[58px] max-w-wide items-center justify-center px-4 md:h-[98px]">
          <div
            data-ad-slot="anchor"
            className="flex h-[50px] w-[320px] items-center justify-center border border-hair md:h-[90px] md:w-[728px]"
          >
            <span className="meta-mono text-gray">Advertisement</span>
          </div>
        </div>
      </div>
    </div>
  );
}
