// gscDemand.mjs — REAL SEARCH DEMAND from Google Search Console (owner directive 2026-07-24).
//
// Until now this lane published BLIND: it had no way to know whether anything it wrote was ever shown
// to a human. Measured on 2026-07-24: of 290 articles this lane had published, 57 (20%) had ever
// earned a single Google impression — and of the 138 published in the previous 4–7 days, ZERO had.
// GSC is the feedback loop that was missing. It is used for four things:
//   1. DEMAND        — prefer topics whose entities show real impressions over zero-demand trade briefs
//   2. STRIKING DIST — pages at position 8–30 are the cheapest wins on the site (already ranking, one
//                      push from page one). A genuine development on one goes through ONE-STORY-ONE-URL.
//   3. PHRASING      — headline wording taken from what searchers actually typed (accuracy unchanged)
//   4. LEARNING      — what actually earned impressions feeds back into selection
//
// ── COST / QUOTA DISCIPLINE ──────────────────────────────────────────────────────────────────────
// ONE API call per refresh, cached to disk, TTL 12h by default — NOT per topic and NOT per tick.
// GSC data lags 2–3 days, so refetching every 30-minute tick would buy nothing; ~2 calls/day is
// plenty. A cache read costs nothing.
//
// ── FAIL-OPEN, ALWAYS ────────────────────────────────────────────────────────────────────────────
// No key, expired token, quota error, network failure, malformed response → return an EMPTY demand
// object and the lane behaves exactly as it did before. Search data must never be able to stop the
// newsroom publishing.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, "../../data/find/gsc");
const CACHE_FILE = path.join(CACHE_DIR, "demand.json");
const SITE = process.env.GSC_SITE || "sc-domain:thescreenreport.com";
const TTL_H = Number(process.env.GSC_TTL_H ?? 12);
// LOOKBACK — 28 days, not 7. Measured 2026-07-24: because the site has been crawl-parked since Jul 15,
// a 7-day window returns just 20 distinct queries (almost every candidate scores zero, so the signal is
// useless), while 28 days returns 353 queries / 1,088 impressions. Same single API call, ~17x the signal.
// Drop this back toward 7 once impressions recover and recency matters more than sample size.
const LOOKBACK_D = Number(process.env.GSC_LOOKBACK_DAYS ?? 28);

const EMPTY = { ok: false, queries: [], pages: [], strikingPages: [], fetchedAt: null, reason: "unavailable" };

// ── auth: service-account JWT → OAuth token. Pure Node (crypto + fetch), no extra dependency. ─────
const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function loadKey() {
  const raw = process.env.GSC_KEY_JSON || "";
  if (raw.trim()) { try { return JSON.parse(raw); } catch { /* fall through to file */ } }
  // local dev convenience: the key lives OUTSIDE the repo (parent dir, never committed)
  for (const p of [process.env.GSC_KEY_FILE, path.resolve(__dirname, "../../../gsc-key.json")].filter(Boolean)) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* next */ }
  }
  return null;
}

