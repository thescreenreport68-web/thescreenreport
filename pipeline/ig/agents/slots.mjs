// AGENT 22 — SLOT PLANNER (plan §2.2 #22, §1.9): breaking → now; else prime ET slots
// with jitter; ramp caps enforced; one-whole-day guard lives in the orchestrator.
import { IG } from "../config.mjs";

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

// How many prime slots are still UPCOMING today (LA) and not already filled. Caps the build-ahead so
// a run never builds into TOMORROW's slots (which would record the wrong scheduledDay + get rebuilt
// tomorrow). A morning run sees all 7; an afternoon catch-up sees only what's left today. (2026-07-14)
export function upcomingSlotsToday(now = new Date(), filledSlots = []) {
  const taken = new Set(filledSlots);
  const dayOf = (d) => d.toLocaleDateString("en-US", { timeZone: IG.slots.timezone });
  const today = dayOf(now);
  return IG.slots.primeET.filter((s) => !taken.has(s) && dayOf(nextEt(s, now)) === today);
}

// deterministic jitter from the slug (no Math.random — reproducible runs)
function jitterMin(slug) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % (IG.slots.jitterMin * 2 + 1)) - IG.slots.jitterMin;
}

// Assign each job to the EARLIEST UPCOMING slot that isn't already taken — by a prior run today
// (`filledSlots`) or by an earlier job in this same run. A slot that already passed today resolves
// (via nextEt) to tomorrow, so a missed slot is simply skipped, never back-filled and never doubled.
// This is what makes the 7-separate-runs-per-day model correct. (owner 2026-07-13)
export function planSlots(jobs, { now = new Date(), filledSlots = [] } = {}) {
  const taken = new Set(filledSlots);
  const assignments = [];
  for (const job of jobs) {
    if (job.scout?.breaking) {
      assignments.push({ slug: job.id, whenISO: new Date(now.getTime() + 6 * 60000).toISOString(), slot: "breaking" });
      continue;
    }
    const option = IG.slots.primeET
      .filter((s) => !taken.has(s))
      .map((s) => ({ s, t: nextEt(s, now) }))
      .sort((a, b) => a.t.getTime() - b.t.getTime())[0];
    if (!option) break; // every slot is taken — the caller leaves this job unscheduled
    const when = new Date(option.t.getTime() + jitterMin(job.id) * 60000);
    assignments.push({ slug: job.id, whenISO: when.toISOString(), slot: option.s });
    taken.add(option.s);
  }
  return assignments;
}
