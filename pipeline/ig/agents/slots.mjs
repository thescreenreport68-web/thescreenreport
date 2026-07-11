// AGENT 22 — SLOT PLANNER (plan §2.2 #22, §1.9): breaking → now; else prime ET slots
// with jitter; ramp caps enforced; one-whole-day guard lives in the orchestrator.
import { IG } from "../config.mjs";
import { loadWeights } from "../lib/ledger.mjs";

// tz-aware "next occurrence of HH:MM in ET" without deps.
// Offset trick uses BOTH-sides-toLocaleString so the runner's own timezone cancels out
// (parsing only one side in the local zone leaks the runner's offset — review finding).
function tzOffsetMs(atUtc, timeZone) {
  const inTz = new Date(atUtc.toLocaleString("en-US", { timeZone }));
  const inUtc = new Date(atUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  return inUtc.getTime() - inTz.getTime(); // positive when the zone is behind UTC
}
function nextEt(hhmm, from = new Date()) {
  const [h, m] = hhmm.split(":").map(Number);
  for (let addDays = 0; addDays < 3; addDays++) {
    const probe = new Date(from.getTime() + addDays * 864e5);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: IG.slots.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(probe).reduce((a, p) => ((a[p.type] = p.value), a), {});
    const asUtc = new Date(`${parts.year}-${parts.month}-${parts.day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
    const candidate = new Date(asUtc.getTime() + tzOffsetMs(asUtc, IG.slots.timezone));
    if (candidate.getTime() > from.getTime() + 5 * 60000) return candidate;
  }
  return new Date(from.getTime() + 3600e3);
}

// deterministic jitter from the slug (no Math.random — reproducible runs)
function jitterMin(slug) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % (IG.slots.jitterMin * 2 + 1)) - IG.slots.jitterMin;
}

export function planSlots(jobs, { now = new Date() } = {}) {
  const weights = loadWeights();
  const slotOrder = [...IG.slots.primeET].sort((a, b) => (weights.slots?.[b] ?? 0) - (weights.slots?.[a] ?? 0));
  let slotIdx = 0;
  const assignments = [];
  for (const job of jobs) {
    if (job.scout?.breaking) {
      assignments.push({ slug: job.id, whenISO: new Date(now.getTime() + 6 * 60000).toISOString(), slot: "breaking" });
      continue;
    }
    const base = nextEt(slotOrder[slotIdx % slotOrder.length], assignments.length ? new Date(assignments[assignments.length - 1].whenISO) : now);
    const when = new Date(base.getTime() + jitterMin(job.id) * 60000);
    // never closer than 2h to the previous assignment (never burst-fire)
    const prev = assignments[assignments.length - 1];
    const finalWhen = prev && when.getTime() - new Date(prev.whenISO).getTime() < 2 * 3600e3
      ? new Date(new Date(prev.whenISO).getTime() + 2.5 * 3600e3)
      : when;
    assignments.push({ slug: job.id, whenISO: finalWhen.toISOString(), slot: slotOrder[slotIdx % slotOrder.length] });
    slotIdx++;
  }
  return assignments;
}
