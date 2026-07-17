// P3 — PACING GOVERNOR (BOX_OFFICE_UPGRADE_PLAN §L3, the news lane's proven shape, lane-local + simpler).
// Two jobs, both deterministic and wall-clock-driven (drift-proof — tokens refill from a persisted
// timestamp, never "+N per run"):
//  1. SPREAD the day's supply: the chart lands each LA morning and used to publish everything material in
//     the first ticks, then ~20 empty ticks. A day-parted token bucket drips the budget across LA hours
//     (63% morning/early-afternoon, 32% evening, 5% overnight — the site's audience curve), modulated by
//     day-of-week (weekend actuals beat: Sun/Mon ×1.3; midweek lull: Wed/Thu ×0.8).
//  2. NEVER over- or under-run: ahead of pace with no tokens → the tick exits CHEAPLY (before any model
//     call); behind pace → always allowed at least 1 (the always-post-when-behind rule — but only MATERIAL
//     events ever publish; the governor never fabricates supply).
// State lives in the store (store.pace = { tokens, lastMs }) so it survives ticks + commits with lane state.

export const PACE = {
  target: Number(process.env.BOXOFFICE_DAILY_TARGET) || 20, // articles/day the bucket refills toward
  cap: 4,                                                   // max saved-up burst (a big weekend morning)
  // LA day-part weights (fraction of the daily budget refilled during each part).
  parts: [
    { fromH: 5, toH: 14, w: 0.63 },   // 5:00–13:59 PT — morning/early afternoon (chart + weekend actuals land)
    { fromH: 14, toH: 22, w: 0.32 },  // 14:00–21:59 PT — evening
    { fromH: 22, toH: 5, w: 0.05 },   // overnight
  ],
  dow: { 0: 1.3, 1: 1.3, 3: 0.8, 4: 0.8 }, // Sun/Mon boost (weekend numbers), Wed/Thu trim
};

const laParts = (ms) => {
  const d = new Date(ms);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hourCycle: "h23" }).format(d));
  const dowName = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(d);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dowName);
  return { hour, dow };
};
const partW = (hour) => {
  for (const p of PACE.parts) {
    if (p.fromH < p.toH ? (hour >= p.fromH && hour < p.toH) : (hour >= p.fromH || hour < p.toH)) return p.w / hoursIn(p);
  }
  return 0.01;
};
const hoursIn = (p) => (p.fromH < p.toH ? p.toH - p.fromH : 24 - p.fromH + p.toH);
export const dowMult = (dow) => PACE.dow[dow] ?? 1;

// refill(pace, nowMs) → tokens available now. Wall-clock: integrate the per-hour refill rate over the
// elapsed time (approximated per-hour — ticks are ≤1h apart, so a single-rate step is accurate enough).
export function refill(pace, nowMs) {
  const last = Number(pace?.lastMs) || nowMs;
  const dtH = Math.max(0, Math.min(6, (nowMs - last) / 3600e3)); // >6h gap = a stall; don't windfall-burst
  const { hour, dow } = laParts(nowMs);
  const perHour = PACE.target * partW(hour) * dowMult(dow);
  const tokens = Math.min(PACE.cap, (Number(pace?.tokens) || 0) + dtH * perHour);
  return { tokens, lastMs: nowMs };
}

// Cumulative expected publishes by this LA hour (the behind/ahead bar).
export function expectedByNow(nowMs) {
  const { hour, dow } = laParts(nowMs);
  let cum = 0;
  for (const p of PACE.parts) {
    const span = hoursIn(p);
    for (let i = 0; i < span; i++) {
      const h = (p.fromH + i) % 24;
      // hours are LA-day-ordered starting 5:00 (the publishing day starts with the chart landing)
      const order = (h - 5 + 24) % 24;
      const nowOrder = (hour - 5 + 24) % 24;
      if (order < nowOrder) cum += (p.w / span);
    }
  }
  return PACE.target * cum * dowMult(dow);
}

// allowance(store, publishedToday, requested, nowMs) → { allow, tokens, behind, expected }
// The governor's single call-site API: how many publishes this tick may spend.
export function allowance(store, publishedToday, requested, nowMs = Date.now()) {
  const pace = refill(store.pace, nowMs);
  const expected = expectedByNow(nowMs);
  const behind = publishedToday < Math.floor(expected);
  let allow = Math.min(requested, Math.floor(pace.tokens));
  if (behind && allow < 1) allow = 1; // always-post-when-behind (material events only, downstream)
  return { allow, tokens: pace.tokens, lastMs: pace.lastMs, behind, expected: Number(expected.toFixed(2)) };
}

// debit(store, n, meta) — spend n tokens after real publishes; persists via the caller's store save.
export function debit(pace, n) {
  return { tokens: Math.max(0, (Number(pace?.tokens) || 0) - n), lastMs: pace?.lastMs || Date.now() };
}
