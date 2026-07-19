// LANE HEALTH — the structural answer to "the automation cannot tell when it is broken".
//
// WHY THIS EXISTS. 62 of 64 catch sites in this lane swallowed their error silently. That is not a style
// problem, it is the root cause of every expensive bug we shipped:
//   • the chart extractor returned 6 of 17 rows for DAYS behind `catch { data = null }` — no error, no
//     warning, healthy-looking runs, a $51.28M #1 opening simply missing;
//   • `loadTracked()` turned an unreadable ledger into `{films:{}}`, so every film looked brand-new and
//     3 DUPLICATE articles reached the live site with identical figures;
//   • `retries = 0` made every model call a no-op — 18 calls, 18 errors, $0 spend, indistinguishable
//     from a quiet news day.
// In every case the lane kept running and reported success. The fix is not "add a log line here" — it is
// a mechanism that makes a swallowed failure IMPOSSIBLE to lose.
//
// THE CONTRACT.
//   1. A fail-soft path may still continue — but it must RECORD, via `fault()`.
//   2. Faults land in the tick's run report (`report.faults`) and, above a severity, emit a GitHub
//      ::warning:: / ::error:: annotation, so a degraded tick is visible in the workflow log.
//   3. `assertCount()` turns "I expected roughly N and got M" into a recorded fault instead of a silent
//      truncation — the chart bug in one line.
//   4. Nothing here changes control flow. Recording a fault never throws. That is deliberate: this layer
//      must be safe to add everywhere, including paths that legitimately degrade.
import nodeFs from "node:fs";

const FAULTS = [];

export const SEV = { INFO: "info", WARN: "warn", CRITICAL: "critical" };

export function resetFaults() { FAULTS.length = 0; }

// fault(stage, message, { severity, meta }) — record a swallowed/degraded condition. NEVER throws.
export function fault(stage, message, { severity = SEV.WARN, meta = null } = {}) {
  const rec = { stage, message: String(message ?? "").slice(0, 300), severity, at: new Date().toISOString() };
  if (meta && typeof meta === "object") rec.meta = meta;
  FAULTS.push(rec);
  if (severity === SEV.CRITICAL) console.log(`::error title=boxoffice ${stage}::${rec.message}`);
  else if (severity === SEV.WARN) console.log(`::warning title=boxoffice ${stage}::${rec.message}`);
  return rec;
}

// Wrap a fail-soft catch: `catchFault("netflix", () => [], e)` records then returns the fallback.
export function catchFault(stage, fallbackFn, err, opts = {}) {
  fault(stage, err?.message || err, opts);
  return typeof fallbackFn === "function" ? fallbackFn() : fallbackFn;
}

// assertCount(stage, actual, expected, label) — the chart bug (6 of 17 rows) in one call. A shortfall
// beyond tolerance is recorded, not silently accepted. Returns true when the count is acceptable.
export function assertCount(stage, actual, expected, { label = "rows", tolerance = 0, severity = SEV.WARN } = {}) {
  const a = Number(actual) || 0;
  const e = Number(expected);
  if (!Number.isFinite(e) || e <= 0) return true;          // nothing authoritative to compare against
  if (a >= e - tolerance) return true;
  fault(stage, `expected ${e} ${label}, got ${a}`, { severity, meta: { actual: a, expected: e, label } });
  return false;
}

// STATE INTEGRITY. The difference between "this file does not exist yet" (fine — first run) and "this
// file exists but I could not read it" (NOT fine — we are about to act as if we have no memory, which is
// exactly how the duplicates were published) must never be silently collapsed. Callers use this to load
// JSON state and get an explicit `lost` flag they can fail closed on.
export function loadJsonState(file, fallback, { stage = "state", fs = nodeFs } = {}) {
  let existed = false;
  try { existed = fs.existsSync(file); } catch { /* fs unavailable → treat as absent */ }
  if (!existed) return { data: fallback, lost: false, existed: false };
  try {
    return { data: JSON.parse(fs.readFileSync(file, "utf8")), lost: false, existed: true };
  } catch (e) {
    // The file is THERE and unreadable. Loudest possible signal: continuing means acting amnesiac.
    fault(stage, `state file exists but could not be parsed (${file}) — proceeding WITHOUT memory is how duplicates ship: ${e?.message || e}`,
      { severity: SEV.CRITICAL, meta: { file } });
    return { data: fallback, lost: true, existed: true };
  }
}

// Snapshot for the run report + the anomaly summary the owner actually reads.
export function faultReport() {
  const bySeverity = FAULTS.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] || 0) + 1; return acc; }, {});
  return { count: FAULTS.length, bySeverity, faults: FAULTS.slice(0, 40) };
}
export const hasCritical = () => FAULTS.some((f) => f.severity === SEV.CRITICAL);
