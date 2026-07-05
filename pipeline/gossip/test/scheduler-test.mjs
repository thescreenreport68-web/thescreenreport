// GOSSIP SCHEDULER test — the 24/7 interval gate (owner 2026-07-05: ~1 article every ~2h, around the clock). Uses a
// TEMP schedule file + injected impls (no network). Run: node .../scheduler-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tick, minsSinceLastPost, saveSchedule, loadSchedule } from "../scheduler.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
const TMP = path.join(os.tmpdir(), `gossip-sched-test-${process.pid}.json`);
const cleanup = () => { try { fs.unlinkSync(TMP); } catch {} };
const at = (iso) => new Date(iso);
const findNone = async () => [];
const publishOne = async () => ({ published: [{ slug: "a-fresh-scoop" }], topics: 1, held: [], rejected: [], skipped: [], blocked: [] });
const publishNone = async () => ({ published: [], topics: 2, held: [{}], rejected: [], skipped: [], blocked: [] });

console.log("\n=== GOSSIP SCHEDULER (interval) TEST ===\n");
cleanup();

// 1) never posted before → posts immediately (Infinity since last).
{
  check("minsSinceLastPost = Infinity when never posted", minsSinceLastPost(new Date(), {}) === Infinity);
  const r = await tick({ now: at("2026-07-05T12:00:00Z"), findImpl: findNone, runImpl: publishOne, schedPath: TMP, intervalMin: 115 });
  check("first ever tick publishes (no clock yet)", r.published === 1 && r.slugs[0] === "a-fresh-scoop");
  check("lastPostAt stamped after publishing", !!loadSchedule(TMP).lastPostAt);
}

// 2) too soon → no-op (respects the ~2h gate).
{
  saveSchedule({ lastPostAt: "2026-07-05T12:00:00Z" }, TMP);
  let ran = false;
  const r = await tick({ now: at("2026-07-05T13:00:00Z"), findImpl: findNone, runImpl: async () => { ran = true; return publishOne(); }, schedPath: TMP, intervalMin: 115 });
  check("60min after a post (< 115) → no-op, reason too-soon", r.published === 0 && r.reason === "too-soon");
  check("too-soon never runs the publish pipeline", ran === false);
}

// 3) interval elapsed → posts again + re-stamps the clock.
{
  saveSchedule({ lastPostAt: "2026-07-05T12:00:00Z" }, TMP);
  const r = await tick({ now: at("2026-07-05T14:05:00Z"), findImpl: findNone, runImpl: publishOne, schedPath: TMP, intervalMin: 115 });
  check("125min after last post (>= 115) → publishes", r.published === 1);
  check("clock advanced to the new post time", loadSchedule(TMP).lastPostAt === "2026-07-05T14:05:00.000Z");
}

// 4) --force bypasses the gate (used to post immediately regardless).
{
  saveSchedule({ lastPostAt: "2026-07-05T12:00:00Z" }, TMP);
  const r = await tick({ now: at("2026-07-05T12:10:00Z"), force: true, findImpl: findNone, runImpl: publishOne, schedPath: TMP, intervalMin: 115 });
  check("force=true posts even 10min after the last (bypasses gate)", r.published === 1);
}

// 5) a DRY slot (interval elapsed but nothing publishable) does NOT advance the clock → next tick retries.
{
  saveSchedule({ lastPostAt: "2026-07-05T12:00:00Z" }, TMP);
  const r = await tick({ now: at("2026-07-05T14:05:00Z"), findImpl: findNone, runImpl: publishNone, schedPath: TMP, intervalMin: 115 });
  check("nothing published → published 0", r.published === 0);
  check("clock NOT advanced on a dry slot (so it retries soon)", loadSchedule(TMP).lastPostAt === "2026-07-05T12:00:00Z");
}

// 6) posts 24/7 — no time-of-day gate at all (a 3am post is fine).
{
  saveSchedule({ lastPostAt: "2026-07-05T00:00:00Z" }, TMP);
  const r = await tick({ now: at("2026-07-05T03:00:00Z"), findImpl: findNone, runImpl: publishOne, schedPath: TMP, intervalMin: 115 });
  check("posts at 3am (24/7 — no LA-hours gate anymore)", r.published === 1);
}

cleanup();
console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Scheduler (interval) green. ✅\n");
