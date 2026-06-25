import { CATEGORIES } from "@/lib/site";

const GRADIENTS = [
  "from-[#0F1730] via-[#1B2A52] to-[#2A3B6B]",
  "from-[#141C36] via-[#22305A] to-[#3A2E55]",
  "from-[#101A33] via-[#1E2C50] to-[#46324F]",
  "from-[#0E1730] via-[#202E58] to-[#553C2E]",
  "from-[#11182F] via-[#243463] to-[#1F4A55]",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

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
  const g = GRADIENTS[hash(slug) % GRADIENTS.length];
  const catName =
    CATEGORIES.find((c) => c.slug === category)?.name ?? "The Screen Report";
  return (
    <div
      role="img"
      aria-label={title ?? "The Screen Report"}
      className={`relative isolate flex items-end overflow-hidden bg-gradient-to-br ${g} ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, #fff 0 2px, transparent 2px 20px)",
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/55 to-transparent" />
      <span className="absolute right-3 top-3 font-serif text-[10px] uppercase tracking-[0.2em] text-white/70">
        The Screen Report
      </span>
      <div className="relative z-10 p-4 sm:p-5">
        <span className="inline-block rounded-sm bg-gold px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-navy">
          {catName}
        </span>
        {showTitle && title ? (
          <h3 className="mt-3 max-w-[20ch] font-serif text-xl font-semibold leading-tight text-white drop-shadow sm:text-2xl">
            {title}
          </h3>
        ) : null}
      </div>
    </div>
  );
}