async function getToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(JSON.stringify({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: key.token_uri, iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64u(signer.sign(key.private_key))}`;
  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const j = await res.json();
  if (!j.access_token) throw new Error("no access_token");
  return j.access_token;
}

async function queryGsc(token, body) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`gsc ${res.status}`);
  return (await res.json()).rows || [];
}

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

// ── the public entry point ───────────────────────────────────────────────────────────────────────
// Returns { ok, queries[], pages[], strikingPages[], fetchedAt }. Cached; safe to call every tick.
export async function loadDemand({ force = false, ttlH = TTL_H, now = Date.now() } = {}) {
  // 1. cache
  if (!force) {
    try {
      const c = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      const ageH = (now - Date.parse(c.fetchedAt)) / 3600_000;
      if (Number.isFinite(ageH) && ageH < ttlH) return { ...c, cached: true, ageH: Number(ageH.toFixed(2)) };
    } catch { /* no/again-invalid cache → fetch */ }
  }
  // 2. fetch (one token + two queries; still one refresh per 12h)
  const key = loadKey();
  if (!key?.private_key || !key?.client_email) return { ...EMPTY, reason: "no GSC key (set GSC_KEY_JSON)" };
  try {
    const token = await getToken(key);
    const endDate = ymd(now);
    const startDate = ymd(now - LOOKBACK_D * 86400_000);
    const [qRows, pRows] = await Promise.all([
      queryGsc(token, { startDate, endDate, dimensions: ["query"], rowLimit: 500 }),
      queryGsc(token, { startDate, endDate, dimensions: ["page"], rowLimit: 500 }),
    ]);
    const queries = qRows.map((r) => ({ q: r.keys[0], impressions: r.impressions, clicks: r.clicks, position: r.position }));
    const pages = pRows.map((r) => ({
      url: r.keys[0],
      slug: String(r.keys[0]).replace(/\/+$/, "").split("/").pop(),
      impressions: r.impressions, clicks: r.clicks, position: r.position,
    }));
    // striking distance: already ranking, one push from page one — the cheapest wins available
    const strikingPages = pages
      .filter((p) => p.impressions > 0 && p.position >= 8 && p.position <= 30)
      .sort((a, b) => b.impressions - a.impressions);
    const out = { ok: true, queries, pages, strikingPages, fetchedAt: new Date(now).toISOString(), window: { startDate, endDate } };
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(out)); } catch { /* cache is an optimisation */ }
    return { ...out, cached: false };
  } catch (e) {
    // FAIL OPEN — never let a search-data problem stop the newsroom
    return { ...EMPTY, reason: `gsc error: ${String(e?.message || e).slice(0, 80)}` };
  }
}

// ── matching topics to real demand ───────────────────────────────────────────────────────────────
const STOP = new Set(["the", "a", "an", "of", "and", "for", "with", "in", "on", "to", "is", "are", "his", "her", "their", "new", "movie", "film", "show", "series", "season", "trailer", "cast", "news", "2026", "2025"]);
// Words that are long enough to look distinctive but describe the FORM of entertainment coverage
// rather than its subject. Sharing one of these proves nothing — "premiere" (exactly 8 chars) once
// matched a Danny Boyle sale to the query "universal trojan horse odyssey premiere".
const GENERIC_LONG = new Set(["premiere", "premieres", "trailer", "trailers", "release", "released", "releases", "announced", "announces", "announcement", "reviews", "reviewed", "interview", "interviews", "official", "exclusive", "streaming", "episodes", "actress", "starring", "director", "directed", "sequel", "casting", "characters", "character", "awards", "winners", "nominees", "nominated", "boxoffice", "hollywood", "netflix", "disney", "universal", "paramount", "warner"]);
const toks = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
const distinctive = (w) => w.length >= 6 && !GENERIC_LONG.has(w);

// Impressions attributable to a topic. A match must overlap the topic's SUBJECT (primaryEntity /
// primaryKeyword) — the thing the story is actually about. Title-only overlap is NOT enough: titles
// carry incidental words ("premiere", "Netflix") that collide across unrelated stories.
export function demandForTopic(topic, demand) {
  const none = { impressions: 0, clicks: 0, bestQuery: null, matches: 0 };
  if (!demand?.ok || !demand.queries?.length) return none;
  const subject = new Set([...toks(topic?.primaryEntity), ...toks(topic?.primaryKeyword)]);
  if (!subject.size) return none;
  let impressions = 0, clicks = 0, matches = 0, best = null;
  for (const r of demand.queries) {
    const qt = toks(r.q);
    if (!qt.length) continue;
    const shared = qt.filter((w) => subject.has(w));
    // two subject words, or one genuinely distinctive one — never a lone generic industry word
    const strong = shared.length >= 2 || (shared.length === 1 && distinctive(shared[0]));
    if (!strong) continue;
    impressions += r.impressions; clicks += r.clicks; matches++;
    if (!best || r.impressions > best.impressions) best = r;
  }
  return { impressions, clicks, matches, bestQuery: best ? best.q : null, bestPosition: best ? best.position : null };
}

// Bounded ranking contribution. Deliberately SMALL and log-scaled: while the site is crawl-parked the
// demand signal is sparse and noisy (most candidates legitimately score 0 because nothing is being
// shown at all), so it must behave as a tie-breaker that grows more useful as impressions recover —
// never as a gate that silences a genuinely big story with no search history yet.
export const DEMAND_CAP = Number(process.env.DEMAND_CAP ?? 8);
export function demandPoints(d, cap = DEMAND_CAP) {
  const i = Number(d?.impressions || 0);
  if (i <= 0) return 0;
  return Math.min(cap, Math.round(Math.log2(i + 1) * 2));
}

// ── STRIKING DISTANCE — ADVISORY ONLY ────────────────────────────────────────────────────────────
// 🔴 This function does NOT authorise rewriting anything. It answers a weaker question: "is this
// topic in the neighbourhood of a page we already half-rank for?" — used to RAISE that topic's
// priority so a refresh-worthy story gets picked up sooner.
//
// The decision to actually write into a live URL stays with find/sameStory.findSameStory(), which
// independently requires same beat + same subject + same event, plus a 6h cooldown. Why the split:
// on the real 2026-07-24 queue a single shared token ("odyssey") pointed FIVE unrelated stories
// (Tom Holland, Teyana Taylor, a cast guide, Samantha Morton, Zendaya) at the SAME ranking page.
// Acting on that would have overwritten one good live article five times. Search proximity is a
// hint; story identity is a much higher bar, and only the latter may touch a published page.
//
// Requires TWO shared subject tokens — no lone-distinctive-token path — because even as a hint a
// one-word collision is noise.
export function strikingMatch(topic, demand, mySlugs) {
  if (!demand?.ok || !demand.strikingPages?.length) return null;
  const subject = new Set([...toks(topic?.primaryEntity), ...toks(topic?.primaryKeyword)]);
  if (!subject.size) return null;
  let best = null;
  for (const p of demand.strikingPages) {
    if (mySlugs && !mySlugs.has(p.slug)) continue;         // never consider another lane's page
    const shared = toks(p.slug.replace(/-/g, " ")).filter((w) => subject.has(w));
    if (shared.length < 2) continue;                        // ADVISORY, but still needs a real overlap
    if (!best || p.impressions > best.impressions) best = { ...p, shared, advisory: true };
  }
  return best;
}
