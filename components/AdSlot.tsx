// Ad slots reserve their height so monetization never causes layout shift (CLS).
// Real ad tags (AdSense / Ad Manager / Ezoic) drop into these containers later,
// and below-the-fold slots are lazy-loaded. For now they render a labeled placeholder.

export type AdFormat =
  | "billboard"
  | "leaderboard"
  | "rectangle"
  | "halfpage"
  | "in-feed"
  | "anchor";

const SIZES: Record<AdFormat, { label: string; box: string }> = {
  billboard: { label: "970×250 / 728×90", box: "min-h-[250px]" },
  leaderboard: { label: "728×90", box: "min-h-[90px]" },
  rectangle: { label: "300×250", box: "min-h-[250px] max-w-[336px] mx-auto" },
  halfpage: { label: "300×600", box: "min-h-[600px] w-[300px] mx-auto" },
  "in-feed": { label: "Native / In-feed", box: "min-h-[120px]" },
  anchor: { label: "320×50", box: "min-h-[50px]" },
};

export default function AdSlot({
  format = "rectangle",
  className = "",
  label = "Advertisement",
}: {
  format?: AdFormat;
  className?: string;
  label?: string;
}) {
  const s = SIZES[format];
  return (
    <div
      data-ad-slot={format}
      className={`flex w-full items-center justify-center rounded border border-dashed border-navy/20 bg-mist/70 ${s.box} ${className}`}
    >
      <div className="text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-navy/40">
          {label}
        </div>
        <div className="mt-1 text-[11px] text-navy/30">{s.label}</div>
      </div>
    </div>
  );
}
