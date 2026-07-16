// DEV-ONLY unit test (no network): prove the PACING GOVERNOR against the research-identified failure modes
// (NEWS_REALTIME_SCALE_PLAN §6). Each suite = one documented break of the naive design.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CFG, W, load, save, dayRoll, recordCandidates, refill, computeBar, take, behindPace, breakingGate, commitBreaking, laHour } from "../lib/pacing.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ FAIL: " + m); } };
const TMP = path.join(os.tmpdir(), `pacing-test-${Date.now()}.json`);
const fresh = () => { try { fs.unlinkSync(TMP); } catch {} return load(TMP); };
// pick a timestamp whose LA hour = h today (walk back hour by hour)
const atLaHour = (h) => { let t = Date.now(); for (let i = 0; i < 48 && laHour(t) !== h; i++) t -= 3600e3; return t; };
const topic = (e, s, extra = {}) => ({ eventSlug: e, priority: s, verification: { publishable: true }, ...extra });

console.log("=== weights: sum to 1, peak matches the measured trade curve ===");
ok(Math.abs(W.reduce((a, b) => a + b, 0) - 1) < 1e-9, "Σ weights = 1");
ok(W[8] > W[18] && W[18] > W[2], "peak (8am PT) > evening > overnight");

console.log("=== refill: wall-clock drift-proof (the '+N per run' break) ===");
{
  const s = fresh(); s.bucket = { tokens: 0, ts: 0 };
  s.window = Array.from({ length: CFG.N_MIN + 10 }, (_, i) => ({ e: "w" + i, s: 50, t: Date.now() })); // warm
  const t0 = atLaHour(8);
  s.bucket.ts = t0 - 30 * 60e3;
  const tok = refill(s, t0); // 30 min at hour-8 weight 0.07 → 60×0.07×0.5 = 2.1
  ok(Math.abs(tok - CFG.DAILY_CAP * W[8] * 0.5) < 1e-6, `30-min refill = rate×Δt (${tok.toFixed(2)})`);
  s.bucket = { tokens: 0, ts: t0 - 5 * 3600e3 };
  ok(refill(s, t0) <= CFG.CAP, "a 5h cron gap caps at bucket capacity (no burst dump)");
  s.bucket = { tokens: 3, ts: t0 + 60e3 }; // clock skew: ts in the future
  ok(refill(s, t0) === 3, "negative Δt refills nothing (never negative)");
}

console.log("=== bar: rate-matched quantile (the p85-decoy break) ===");
{
  const s = fresh(); const now = atLaHour(12);
  // 2000 events uniform 0..99, all fresh → qBase = 1−50/2000 = 0.975 → bar ≈ 97
  recordCandidates(s, Array.from({ length: 2000 }, (_, i) => topic("e" + i, i % 100)), now);
  s.day = { date: "x", published: Math.round(CFG.TARGET * W.slice(0, 12).reduce((a, b) => a + b, 0)), tierS: 0, tierSHour: { h: -1, n: 0 } }; // exactly on pace
  const { bar, q, cold } = computeBar(s, now);
  ok(!cold && q > 0.95, `q floats with volume (q=${q}, not a fixed p85)`);
  ok(bar >= 93, `bar takes the true top slice (${bar})`);
}
{
  const s = fresh(); const now = atLaHour(12);
  recordCandidates(s, Array.from({ length: 300 }, (_, i) => topic("e" + i, i % 100)), now);
  s.day = { date: "x", published: 30, tierS: 0, tierSHour: { h: -1, n: 0 } };
  const ahead = computeBar(s, now).q;
  s.day.published = 0;
  const behind = computeBar(s, now).q;
  ok(ahead > behind, `feedback: ahead stricter (${ahead}) than behind (${behind})`);
  ok(behind >= CFG.QMIN && ahead <= CFG.QMAX, "q clamped to [QMIN, QMAX]");
}

