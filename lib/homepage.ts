import fs from "node:fs";
import path from "node:path";
import type { Article } from "./articles";
import { getAllArticles } from "./articles";

/* The homepage placement engine (HOMEPAGE_PROGRAMMING_PLAN.md).
   Pure build-time math over signals the FIND pipeline already computes:
   every article carries trendScore + signals{recency,corroboration,status,type,
   pop,breakout} (frontmatter for new articles, published.json join for older
   ones). Heat ranks slots; a decayed velocity score drives TRENDING/BREAKING
   badges. Everything recomputes at each rebuild, so badges expire in code. */

// ============ TUNABLES — tune monthly, keep in this one block (§2-4) ============
export const HOMEPAGE = {
  GRAVITY_HOT: 1.6, // hero + trending: fast churn (~5h half-life)
  GRAVITY_BALANCED: 1.0, // must reads
  GRAVITY_SLOW: 0.4, // evergreen-ish modules
  BASE_SCORE: 30, // trendScore prior for articles without pipeline signals

  HERO_AGE_LADDER_H: [24, 48, 72], // widen the window on slow days
  HERO_MIN_IMAGE_WIDTH: 1200,
  HERO_FORMS: new Set(["news", "box-office", "awards", "music-news", "music-awards", "trailer"]),

  TRENDING_HALF_LIFE_H: 8,
  TRENDING_MAX_AGE_H: 24,
  TRENDING_MIN_SCORE: 12,
  TRENDING_MAX_COUNT: 8, // top-N cap — scarcity keeps the badge credible

  BREAKING_MAX_AGE_H: 2,
  BREAKING_MIN_OUTLETS: 2,
  BREAKING_MAX_COUNT: 2,

  TRENDING_RAIL_SLOTS: 6,
  TRENDING_RAIL_PER_CATEGORY: 2,
};

// High-engagement personal-event types (find/expand.mjs TIER_S).
const TIER_S = new Set([
  "death",
  "arrest",
  "divorce",
  "breakup",
  "marriage",
  "scandal",
  "lawsuit",
  "pregnancy",
  "birth",
]);

// ---- published.json join: trend signals for articles published before the
// frontmatter fields existed (ledger keyed by slug) ----
type LedgerRec = {
  slug?: string;
  priority?: number;
  signals?: Article["signals"];
};
let ledger: Map<string, LedgerRec> | null = null;
function ledgerFor(slug: string): LedgerRec | undefined {
  if (!ledger) {
    ledger = new Map();
    try {
      const p = path.join(process.cwd(), "data", "find", "published.json");
      const rows = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const r of Array.isArray(rows) ? rows : rows?.published ?? []) {
        if (r?.slug) ledger.set(r.slug, r);
      }
    } catch {
      /* no ledger — signals just fall back to the prior */
    }
  }
  return ledger.get(slug);
}

function hoursSince(iso: string | undefined, now: number): number {
  if (!iso) return 9999;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 9999;
  return Math.max(0, (now - t) / 3_600_000);
}

function trendScoreOf(a: Article): number {
  return a.trendScore ?? ledgerFor(a.slug)?.priority ?? HOMEPAGE.BASE_SCORE;
}

function signalsOf(a: Article): NonNullable<Article["signals"]> {
  return a.signals ?? ledgerFor(a.slug)?.signals ?? {};
}

function isPinned(a: Article, now: number): boolean {
  if (!a.featured) return false;
  if (!a.pinnedUntil) return true;
  const t = new Date(a.pinnedUntil).getTime();
  return isNaN(t) || now < t;
}

// ============ HEAT — the placement score (§2) ============
export function heat(a: Article, now: number, gravity: number): number {
  let score = trendScoreOf(a);
  if (a.eventType && TIER_S.has(a.eventType)) score += 10;
  if (a.storyStatus === "CONFIRMED") score += 8;
  else if (a.storyStatus === "DEVELOPING") score += 4;
  else if (a.storyStatus === "RUMOR") score -= 15;
  if (isPinned(a, now)) score += 1000;
  return score / Math.pow(hoursSince(a.date, now) + 2, gravity);
}

// ============ TRENDING (§4.1) — supply-side velocity, 8h half-life ============
export function trendingScore(a: Article, now: number): number {
  const h = hoursSince(a.date, now);
  if (h > HOMEPAGE.TRENDING_MAX_AGE_H) return 0;
  const s = signalsOf(a);
  if (!s || Object.keys(s).length === 0) return 0; // no signals → never trends
  // A real post-publish update (recheck promotion / correction) re-heats the story.
  const promoteBonus = a.updated && a.updated !== a.date ? 10 : 0;
  const base =
    (s.breakout ?? 0) * 3 +
    (s.corroboration ?? 0) * 1.5 +
    (s.type ?? 0) +
    promoteBonus;
  return base * Math.pow(0.5, h / HOMEPAGE.TRENDING_HALF_LIFE_H);
}

function isBreaking(a: Article, now: number): boolean {
  return (
    !!a.eventType &&
    TIER_S.has(a.eventType) &&
    (a.storyStatus === "CONFIRMED" || a.storyStatus === "DEVELOPING") &&
    hoursSince(a.date, now) <= HOMEPAGE.BREAKING_MAX_AGE_H &&
    (a.outletCount ?? 0) >= HOMEPAGE.BREAKING_MIN_OUTLETS
  );
}

