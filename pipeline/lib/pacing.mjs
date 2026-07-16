// PACING GOVERNOR (NEWS_REALTIME_SCALE_PLAN §6, research-hardened 2026-07-16) — deterministic, no LLM.
// Shapes ~50/day out of thousands of candidates WITHOUT ever burning the budget in one hour, via two coupled
// mechanisms whose failure modes were adversarially stress-tested against the ad-pacing literature:
//   1. RATE-MATCHED ADAPTIVE BAR — publish only topics scoring ≥ the day's own bar. A fixed percentile is a decoy
//      (p85 of 2k candidates/day = 300 passes); the quantile must float with volume: q = 1 − TARGET/n, nudged by a
//      damped feedback term vs the day's cumulative pace curve (ahead → stricter, behind → relax toward the floor).
//      Window hygiene: ONE max-score entry per event, strictly rolling 24h, EWMA age-decay (~9h half-life) so a
//      mega-event night can't mute the next morning's coverage ("hangover" fix). Cold start (< N_MIN samples) =
//      hard floor only.
//   2. TOKEN BUCKET, DRIFT-PROOF — capacity ~9, refill = DAILY_CAP × day-part-weight × wall-clock Δt from a
//      persisted timestamp (never "+N per run": the cron fires late/skips/doubles), fractional accrual, weights
//      keyed to the MEASURED trade curve (Variety/THR put 63-72% of output in 5am–2pm PT) in America/Los_Angeles
//      (UTC tables land the peak overnight + break on DST). No end-of-day catch-up: unused tokens expire.
// Tier-S breaking DEBITS the bucket first and bypasses only when it's empty — capped 4/hour AND 12/day (without
// the daily cap a chaos day could legally publish ~192). State lives in data/find/pacing.json (committed with the
// rest of data/find; drip + breaking runs are serialized by the news-publish concurrency group, so no state races).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(__dirname, "../../data/find/pacing.json");

export const CFG = {
  TARGET: Number(process.env.PACE_TARGET ?? 50),        // articles/day the governor shapes toward
  DAILY_CAP: Number(process.env.PACE_DAILY_CAP ?? 60),  // token supply/day (headroom over target)
  CAP: Number(process.env.PACE_BUCKET_CAP ?? 9),        // bucket capacity — one hot hour can spend at most this + refill
  FLOOR: Number(process.env.PACE_FLOOR ?? 48),          // hard newsworthiness floor (matches findrun SELECT_FLOOR)
  QMIN: 0.70, QMAX: 0.99, GAMMA: 0.5,                   // quantile clamp + feedback damping
  EWMA_HALF_H: Number(process.env.PACE_EWMA_HALF_H ?? 9),
  N_MIN: Number(process.env.PACE_N_MIN ?? 200),         // cold-start sample floor
  TIER_S_HOUR: 4, TIER_S_DAY: 12,
  WINDOW_MS: 24 * 3600e3,
};

// Day-part refill weights per LA hour (sum = 1). Shape = the MEASURED trade publish curve: 9 peak hours
// 5am–1:59pm PT carry 63%, afternoon/evening 32%, overnight a 5% trickle (never fully dark — 24/7 mandate).
export const W = Array.from({ length: 24 }, (_, h) =>
  (h >= 5 && h <= 13) ? 0.63 / 9 : (h >= 14 && h <= 21) ? 0.32 / 8 : 0.05 / 7);

export const laHour = (now = Date.now()) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hourCycle: "h23" }).format(now));
export const laDate = (now = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
// Fraction of the day's token supply scheduled by LA-hour `h` (whole hours — plenty for pace feedback).
const cumW = (h) => W.slice(0, h).reduce((a, b) => a + b, 0);

export function load(file = STATE_FILE) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
  s.window ||= [];                                        // [{e: eventKey, s: score, t: ms}]
  s.bucket ||= { tokens: 2, ts: Date.now() };             // slow start: a fresh state can publish immediately but not burst
  s.day ||= { date: laDate(), published: 0, tierS: 0, tierSHour: { h: -1, n: 0 } };
  s.barLog ||= [];
  return s;
}
export function save(s, file = STATE_FILE) {
  s.window = s.window.filter((w) => Date.now() - w.t <= CFG.WINDOW_MS).slice(-4000);
  s.barLog = s.barLog.slice(-96);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s));
}

// LA-midnight rollover: reset the day counters; return the closed day's summary (stats/audit hook) or null.
export function dayRoll(s, now = Date.now()) {
  const d = laDate(now);
  if (s.day.date === d) return null;
  const prev = { ...s.day };
  s.day = { date: d, published: 0, tierS: 0, tierSHour: { h: -1, n: 0 } };
  return prev;
}