console.log("=== window hygiene: max-score-per-event (the re-poll bias break) ===");
{
  const s = fresh();
  recordCandidates(s, [topic("same-event", 40)], Date.now());
  recordCandidates(s, [topic("same-event", 90)], Date.now());
  recordCandidates(s, [topic("same-event", 60)], Date.now());
  ok(s.window.length === 1 && s.window[0].s === 90, "one entry per event, max score kept");
  recordCandidates(s, [topic("junk", 10, { verification: { publishable: false } })], Date.now());
  ok(s.window.length === 1, "ineligible candidates never enter the window");
}

console.log("=== hangover: EWMA decay (the mega-event-night break) ===");
{
  const s = fresh(); const now = atLaHour(12);
  // 250 event-night entries (20h old, score 90) + 250 fresh entries (1h old, score 60)
  for (let i = 0; i < 250; i++) s.window.push({ e: "old" + i, s: 90, t: now - 20 * 3600e3 });
  for (let i = 0; i < 250; i++) s.window.push({ e: "new" + i, s: 60, t: now - 1 * 3600e3 });
  s.day = { date: "x", published: 20, tierS: 0, tierSHour: { h: -1, n: 0 } };
  const { bar } = computeBar(s, now);
  ok(bar <= 90, `old high scores decay — bar ${bar} lets fresh coverage through (plain quantile would pin 90)`);
}

console.log("=== cold start: floor-only until N_MIN ===");
{
  const s = fresh(); const now = Date.now();
  recordCandidates(s, Array.from({ length: 50 }, (_, i) => topic("c" + i, 90)), now);
  const r = computeBar(s, now);
  ok(r.cold && r.bar === CFG.FLOOR, `thin window (n=${r.n}) → hard floor ${CFG.FLOOR}, no extreme-variance quantile`);
}

console.log("=== Tier-S: debit-first + 4/h + 12/day caps (the 192/day break) ===");
{
  const s = fresh(); const now = atLaHour(10);
  s.bucket = { tokens: 2, ts: now };
  ok(breakingGate(s, "A", now)?.mode === "token", "tokens available → Tier-A uses a token");
  s.bucket.tokens = 0;
  ok(breakingGate(s, "A", now) === null, "empty bucket → Tier-A refused (waits for the drip)");
  let bp = 0;
  for (let i = 0; i < 6; i++) { const g = breakingGate(s, "S", now); if (g) { commitBreaking(s, g, now); bp++; } }
  ok(bp === CFG.TIER_S_HOUR, `Tier-S bypass hour cap enforced (${bp}/${CFG.TIER_S_HOUR})`);
  s.day.tierS = CFG.TIER_S_DAY;
  s.day.tierSHour = { h: -1, n: 0 };
  ok(breakingGate(s, "S", now) === null, "Tier-S day cap enforced");
}

console.log("=== day roll + always-post + spend ===");
{
  const s = fresh();
  s.day = { date: "1999-01-01", published: 44, tierS: 2, tierSHour: { h: 5, n: 1 } };
  const prev = dayRoll(s, Date.now());
  ok(prev?.published === 44 && s.day.published === 0, "LA-midnight roll resets counters + returns the closed day");
  const noon = atLaHour(12);
  s.day.published = 0;
  ok(behindPace(s, noon), "0 published by noon → behind pace (a tick must still post)");
  s.day.published = CFG.TARGET;
  ok(!behindPace(s, noon), "target already hit → ahead (a tick may skip)");
  s.bucket = { tokens: 2.5, ts: noon };
  take(s, 2, noon);
  ok(Math.abs(s.bucket.tokens - 0.5) < 1e-9 && s.day.published === CFG.TARGET + 2, "take() spends tokens + counts the day");
  take(s, 5, noon);
  ok(s.bucket.tokens === 0, "tokens never go negative");
}

console.log("=== persistence round-trip ===");
{
  const s = fresh();
  recordCandidates(s, [topic("persist-me", 77)], Date.now());
  s.bucket = { tokens: 4.25, ts: Date.now() };
  save(s, TMP);
  const r = load(TMP);
  ok(r.window.some((w) => w.e === "persist-me" && w.s === 77) && Math.abs(r.bucket.tokens - 4.25) < 1e-9, "state survives save/load");
  try { fs.unlinkSync(TMP); } catch {}
}

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
