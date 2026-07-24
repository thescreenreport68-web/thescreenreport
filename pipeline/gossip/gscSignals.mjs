// GOSSIP — GOOGLE SEARCH CONSOLE SIGNALS (owner directive 2026-07-24).
//
// What real searchers actually type to reach us, used to inform WHICH story we write next and HOW the
// search headline is phrased. Read-only: this module never writes an article and never edits one.
//
// 🔴 RECOVERY-MODE CONTRACT — the site was crawl-parked on Jul 15 after a wave of churn, so this
// addition must be incapable of destabilising the lane:
//   • FAIL-SOFT ALWAYS. Missing key, dead network, bad JSON, empty response ⇒ return empty signals and
//     the lane behaves exactly as it did before. GSC is an ENRICHMENT, never a dependency.
//   • ONE network call per tick, max. Answers are cached on disk with a TTL, so hourly ticks read the
//     file instead of hammering the API.
//   • NEVER a filter. A name with no GSC data gets NO bonus — never a penalty. We have very little
//     data right now (that is the problem we are recovering from); treating absence as a negative
//     would freeze the lane onto a handful of names.
//   • The demand bump is BOUNDED (see scoring in find.mjs) so it can nudge the queue, never own it.
//
// Auth: a service-account JWT signed with the key in GSC_KEY_JSON, exchanged for an access token.
// Implemented with node:crypto so the lane takes no new dependency.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { entityKey } from "./normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data/gossip");
const CACHE_PATH = path.join(DATA_DIR, "gsc-cache.json");

export const PROPERTY = process.env.GSC_PROPERTY || "sc-domain:thescreenreport.com";
export const CACHE_TTL_H = Number(process.env.GSC_CACHE_TTL_H ?? 6);
const LOOKBACK_DAYS = Number(process.env.GSC_LOOKBACK_DAYS ?? 7);

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Load the service-account credentials from env (CI) or a local file (dev). Null when unavailable. */
export function loadKey() {
  const raw = process.env.GSC_KEY_JSON;
  if (raw && raw.trim().startsWith("{")) {
    try { return JSON.parse(raw); } catch { return null; }
  }
  for (const p of [process.env.GSC_KEY_FILE, path.resolve(__dirname, "../../../gsc-key.json")].filter(Boolean)) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* try next */ }
  }
  return null;
}

