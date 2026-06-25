import { CATEGORIES } from "@/lib/site";

// Stand-in photography so the layout can be visualized. These are random
// royalty-free stock images (Lorem Picsum), seeded by slug so each article keeps
// a consistent image. They are placeholders only — real, licensed cinema/celebrity
// images come from the legal image pipeline later.
export default function PlaceholderImage({
  slug,
  category,
  title,
  className = "",
  showTitle = false,
}: {
  slug: string;
  category?: string;
  title?: string;
  className?: string;
  showTitle?: boolean;
}) {
  const src = `https://picsum.photos/seed/sr-${encodeURIComponent(slug)}/1200/675`;
  const catName =
    CATEGORIES.find((c) => c.slug === category)?.name ?? "The Screen Report";
  return (
    <div
      className={`relative isolate overflow-hidden bg-navy/90 ring-1 ring-black/5 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={title ?? catName}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {showTitle && title ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5">
            <span className="inline-block rounded-sm bg-gold px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-navy">
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
