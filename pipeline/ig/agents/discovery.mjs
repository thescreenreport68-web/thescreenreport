// AGENT 0.5 — POPULARITY ENGINE v2 (owner 2026-07-17): STORY-FIRST discovery.
// The owner's rule, made mechanical: a story's own HEAT qualifies it regardless of who it is about
// (an unknown actress dying in a crash IS the story — Wai Ching Ho: 84 views/day baseline, 21,435 on
// her death day = 254×), while FAME amplifies (Jennifer Lawrence + a personal-surprise beat qualifies
// with no spike at all — 7.5k/day baseline never spiked 1.5× in a quiet month).
//
// Every fresh candidate gets two numbers from FREE, keyless-or-already-keyed sources ($0 added cost):
//   storyHeat (0-100) = strongest of: the article's own trendScore (news/box-office lanes stamp it),
//     the Wikipedia pageview SPIKE ratio (latest day ÷ 14-day median baseline; 5×→60 25×→90 100×→100,
//     gated on ≥ minSpikeViews raw views), and an EVENT-TYPE prior (death 90, accident 85, arrest/
//     lawsuit 75, split/engagement/pregnancy 70, feud/transformation 65 …) + a Google-Trends +15 boost.
//   fame (0-100) = the person's NORMAL Wikipedia baseline (median daily views, spike excluded) on a
//     log scale: 84/day→~18, 2.5k→~65, 7.5k→~80. (TMDB "popularity" is deliberately NOT used for fame —
//     it measures current heat, not stature: it ranked a just-deceased actor 6× above J-Law.)
//
// QUALIFICATION (the owner's two examples verbatim):
//   storyHeat ≥ qualifyHeat  → in, fame irrelevant (unknown actor, hot story)
//   OR fame ≥ qualifyFame AND a personal-surprise beat (death/arrest/split/engagement/pregnancy/
//   transformation/feud) → in, no spike needed (J-Law dyes her hair)
// Non-qualifiers are not deleted — they rank BELOW qualifiers (thin-pool days still fill the batch).
//
// FAIL-OPEN is a hard design rule: any API down → that signal is null → neutral; the whole engine
// failing → the caller keeps the old recency order. An outage can never produce an empty slate.
// Wikipedia's pageview data lags ~1 day, so a MISSING spike on a <24h-old story is never "cold".
import path from "node:path";
import { IG } from "../config.mjs";
import { fetchWithTimeout, readJson, writeJson, todayInTz } from "../lib/util.mjs";
import { loadWeights } from "../lib/ledger.mjs";

const UA = { "User-Agent": "TheScreenReport/1.0 (editor@thescreenreport.com)" };
const cacheFile = () => path.join(IG.dataDir, "discovery-cache.json");

// ── pure scoring functions (unit-tested offline) ─────────────────────────────────

// fame from the spike-free Wikipedia baseline (median daily views), log-calibrated on real anchors:
// 84/day (Wai Ching Ho) → ~18 · 2.5k (working actor) → ~65 · 7.5k (J-Law) → ~80 · 30k+ → ~100
export function fameFromBaseline(baselineDaily) {
  if (baselineDaily == null || !(baselineDaily >= 0)) return null;
  return Math.max(0, Math.min(100, 13.9 * Math.log(Math.max(1, baselineDaily)) - 43.4));
}

// heat from a pageview spike: ratio 5× = 60 (the validated hot/noise threshold), 25× = 90, ≥100× = 100.
// Below 5× credit falls off quadratically (2×≈10 — noise). Raw-view floor keeps tiny pages from "spiking".
export function heatFromSpike(ratio, rawViews, minViews = IG.discovery?.minSpikeViews ?? 2000) {
  if (ratio == null || !(ratio > 0) || !(rawViews >= minViews)) return 0;
  if (ratio >= 5) return Math.min(100, 60 + 18.6 * Math.log(ratio / 5));
  return Math.max(0, 60 * (ratio / 5) ** 2);
}

