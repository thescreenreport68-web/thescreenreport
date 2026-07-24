// learn.mjs — WHAT ACTUALLY WORKED (owner directive 2026-07-24, step 4).
//
// Until now this lane had no memory of outcomes. It could publish 230 articles nobody ever saw and
// never notice — which is precisely what happened (57 of 290 articles ever earned an impression).
// This module closes the loop: it joins GSC page data to this lane's own published ledger, works out
// which KINDS of story actually earn search appearances, and returns a small bias that FIND applies
// to future selection.
//
// ── DELIBERATELY CONSERVATIVE ────────────────────────────────────────────────────────────────────
// The bias is small (+/- a few points) and requires a minimum sample per bucket. Reasons:
//   · the site is crawl-parked, so "earned zero impressions" currently says more about Google's
//     crawling than about the story — a strong bias would learn the wrong lesson from a broken period
//   · a runaway feedback loop would collapse coverage onto one category and starve the rest
// It is a nudge that sharpens as the sample grows, never an editorial policy.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART_DIR = path.resolve(__dirname, "../../content/articles");
const LEDGER = path.resolve(__dirname, "../../data/find/published.json");
const OUT = path.resolve(__dirname, "../../data/find/gsc/performance.json");

const MIN_SAMPLE = Number(process.env.LEARN_MIN_SAMPLE ?? 8);   // per bucket, before it may bias anything
export const LEARN_CAP = Number(process.env.LEARN_CAP ?? 5);     // max +/- points from learning

// Which of MY articles earned impressions, bucketed by category and by formatTag.
export function performance(demand, { artDir = ART_DIR, ledger = LEDGER } = {}) {
  if (!demand?.ok || !demand.pages?.length) return { ok: false, reason: "no demand data", buckets: {} };
  let mine = new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(ledger, "utf8"));
    const arr = Array.isArray(raw) ? raw : raw.records || raw.published || [];
    mine = new Set(arr.map((r) => r && r.slug).filter(Boolean));
  } catch { return { ok: false, reason: "no ledger", buckets: {} }; }
  if (!mine.size) return { ok: false, reason: "empty ledger", buckets: {} };

  const impr = new Map(demand.pages.map((p) => [p.slug, p.impressions]));
  const buckets = {};
  const add = (key, got) => {
    const b = (buckets[key] ||= { n: 0, earners: 0, impressions: 0 });
    b.n++; if (got > 0) { b.earners++; b.impressions += got; }
  };
  let files = [];
  try { files = fs.readdirSync(artDir).filter((f) => f.endsWith(".md")); } catch { return { ok: false, reason: "no articles dir", buckets: {} }; }
  // Counted per ARTICLE, not per bucket entry: each article lands in both a category and a format
  // bucket, so summing bucket sizes double-counts and would report twice the real sample.
  let articles = 0, earners = 0;
  for (const f of files) {
    const slug = f.replace(/\.md$/, "");
    if (!mine.has(slug)) continue;                       // this lane's output only
    let d;
    try { d = matter(fs.readFileSync(path.join(artDir, f), "utf8")).data || {}; } catch { continue; }
    const got = impr.get(slug) || 0;
    articles++; if (got > 0) earners++;
    if (d.category) add(`category:${d.category}`, got);
    if (d.formatTag) add(`format:${d.formatTag}`, got);
  }
  // hit-rate per bucket, judged against the true per-article baseline
  const baseline = articles ? earners / articles : 0;
  for (const [k, b] of Object.entries(buckets)) {
    b.hitRate = b.n ? b.earners / b.n : 0;
    b.enough = b.n >= MIN_SAMPLE;
    b.lift = b.enough && baseline > 0 ? b.hitRate / baseline : 1;
  }
  return { ok: true, baseline, sample: articles, earners, buckets, computedAt: new Date().toISOString() };
}

// A small, bounded nudge for a candidate based on how its category/format has actually performed.
export function learnPoints(topic, perf, cap = LEARN_CAP) {
  if (!perf?.ok || !perf.sample) return 0;
  let pts = 0;
  for (const key of [`category:${topic?.category}`, `format:${topic?.formatTag}`]) {
    const b = perf.buckets[key];
    if (!b || !b.enough) continue;                        // never act on a thin sample
    if (b.lift >= 1.5) pts += 2;
    else if (b.lift >= 1.15) pts += 1;
    else if (b.lift <= 0.4) pts -= 2;
    else if (b.lift <= 0.75) pts -= 1;
  }
  return Math.max(-cap, Math.min(cap, pts));
}

export function savePerformance(perf, out = OUT) {
  try { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(perf, null, 2)); } catch { /* reporting only */ }
}

// ── EVERGREEN OPPORTUNITIES (owner-approved trial, 2–3/week max) ─────────────────────────────────
// Our steadiest earners are not news at all: "Best A24 Movies Ranked" pulled 136 impressions and
// "Highest Grossing Movie of All Time" 34, both continuing to earn with no news hook. This finds
// reference-style demand — clusters of list/ranking/winner queries — and reports which clusters we
// already have a page for (improve it) versus not (a candidate to write).
const REFERENCE = /\b(best|top|ranked|ranking|list|greatest|worst|winners?|highest|grossing|all time|how many|what is|which|where to watch|explained|guide|vs\.?|compared)\b/i;

export function evergreenOpportunities(demand, { minImpressions = 2 } = {}) {
  if (!demand?.ok || !demand.queries?.length) return [];
  const STOP = new Set(["the", "a", "an", "of", "and", "for", "with", "in", "on", "to", "best", "top", "ranked", "ranking", "list", "movies", "movie", "films", "film", "all", "time"]);
  const key = (q) => q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).sort().join(" ");
  const clusters = new Map();
  for (const r of demand.queries) {
    if (!REFERENCE.test(r.q)) continue;
    const k = key(r.q);
    if (!k) continue;
    const c = clusters.get(k) || { key: k, queries: [], impressions: 0, clicks: 0, bestPosition: null };
    c.queries.push(r.q); c.impressions += r.impressions; c.clicks += r.clicks;
    if (c.bestPosition == null || r.position < c.bestPosition) c.bestPosition = r.position;
    clusters.set(k, c);
  }
  // does a page of ours already serve this cluster?
  const pageSlugs = demand.pages.map((p) => ({ slug: p.slug, impressions: p.impressions, position: p.position }));
  const out = [];
  for (const c of clusters.values()) {
    if (c.impressions < minImpressions) continue;
    const words = c.key.split(" ");
    const existing = pageSlugs.find((p) => words.filter((w) => p.slug.includes(w)).length >= Math.min(2, words.length));
    out.push({
      ...c,
      variants: c.queries.length,
      existingPage: existing ? existing.slug : null,
      existingPosition: existing ? existing.position : null,
      action: existing ? "improve existing page (already ranking — never a new URL)" : "candidate for a NEW evergreen page",
    });
  }
  return out.sort((a, b) => b.impressions - a.impressions || b.variants - a.variants);
}