// Feed the quantile window from a FIND sweep: max-score-per-event, eligible candidates only (a broken feed
// flooding junk must not LOWER the bar; a story re-polled 48×/day must not drag the quantile).
export function recordCandidates(s, topics, now = Date.now()) {
  const byEvent = new Map(s.window.map((w) => [w.e, w]));
  for (const t of topics || []) {
    const score = Number(t?.priority);
    if (!Number.isFinite(score) || t?.verification?.publishable === false) continue;
    const e = String(t.eventSlug || t.id || t.title || "").slice(0, 80);
    if (!e) continue;
    const cur = byEvent.get(e);
    if (!cur) { const w = { e, s: score, t: now }; byEvent.set(e, w); s.window.push(w); }
    else if (score > cur.s) { cur.s = score; cur.t = now; }
  }
  s.window = s.window.filter((w) => now - w.t <= CFG.WINDOW_MS);
}

// Wall-clock refill (drift-proof): tokens += DAILY_CAP × W[laHour] × Δt_hours, clamped to capacity. Cold-start
// states (thin window) refill at 75% — the LinkedIn-style slow start.
export function refill(s, now = Date.now()) {
  const dtH = Math.max(0, (now - (s.bucket.ts || now)) / 3600e3);
  const cold = s.window.length < CFG.N_MIN;
  s.bucket.tokens = Math.min(CFG.CAP, (s.bucket.tokens || 0) + CFG.DAILY_CAP * W[laHour(now)] * dtH * (cold ? 0.75 : 1));
  s.bucket.ts = now;
  return s.bucket.tokens;
}

// The day's publish bar: EWMA-weighted quantile of the 24h window at the rate-matched, feedback-nudged q.
export function computeBar(s, now = Date.now()) {
  const entries = s.window.filter((w) => now - w.t <= CFG.WINDOW_MS);
  const n = entries.length;
  if (n < CFG.N_MIN) { const r = { bar: CFG.FLOOR, q: null, n, cold: true }; s.barLog.push({ t: now, ...r }); return r; }
  const qBase = 1 - CFG.TARGET / n;
  const expected = CFG.TARGET * cumW(laHour(now));               // where the day SHOULD be by this LA hour
  const err = (s.day.published - expected) / CFG.TARGET;         // ahead > 0 → stricter; behind < 0 → relax
  const q = Math.min(CFG.QMAX, Math.max(CFG.QMIN, qBase + CFG.GAMMA * err));
  const rows = entries
    .map((w) => ({ s: w.s, w: Math.pow(0.5, (now - w.t) / 3600e3 / CFG.EWMA_HALF_H) }))
    .sort((a, b) => a.s - b.s);
  const total = rows.reduce((a, r) => a + r.w, 0);
  let cum = 0, bar = rows[rows.length - 1].s;
  for (const r of rows) { cum += r.w; if (cum >= q * total) { bar = r.s; break; } }
  const res = { bar: Math.max(CFG.FLOOR, Math.round(bar)), q: Number(q.toFixed(3)), n, cold: false };
  s.barLog.push({ t: now, ...res });
  return res;
}

// Spend n published articles' worth of tokens (never below 0) + count them toward the day.
export function take(s, n, now = Date.now()) {
  s.bucket.tokens = Math.max(0, (s.bucket.tokens || 0) - n);
  s.day.published += n;
  void now;
}

// Behind the day's pace curve? (the always-post rule: a tick may drop to 1 but only skips entirely when AHEAD)
export function behindPace(s, now = Date.now()) {
  return s.day.published < CFG.TARGET * cumW(laHour(now)) - 0.5;
}

// Tier-S/A breaking gate — PREVIEW ONLY (no mutation): token path when the bucket has one; else a Tier-S-only
// bypass under the hour+day caps; else null (the drip owns it). Call commitBreaking() AFTER the article publishes.
export function breakingGate(s, cls, now = Date.now()) {
  if ((s.bucket.tokens || 0) >= 1) return { mode: "token" };
  if (cls !== "S") return null;
  const h = laHour(now);
  const hourN = s.day.tierSHour.h === h ? s.day.tierSHour.n : 0;
  if (s.day.tierS >= CFG.TIER_S_DAY || hourN >= CFG.TIER_S_HOUR) return null;
  return { mode: "bypass" };
}
export function commitBreaking(s, gate, now = Date.now()) {
  if (gate.mode === "token") { take(s, 1, now); return; }
  const h = laHour(now);
  s.day.tierSHour = { h, n: (s.day.tierSHour.h === h ? s.day.tierSHour.n : 0) + 1 };
  s.day.tierS += 1;
  s.day.published += 1; // a bypass still counts toward the day's output
}

// ── daily stats ledger (data/find/stats/<laDate>.json) — the "measure it" owner requirement ──────
const STATS_DIR = path.resolve(__dirname, "../../data/find/stats");
export function statsAppend(patch, date = laDate()) {
  fs.mkdirSync(STATS_DIR, { recursive: true });
  const f = path.join(STATS_DIR, `${date}.json`);
  let st = {};
  try { st = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* new day */ }
  st.date = date;
  for (const [k, v] of Object.entries(patch)) {
    if (Array.isArray(v)) st[k] = [...(st[k] || []), ...v];
    else if (typeof v === "number") st[k] = (st[k] || 0) + v;
    else st[k] = v;
  }
  fs.writeFileSync(f, JSON.stringify(st, null, 1));
  return f;
}