// event-type prior: what CLASS of story is this? News-lane articles carry eventType in frontmatter;
// gossip articles carry nothing → classify from the title. Death/accident are reliably high-interest
// (and day-0 stories have no Wikipedia data yet — the prior is what catches them immediately).
const EVENT_PRIORS = [
  { type: "death", prior: 90, surprise: true, re: /\b(dies|dead|death|dies at \d|passed away|obituar|killed|fatal)\b/i },
  { type: "accident", prior: 85, surprise: true, re: /\b(crash|accident|hospitalized|hospital|injured|collapse[sd]?|emergency)\b/i },
  { type: "arrest-legal", prior: 75, surprise: true, re: /\b(arrest\w*|charged|charges|lawsuit|sue[sd]|suing|indicted|guilty|sentenced|jail|prison|custody)\b/i },
  { type: "split", prior: 70, surprise: true, re: /\b(divorce|split|breakup|break up|separat\w+|calls? it quits)\b/i },
  { type: "engagement-baby", prior: 70, surprise: true, re: /\b(engaged|engagement|wedding|married|marries|pregnant|expecting|baby|welcomes)\b/i },
  { type: "feud", prior: 65, surprise: true, re: /\b(feud|slams|fires back|blasts|calls out|clash\w*|war of words)\b/i },
  { type: "transformation", prior: 65, surprise: true, re: /\b(unrecognizable|transform\w*|new look|debuts .{0,20}(hair|look)|dyed|weight|shaved)\b/i },
  { type: "record-money", prior: 60, surprise: false, re: /\b(record|smash\w*|biggest|highest|box office|\$\d|million|billion)\b/i },
  { type: "casting", prior: 55, surprise: false, re: /\b(cast[s]?\b|casting|joins|lands (the )?(role|lead)|to star|starring|replace[sd]?)\b/i },
  { type: "first-look", prior: 50, surprise: false, re: /\b(first look|first-look|trailer|teaser|poster|unveil\w*|reveal\w*)\b/i },
];
export function eventPrior(candidate) {
  const fmType = String(candidate.eventType || "").toLowerCase();
  if (fmType) {
    const hit = EVENT_PRIORS.find((e) => fmType.includes(e.type.split("-")[0]));
    if (hit) return hit;
  }
  const text = `${candidate.title || ""} ${candidate.dek || ""}`;
  for (const e of EVENT_PRIORS) if (e.re.test(text)) return e;
  return { type: "other", prior: 35, surprise: false };
}

// combine the independent signals: strongest wins (they are alternative EVIDENCE of the same thing),
// Google-Trends presence is a boost on top (its feed is tiny — absence must never hurt).
export function storyHeat({ trendScore, spikeHeat, prior, inTrends }) {
  const base = Math.max(
    Number.isFinite(trendScore) ? Math.max(0, Math.min(100, trendScore)) : 0,
    spikeHeat || 0,
    prior || 0,
  );
  return Math.min(100, base + (inTrends ? 15 : 0));
}

export function qualifies({ heat, fame, surprise }, cfg = IG.discovery) {
  if (heat >= (cfg?.qualifyHeat ?? 60)) return "heat";
  if ((fame ?? 0) >= (cfg?.qualifyFame ?? 70) && surprise) return "fame";
  return null;
}

// deterministic pre-rank score (the LLM refines the final slate afterwards)
export function starPower({ heat, fame, segRel = 1 }) {
  const fameVal = fame ?? 40; // unknown entity → neutral, never punitive
  const learned = Math.max(-6, Math.min(6, (segRel - 1) * 20)); // learner rel 0.7-1.3 → ±6
  return Math.max(0, Math.min(100, 0.6 * heat + 0.25 * fameVal + 15 + learned)); // +15 centers the 15% learned band
}

