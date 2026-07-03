import Link from "next/link";

/* The logotype, set live in Kepler Std Semicondensed Display (the THR face,
   loaded via the Typekit kit — both upright AND italic cuts): "The" and
   "Report" upright, "Screen" in the true Didone italic, closed by the red
   period. Native type = pixel-perfect at every DPI.

   Premium tuning (owner, 2026-07-03): letters drawn TALLER and slightly
   narrower (scaleY 1.16 / scaleX 0.95 — an elongated fashion-masthead cut),
   tight word gaps, tight tracking. */

const STRETCH: React.CSSProperties = {
  transform: "scaleY(1.16) scaleX(0.95)",
  transformOrigin: "center",
  wordSpacing: "0.02em",
  letterSpacing: "-0.015em",
};

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block font-display font-bold leading-none ${className}`}
      style={STRETCH}
    >
      The <span className="italic">Screen</span> Report
      <span className="text-red">.</span>
    </span>
  );
}

export function WordmarkLink({
  className = "",
  markClassName = "",
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <Link
      href="/"
      aria-label="The Screen Report — home"
      className={`block flex-none whitespace-nowrap ${className}`}
    >
      <Wordmark className={markClassName} />
    </Link>
  );
}

/* The TSR monogram — T and R upright, S italic, red period. Used by the
   condensed sticky bar. Same elongated cut as the wordmark. */
export function TsrMark({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="The Screen Report — home"
      className={`block flex-none whitespace-nowrap ${className}`}
    >
      <span
        className="inline-block font-display text-[27px] font-bold leading-none text-ink"
        style={{
          transform: "scaleY(1.16) scaleX(0.95)",
          transformOrigin: "center",
          letterSpacing: "-0.01em",
        }}
      >
        T<span className="italic">S</span>R<span className="text-red">.</span>
      </span>
    </Link>
  );
}
