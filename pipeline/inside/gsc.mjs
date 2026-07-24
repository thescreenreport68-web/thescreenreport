// GOOGLE SEARCH CONSOLE — read-only visibility signal for the inside lane (owner 2026-07-24).
//
// STAGE 1+2 ONLY: this module OBSERVES. Nothing here influences which story gets published — that is a
// later stage the owner gates separately. What it does today is answer one question every tick:
// "did anything this lane published recently appear in Google even once?" The site went dark on
// 2026-07-15 and nobody noticed for ~5 days; this is the smoke alarm that would have caught it.
//
// HARD RULES (a monitoring feature must never be able to hurt the thing it monitors):
//   • Never throws. Every failure returns { ok:false, reason } and the tick carries on unchanged.
//   • Never blocks: one call, hard timeout, no retries.
//   • ONE GSC call per tick — memoized in-module (runners are ephemeral, so cross-tick caching would
//     mean committing a cache file; not worth the git churn for a single cheap call).
import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const PROPERTY = process.env.GSC_PROPERTY || "sc-domain:thescreenreport.com";
const TIMEOUT_MS = Number(process.env.GSC_TIMEOUT_MS) || 12000;

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Service-account JWT → access token. Returns null on any problem (never throws). */
export async function gscAccessToken({ keyJson = process.env.GSC_KEY_JSON, fetchImpl = fetch, nowMs = null } = {}) {
  try {
    if (!keyJson) return null;
    const key = typeof keyJson === "string" ? JSON.parse(keyJson) : keyJson;
    if (!key?.client_email || !key?.private_key) return null;
    const iat = Math.floor((nowMs ?? Date.now()) / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, exp: iat + 3600, iat }));
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(`${header}.${claim}`);
    const jwt = `${header}.${claim}.${b64url(signer.sign(key.private_key))}`;
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json())?.access_token || null;
  } catch { return null; }
}

/** YYYY-MM-DD in UTC. */
export const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

let _memo = null; // ONE call per tick

/**
 * One searchAnalytics call, dimensions [page, date] — that single response carries everything the
 * alarm needs: which of our URLs were shown, and how fresh Google's data is (its newest date).
 * Returns { ok, rows, window } or { ok:false, reason }.
 */
export async function gscPageDays({
  days = 10, now = Date.now(), fetchImpl = fetch, keyJson = process.env.GSC_KEY_JSON, property = PROPERTY, force = false,
} = {}) {
  if (_memo && !force) return _memo;
  const out = await (async () => {
    try {
      const token = await gscAccessToken({ keyJson, fetchImpl, nowMs: now });
      if (!token) return { ok: false, reason: "no GSC credentials or token refused" };
      // Google's data trails ~2-3 days; ask a little wider than the window we judge on.
      const endDate = ymd(now);
      const startDate = ymd(now - days * 864e5);
      const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ startDate, endDate, dimensions: ["page", "date"], rowLimit: 5000 }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, reason: `GSC HTTP ${res.status}` };
      const json = await res.json();
      return { ok: true, rows: json?.rows || [], window: { startDate, endDate } };
    } catch (e) { return { ok: false, reason: String(e?.message || e).slice(0, 80) }; }
  })();
  _memo = out;
  return out;
}

export const _resetGscMemo = () => { _memo = null; }; // tests only

const slugOf = (url) => String(url || "").replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() || "";

/**
 * PURE — the smoke alarm. Given this lane's published records and GSC's rows, decide whether the lane
 * is visible in Google.
 *
 * The subtlety that makes this alarm trustworthy: Google's data lags ~3 days, so an article published
 * yesterday CANNOT have data yet. Judging it would fire the alarm every single tick and train everyone
 * to ignore it. So we only judge the MATURE cohort — articles published on or before Google's most
 * recent data date, within the window. If nothing is mature yet, that is not an alarm, it is "too early
 * to tell", and we say so.
 */
export function assessVisibility({ publishedRecords = [], gscRows = [], now = Date.now(), windowDays = 7, assumedLagDays = 3 } = {}) {
  const dates = gscRows.map((r) => r.keys?.[1]).filter(Boolean).sort();
  const mostRecentDataDate = dates.length ? dates[dates.length - 1] : null;
  const lagDays = mostRecentDataDate
    ? Math.max(0, Math.round((Date.parse(`${ymd(now)}T00:00:00Z`) - Date.parse(`${mostRecentDataDate}T00:00:00Z`)) / 864e5))
    : assumedLagDays;

  // Per-slug totals across the window (a slug can appear on several days).
  const bySlug = new Map();
  for (const r of gscRows) {
    const s = slugOf(r.keys?.[0]);
    if (!s) continue;
    const cur = bySlug.get(s) || { impressions: 0, clicks: 0, posSum: 0, n: 0 };
    cur.impressions += r.impressions || 0;
    cur.clicks += r.clicks || 0;
    cur.posSum += (r.position || 0) * (r.impressions || 1);
    cur.n += r.impressions || 1;
    bySlug.set(s, cur);
  }

  // The cohort we are entitled to judge: published inside the window AND old enough to have data.
  const cutoffNew = mostRecentDataDate ? Date.parse(`${mostRecentDataDate}T23:59:59Z`) : now - assumedLagDays * 864e5;
  const cutoffOld = now - windowDays * 864e5;
  const mature = publishedRecords.filter((r) => {
    if (!r?.slug || r.review) return false;
    const t = Date.parse(r.at || "");
    return Number.isFinite(t) && t <= cutoffNew && t >= cutoffOld;
  });

  const seen = [];
  let impressions = 0, clicks = 0;
  for (const r of mature) {
    const hit = bySlug.get(r.slug);
    if (!hit || !hit.impressions) continue;
    impressions += hit.impressions;
    clicks += hit.clicks;
    seen.push({ slug: r.slug, impressions: hit.impressions, clicks: hit.clicks, position: Number((hit.posSum / (hit.n || 1)).toFixed(1)) });
  }
  seen.sort((a, b) => b.impressions - a.impressions);

  let status, message;
  if (!mature.length) {
    status = "TOO_EARLY";
    message = `no articles old enough to judge yet (Google's data ends ${mostRecentDataDate || "?"}, ~${lagDays}d behind)`;
  } else if (!seen.length) {
    status = "DARK";
    message = `NONE of the ${mature.length} inside articles published in the judgeable window has appeared in Google even once`;
  } else {
    status = "VISIBLE";
    message = `${seen.length}/${mature.length} recent inside articles appeared in Google — ${impressions} impressions, ${clicks} clicks`;
  }

  return {
    status, message, mostRecentDataDate, lagDays,
    matureCount: mature.length, seenCount: seen.length, impressions, clicks,
    pages: seen.slice(0, 10),
    // Striking distance = just off page one. Stage 3 will feed these; today we only record them.
    strikingDistance: seen.filter((p) => p.position >= 8 && p.position <= 30).map((p) => ({ slug: p.slug, position: p.position, impressions: p.impressions })),
  };
}

/** The one-line banner. Kept here so the console, the report and the CI annotation cannot disagree. */
export function alarmBanner(v) {
  if (!v) return "";
  if (v.status === "DARK") return `🔴🔴 GOOGLE VISIBILITY ALARM — ${v.message}`;
  if (v.status === "VISIBLE") return `🟢 Google visibility: ${v.message}`;
  if (v.status === "TOO_EARLY") return `⚪ Google visibility: ${v.message}`;
  return `⚪ Google visibility unavailable: ${v.message || "unknown"}`;
}
