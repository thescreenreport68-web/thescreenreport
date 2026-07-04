// GOSSIP SCHEDULER test — the drip tick. Proves the LA-posting-hours GATE is correct and DST-proof (works in both
// PST and PDT), that outside hours is a clean no-op, and that inside hours it tops up + publishes via injected impls
// (no network). Run: node .../scheduler-test.mjs
import { laPostingHours, laHour, tick } from "../scheduler.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
const at = (iso) => new Date(iso);

console.log("\n=== GOSSIP SCHEDULER TEST ===\n");

// LA posting hours = 10:00–22:00 local. Summer = PDT (UTC-7); winter = PST (UTC-8).
// PDT: LA 10:00 = 17:00Z ; LA 21:59 = 04:59Z(next day) ; LA 22:00 = 05:00Z.
check("PDT: 17:00Z = LA 10:00 → INSIDE hours", laPostingHours(at("2026-07-04T17:00:00Z")) === true, `laHour=${laHour(at("2026-07-04T17:00:00Z"))}`);
check("PDT: 16:59Z = LA 09:59 → OUTSIDE (before 10am)", laPostingHours(at("2026-07-04T16:59:00Z")) === false);
check("PDT: 04:59Z = LA 21:59 → INSIDE (last minute)", laPostingHours(at("2026-07-05T04:59:00Z")) === true, `laHour=${laHour(at("2026-07-05T04:59:00Z"))}`);
check("PDT: 05:00Z = LA 22:00 → OUTSIDE (10pm sharp)", laPostingHours(at("2026-07-05T05:00:00Z")) === false);
// PST (winter): LA 10:00 = 18:00Z ; LA 09:59 = 17:59Z.
check("PST: 18:00Z = LA 10:00 → INSIDE (DST-proof)", laPostingHours(at("2026-01-15T18:00:00Z")) === true, `laHour=${laHour(at("2026-01-15T18:00:00Z"))}`);
check("PST: 17:59Z = LA 09:59 → OUTSIDE (DST-proof)", laPostingHours(at("2026-01-15T17:59:00Z")) === false);

// tick(): OUTSIDE hours = clean no-op (never touches find/run).
{
  let touched = false;
  const r = await tick({ now: at("2026-07-04T12:00:00Z"), findImpl: async () => { touched = true; return []; }, runImpl: async () => { touched = true; return { published: [], topics: 0, held: [], rejected: [], skipped: [], blocked: [] }; } });
  check("outside hours → published 0, reason outside-hours", r.published === 0 && r.reason === "outside-hours");
  check("outside hours → find/run were NOT called", touched === false);
}

// tick(): INSIDE hours = publishes via injected run (backlog assumed full so no find needed here).
{
  const r = await tick({
    now: at("2026-07-04T18:00:00Z"),
    findImpl: async () => [],
    runImpl: async ({ fromFind, limit }) => { check("run called with fromFind + limit=1", fromFind === true && limit === 1); return { published: [{ slug: "some-star-spotted" }], topics: 1, held: [], rejected: [], skipped: [], blocked: [] }; },
  });
  check("inside hours → publishes one, returns its slug", r.published === 1 && r.slugs[0] === "some-star-spotted");
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Scheduler green. ✅\n");