// ENTITY DERIVATION (2026-07-17, live-run finding): most articles carry NO primaryEntity frontmatter
// (the Sam Neill obit had none), so without a fallback the fame/spike signals never fire. Chain:
// frontmatter primaryEntity → imageAlt when it IS a bare name → the title's leading proper-noun phrase.
// The name test = 2-4 capitalized tokens only (a single token like "Daredevil" or "Lost" is a title,
// not a person — excluded; wiki search fail-opens on any residual misses).
const NAMEISH = /^[A-Z][A-Za-z'’.-]*$/;
function leadingName(text) {
  const words = String(text || "").trim().split(/\s+/);
  const out = [];
  for (const w of words) {
    const bare = w.replace(/[,:;!?'’"]+$/g, "");
    if (!NAMEISH.test(bare) || out.length >= 4) break;
    out.push(bare);
    if (bare !== w) break; // token carried trailing punctuation ("Neill,") — the phrase ends here
  }
  return out.length >= 2 ? out.join(" ") : null;
}
export function entityFromCandidate(c) {
  const explicit = String(c.primaryEntity || "").trim();
  if (explicit.length > 2) return explicit;
  const alt = String(c.imageAlt || "").trim();
  if (alt && /^([A-Z][A-Za-z'’.-]*\s+){1,3}[A-Z][A-Za-z'’.-]*$/.test(alt)) return alt; // a bare 2-4-word name
  return leadingName(c.title);
}

// ── free signal fetchers (all fail-open to null) ──────────────────────────────────

async function wikiSignals(name, deps) {
  try {
    // 1) resolve the entity to a wiki title
    const s = await deps.fetchJson(
      `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(name)}&limit=1`,
      { headers: UA }, 8000,
    );
    const key = s?.pages?.[0]?.key;
    if (!key) return { found: false };
    // 2) daily pageviews, last ~18 days (API lags ~1 day)
    const day = (offset) => {
      const d = new Date(Date.now() - offset * 864e5);
      return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
    };
    const pv = await deps.fetchJson(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(key)}/daily/${day(18)}/${day(1)}`,
      { headers: UA }, 8000,
    );
    const items = (pv?.items || []).map((i) => i.views).filter((v) => Number.isFinite(v));
    if (items.length < 8) return { found: true, key }; // too little history for a stable baseline
    const latest = Math.max(items[items.length - 1] || 0, items[items.length - 2] || 0);
    const earlier = items.slice(0, -2).sort((a, b) => a - b);
    const baseline = earlier[Math.floor(earlier.length / 2)] || 1; // median (spike-resistant)
    return { found: true, key, latest, baseline, ratio: latest / Math.max(1, baseline) };
  } catch {
    return null; // API down → signal drops out (fail-open)
  }
}

async function trendingNames(deps) {
  try {
    const xml = await deps.fetchText("https://trends.google.com/trending/rss?geo=US", { headers: UA }, 8000);
    return [...String(xml).matchAll(/<title>(?:<!\[CDATA\[)?([^<\]]+)/g)].map((m) => m[1].toLowerCase().trim()).slice(1, 30);
  } catch {
    return []; // absence must never disqualify
  }
}

// ── the engine ─────────────────────────────────────────────────────────────────────

async function pool(items, worker, concurrency = 6) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
      while (next < items.length) { const i = next++; out[i] = await worker(items[i], i); }
    }),
  );
  return out;
}

const realDeps = {
  fetchJson: async (url, opts, ms) => { const r = await fetchWithTimeout(url, opts, ms); return r.ok ? r.json() : null; },
  fetchText: async (url, opts, ms) => { const r = await fetchWithTimeout(url, opts, ms); return r.ok ? r.text() : null; },
};

// Score EVERY candidate in the pool. Returns the candidates decorated with
// { starPower, heat, fame, qualified, signals } — sorted DESC by starPower (recency tie-break).
// Entity lookups are cached per LA-day in the committed data dir (cross-run warm).
export async function scorePool(candidates, deps = realDeps) {
  const cfg = IG.discovery || {};
  const today = todayInTz(IG.slots?.postTz || "America/Los_Angeles");
  const cache = readJson(cacheFile(), {});
  if (cache._date !== today) { for (const k of Object.keys(cache)) delete cache[k]; cache._date = today; } // daily reset
  const weights = loadWeights();

  const trends = await trendingNames(deps);
  let lookups = 0;
  const names = [...new Set(candidates.map((c) => entityFromCandidate(c) || "").filter((n) => n.length > 2))];
  await pool(names, async (name) => {
    const k = name.toLowerCase();
    if (cache[k] !== undefined) return;
    if (lookups >= (cfg.maxLookupsPerRun ?? 120)) { return; } // over budget → stays neutral this run
    lookups++;
    cache[k] = await wikiSignals(name, deps); // null (API down) cached too — retried tomorrow, not per-run
  });
  try { writeJson(cacheFile(), cache); } catch {}

  const scored = candidates.map((c) => {
    const name = (entityFromCandidate(c) || "").toLowerCase();
    const wiki = name ? cache[name] : null;
    const prior = eventPrior(c);
    const spikeHeat = wiki?.ratio != null ? heatFromSpike(wiki.ratio, wiki.latest, cfg.minSpikeViews) : 0;
    const fame = wiki?.baseline != null ? fameFromBaseline(wiki.baseline) : null;
    const inTrends = name ? trends.some((t) => t.includes(name) || name.includes(t)) : false;
    const heat = storyHeat({ trendScore: Number(c.trendScore), spikeHeat, prior: prior.prior, inTrends });
    const qualified = qualifies({ heat, fame, surprise: prior.surprise }, cfg);
    const segRel = weights.segments?.[c.segment] ?? 1;
    const sp = starPower({ heat, fame, segRel });
    return { ...c, heat: Math.round(heat), fame: fame == null ? null : Math.round(fame), qualified, starPower: Math.round(sp), signals: { eventType: prior.type, spikeRatio: wiki?.ratio ? +wiki.ratio.toFixed(1) : null, wikiLatest: wiki?.latest ?? null, wikiBaseline: wiki?.baseline ?? null, inTrends, trendScore: Number(c.trendScore) || null } };
  });

  // qualifiers first, then by starPower; recency breaks ties so same-score stories prefer fresh
  scored.sort((a, b) =>
    (Number(Boolean(b.qualified)) - Number(Boolean(a.qualified))) ||
    (b.starPower - a.starPower) ||
    (new Date(b.date) - new Date(a.date)));
  return scored;
}

// Shadow/grading log — written EVERY run regardless of mode, into the committed data dir.
export function logDiscovery({ mode, poolSize, engineTop, recencyTop, lookupsCached }) {
  try {
    const dir = path.join(IG.dataDir, "discovery");
    const row = (c) => ({ slug: c.slug, starPower: c.starPower, heat: c.heat, fame: c.fame, qualified: c.qualified || null, signals: c.signals || null });
    writeJson(path.join(dir, `${Date.now()}.json`), {
      at: new Date().toISOString(), mode, poolSize, lookupsCached,
      engineTop: engineTop.map(row),
      recencyTop: recencyTop.map((c) => ({ slug: c.slug })),
      rescued: engineTop.filter((c) => !recencyTop.some((r) => r.slug === c.slug)).map((c) => c.slug),
    });
  } catch { /* logging must never break a run */ }
}