// ---- the badge sets, computed once per build ----
let badgeCache: { trending: Set<string>; breaking: Set<string> } | null = null;
function badgeSets(): { trending: Set<string>; breaking: Set<string> } {
  if (badgeCache) return badgeCache;
  const now = Date.now();
  const all = getAllArticles();
  const trending = new Set(
    all
      .map((a) => ({ slug: a.slug, s: trendingScore(a, now) }))
      .filter((x) => x.s >= HOMEPAGE.TRENDING_MIN_SCORE)
      .sort((x, y) => y.s - x.s)
      .slice(0, HOMEPAGE.TRENDING_MAX_COUNT)
      .map((x) => x.slug)
  );
  const breaking = new Set(
    all
      .filter((a) => isBreaking(a, now))
      .sort((x, y) => heat(y, now, HOMEPAGE.GRAVITY_HOT) - heat(x, now, HOMEPAGE.GRAVITY_HOT))
      .slice(0, HOMEPAGE.BREAKING_MAX_COUNT)
      .map((a) => a.slug)
  );
  badgeCache = { trending, breaking };
  return badgeCache;
}

// The one badge decision every card/page asks for. Breaking outranks trending.
export function getBadgeFor(a: Article): "breaking" | "trending" | null {
  const { trending, breaking } = badgeSets();
  if (breaking.has(a.slug)) return "breaking";
  if (trending.has(a.slug)) return "trending";
  return null;
}

// ============ HERO (§3) ============
function heroEligible(a: Article, now: number, maxAgeH: number): boolean {
  if (!a.image) return false;
  if (a.imageWidth !== undefined && a.imageWidth < HOMEPAGE.HERO_MIN_IMAGE_WIDTH) return false;
  if (!a.formatTag || !HOMEPAGE.HERO_FORMS.has(a.formatTag)) return false;
  if (a.storyStatus === "RUMOR" || a.storyStatus === "HOLD") return false;
  if (hoursSince(a.date, now) > maxAgeH) return false;
  return true;
}

export function pickHero(all: Article[], now: number): Article {
  const pinned = all.filter((a) => isPinned(a, now));
  if (pinned.length) return pinned[0]; // newest pinned (list is date-sorted)
  for (const window of HOMEPAGE.HERO_AGE_LADDER_H) {
    const pool = all.filter((a) => heroEligible(a, now, window));
    if (pool.length) {
      return pool.reduce((best, a) =>
        heat(a, now, HOMEPAGE.GRAVITY_HOT) > heat(best, now, HOMEPAGE.GRAVITY_HOT) ? a : best
      );
    }
  }
  // Slow-week fallback: newest story with art; never an empty hero.
  return all.find((a) => a.image) ?? all[0];
}

// ============ SLOT ASSEMBLY HELPERS (§5) ============
export function byHeat(pool: Article[], now: number, gravity: number): Article[] {
  return [...pool].sort((a, b) => heat(b, now, gravity) - heat(a, now, gravity));
}

// Greedy pick with slug + eventSlug dedup and an optional per-category cap.
export function pickDiverse(
  pool: Article[],
  n: number,
  used: { slugs: Set<string>; events: Set<string> },
  perCategoryCap?: number
): Article[] {
  const out: Article[] = [];
  const catCount = new Map<string, number>();
  for (const a of pool) {
    if (out.length >= n) break;
    if (used.slugs.has(a.slug)) continue;
    if (a.eventSlug && used.events.has(a.eventSlug)) continue;
    if (perCategoryCap !== undefined) {
      const c = catCount.get(a.category) ?? 0;
      if (c >= perCategoryCap) continue;
      catCount.set(a.category, c + 1);
    }
    out.push(a);
    used.slugs.add(a.slug);
    if (a.eventSlug) used.events.add(a.eventSlug);
  }
  return out;
}

// The Trending Now rail: top by trending score, capped per category, deduped.
export function trendingRail(
  all: Article[],
  now: number,
  used: { slugs: Set<string>; events: Set<string> }
): { items: Article[]; isTrending: boolean } {
  const scored = all
    .map((a) => ({ a, s: trendingScore(a, now) }))
    .filter((x) => x.s >= HOMEPAGE.TRENDING_MIN_SCORE)
    .sort((x, y) => y.s - x.s)
    .map((x) => x.a);
  const picks = pickDiverse(
    scored,
    HOMEPAGE.TRENDING_RAIL_SLOTS,
    used,
    HOMEPAGE.TRENDING_RAIL_PER_CATEGORY
  );
  if (picks.length >= 3) return { items: picks, isTrending: true };
  // Not enough genuine trending stories → heat-ranked top stories, honestly unbadged.
  // (Return picks' slots to the pool first.)
  picks.forEach((a) => {
    used.slugs.delete(a.slug);
    if (a.eventSlug) used.events.delete(a.eventSlug);
  });
  const fallback = pickDiverse(
    byHeat(all, now, HOMEPAGE.GRAVITY_HOT),
    HOMEPAGE.TRENDING_RAIL_SLOTS,
    used,
    HOMEPAGE.TRENDING_RAIL_PER_CATEGORY
  );
  return { items: fallback, isTrending: false };
}