/** Sign a JWT and exchange it for an access token. Throws on failure — callers catch. */
export async function getAccessToken(key, { fetchImpl = fetch, now = Date.now() } = {}) {
  const iat = Math.floor(now / 1000);
  const claim = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat, exp: iat + 3600,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claim))}`;
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(key.private_key);
  const jwt = `${unsigned}.${b64url(sig)}`;
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const j = await res.json();
  if (!j.access_token) throw new Error("no access_token");
  return j.access_token;
}

const dayISO = (ms) => new Date(ms).toISOString().slice(0, 10);

async function query(token, body, fetchImpl) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`query ${res.status}`);
  const j = await res.json();
  return Array.isArray(j.rows) ? j.rows : [];
}

export const EMPTY = { ok: false, fetchedAt: null, queries: [], pages: [], reason: "not fetched" };

function readCache(cachePath, now, ttlH) {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const age = now - Date.parse(j.fetchedAt || 0);
    if (age >= 0 && age < ttlH * 3600e3) return { ...j, cached: true };
  } catch { /* no usable cache */ }
  return null;
}

/**
 * Fetch (or reuse) the last-7d search signals. NEVER throws.
 * Returns { ok, fetchedAt, queries:[{query,impressions,clicks,position}], pages:[{page,...}], reason }
 */
export async function getSearchSignals({
  fetchImpl = fetch, now = Date.now(), cachePath = CACHE_PATH, ttlH = CACHE_TTL_H, force = false, key = undefined,
} = {}) {
  if (!force) {
    const hit = readCache(cachePath, now, ttlH);
    if (hit) return hit;
  }
  const k = key === undefined ? loadKey() : key;
  if (!k?.client_email || !k?.private_key) {
    // Stale cache is still better than nothing; otherwise run blind (exactly like before GSC existed).
    const stale = readCache(cachePath, now, 24 * 30);
    return stale ? { ...stale, reason: "no key — using stale cache" } : { ...EMPTY, reason: "no GSC key available" };
  }
  try {
    const token = await getAccessToken(k, { fetchImpl, now });
    const range = { startDate: dayISO(now - LOOKBACK_DAYS * 864e5), endDate: dayISO(now) };
    // ONE call per tick: both dimensions in a single request, then split locally.
    const rows = await query(token, { ...range, dimensions: ["query", "page"], rowLimit: 500, dataState: "all" }, fetchImpl);
    const qMap = new Map(), pMap = new Map();
    for (const r of rows) {
      const [q, page] = r.keys || [];
      const imp = Number(r.impressions) || 0, clicks = Number(r.clicks) || 0, pos = Number(r.position) || 0;
      if (q) {
        const cur = qMap.get(q) || { query: q, impressions: 0, clicks: 0, position: 0, _w: 0 };
        cur.impressions += imp; cur.clicks += clicks;
        cur.position += pos * imp; cur._w += imp;                       // impression-weighted mean
        qMap.set(q, cur);
      }
      if (page) {
        const cur = pMap.get(page) || { page, impressions: 0, clicks: 0, position: 0, _w: 0, queries: [] };
        cur.impressions += imp; cur.clicks += clicks;
        cur.position += pos * imp; cur._w += imp;
        if (q && cur.queries.length < 5) cur.queries.push(q);
        pMap.set(page, cur);
      }
    }
    const finish = (m) => [...m.values()].map((x) => ({ ...x, position: x._w ? +(x.position / x._w).toFixed(1) : 0, _w: undefined }))
      .sort((a, b) => b.impressions - a.impressions);
    const out = { ok: true, fetchedAt: new Date(now).toISOString(), property: PROPERTY, range, queries: finish(qMap), pages: finish(pMap), reason: "" };
    try { fs.mkdirSync(path.dirname(cachePath), { recursive: true }); fs.writeFileSync(cachePath, JSON.stringify(out)); } catch { /* cache write is best-effort */ }
    return out;
  } catch (e) {
    const stale = readCache(cachePath, now, 24 * 30);
    const reason = `gsc unavailable: ${String(e?.message || e).slice(0, 60)}`;
    return stale ? { ...stale, reason: `${reason} — using stale cache` } : { ...EMPTY, reason };
  }
}

// ── Turning raw queries into something the lane can use ────────────────────────────────────────────
// A query like "jelly roll and bunnie xo divorce" carries a NAME plus intent words. We want the name.
const STOP = new Set(["the", "and", "a", "an", "of", "in", "on", "at", "to", "for", "is", "are", "was", "were", "with",
  "what", "who", "when", "where", "why", "how", "did", "does", "do", "his", "her", "their", "he", "she", "they",
  "new", "latest", "news", "now", "today", "net", "worth", "age", "height", "wife", "husband", "boyfriend",
  "girlfriend", "wedding", "divorce", "split", "dating", "baby", "pregnant", "died", "death", "happened"]);

/** Impression-weighted demand per NAME-ish token run, keyed by the lane's canonical entity fold. */
export function buildDemandMap(signals) {
  const map = new Map();
  for (const row of signals?.queries || []) {
    const words = String(row.query || "").toLowerCase().split(/[^a-z0-9'’-]+/).filter(Boolean);
    // longest consecutive run of non-stopword tokens ⇒ the name people typed
    let best = [], cur = [];
    for (const w of words) {
      if (STOP.has(w) || w.length < 3) { if (cur.length > best.length) best = cur; cur = []; }
      else cur.push(w);
    }
    if (cur.length > best.length) best = cur;
    if (best.length < 1) continue;
    const name = entityKey(best.join(" "));
    if (!name || name.length < 3) continue;
    const cur2 = map.get(name) || { name, impressions: 0, clicks: 0, queries: [] };
    cur2.impressions += Number(row.impressions) || 0;
    cur2.clicks += Number(row.clicks) || 0;
    if (cur2.queries.length < 5) cur2.queries.push(row.query);
    map.set(name, cur2);
  }
  return map;
}

/**
 * Bounded demand bonus for one entity. NEVER negative: an unknown name scores 0, never a penalty.
 * Log-scaled so a runaway page cannot dominate the queue.
 */
export function demandBonus(entity, demandMap, { max = 15 } = {}) {
  if (!entity || !demandMap?.size) return 0;
  const hit = demandMap.get(entityKey(entity));
  if (!hit || !hit.impressions) return 0;
  return Math.min(max, Math.round(6 * Math.log10(1 + hit.impressions)));
}

/** The real phrasings searchers used for this entity — context for the headline agent, never a template. */
export function phrasingsFor(entity, demandMap, { max = 3 } = {}) {
  const hit = demandMap?.get(entityKey(entity));
  return hit ? (hit.queries || []).slice(0, max) : [];
}

/** Our own pages sitting on page-two of search — candidates IF a real development turns up. */
export function strikingDistance(signals, { minPos = 8, maxPos = 30, minImpressions = 1 } = {}) {
  return (signals?.pages || [])
    .filter((p) => p.position >= minPos && p.position <= maxPos && p.impressions >= minImpressions)
    .map((p) => ({ ...p, slug: String(p.page || "").replace(/\/+$/, "").split("/").pop() }))
    .filter((p) => p.slug);
}
