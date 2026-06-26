import { CATEGORIES } from "@/lib/site";

// Renders a real image when `src` is provided (legally-sourced Wikimedia Commons
// photo per article), otherwise a seeded stock stand-in. Alt text is SEO-optimized.
export default function PlaceholderImage({
  slug,
  category,
  title,
  className = "",
  showTitle = false,
  src,
  alt,
  eager = false,
  width,
  height,
}: {
  slug: string;
  category?: string;
  title?: string;
  className?: string;
  showTitle?: boolean;
  src?: string;
  alt?: string;
  eager?: boolean;
  width?: number;
  height?: number;
}) {
  const imgSrc =
    src || `https://picsum.photos/seed/sr-${encodeURIComponent(slug)}/1200/675`;
  const catName =
    CATEGORIES.find((c) => c.slug === category)?.name ?? "The Screen Report";
  const altText = alt || title || catName;
  return (
    <div
      className={`relative isolate overflow-hidden bg-mist ring-1 ring-black/5 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imgSrc}
        alt={altText}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        decoding={eager ? "auto" : "async"}
        className="absolute inset-0 h-full w-full object-cover object-[center_30%]"
      />
      {showTitle && title ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5">
            <span className="inline-block rounded-sm bg-gold px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">
              {catName}
            </span>
            <h3 className="mt-2 max-w-[22ch] font-display text-2xl font-semibold leading-tight text-white drop-shadow">
              {title}
            </h3>
          </div>
        </>
      ) : null}
    </div>
  );
}
