// Ad slots reserve their height so monetization never causes layout shift (CLS).
// Real ad tags (AdSense / Ad Manager / Ezoic) drop into these containers later,
// and below-the-fold slots are lazy-loaded. Until then: a quiet hairline-framed
// well with the mono ADVERTISEMENT label — no dashed borders, no size chatter.

export type AdFormat =
  | "billboard"
  | "leaderboard"
  | "rectangle"
  | "halfpage"
  | "in-feed"
  | "anchor";

const SIZES: Record<AdFormat, string> = {
  billboard: "min-h-[250px]",
  leaderboard: "min-h-[90px]",
  rectangle: "min-h-[250px] max-w-[336px] mx-auto",
  halfpage: "min-h-[600px] w-[300px] mx-auto",
  "in-feed": "min-h-[120px]",
  anchor: "min-h-[50px]",
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
  return (
    <div
      data-ad-slot={format}
      className={`flex w-full items-center justify-center border border-hair ${SIZES[format]} ${className}`}
    >
      <span className="meta-mono text-gray">{label}</span>
    </div>
  );
}
