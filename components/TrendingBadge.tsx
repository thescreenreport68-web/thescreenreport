import type { Article } from "@/lib/articles";
import { getBadgeFor } from "@/lib/homepage";

/* The earned-urgency badge (HOMEPAGE_PROGRAMMING_PLAN.md §4.2). Server component —
   the trending/breaking sets are computed once per build and expire in code, so a
   stale badge can't exist. BREAKING: solid red, rarer, no motion. TRENDING: red
   kicker with the pulsing live dot (static under prefers-reduced-motion). */
export default function TrendingBadge({
  article,
  className = "",
}: {
  article: Article;
  className?: string;
}) {
  const badge = getBadgeFor(article);
  if (!badge) return null;
  if (badge === "breaking") {
    return (
      <span className={`kicker bg-red px-1.5 pb-0.5 pt-1 text-paper ${className}`}>
        Breaking
      </span>
    );
  }
  return (
    <span className={`kicker inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="dot-live self-center" aria-hidden />
      Trending
    </span>
  );
}
