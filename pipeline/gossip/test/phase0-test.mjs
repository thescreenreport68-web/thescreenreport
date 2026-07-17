// PHASE 0 — review mode routing, stats ledger, zero-publish streak alarm, PAUSED kill-switch. Offline.
//   node pipeline/gossip/test/phase0-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gossipRun, writeRunStats, updateStreak, reviewDir } from "../gossiprun.mjs";
import { tick } from "../scheduler.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gossip-p0-"));
process.env.GOSSIP_STATS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-stats-")); // keep test stats out of data/gossip

console.log("\n=== PHASE 0: review mode / stats / streak / PAUSED ===\n");

// A topic + a canned PUBLISH result so gossipRun exercises the write path with zero LLM calls.
const topic = { id: "t1", primaryEntity: "Test Person", title: "Test Person Does a Thing", claim: "did a thing", subjectType: "celebrity", slug: "test-person-does-a-thing" };
const publishResult = {
  status: "PUBLISH",
  article: { title: "Test Person Does a Thing", dek: "A thing happened.", body: "Test Person did a thing today, per a report. It was confirmed by the outlet and widely covered by fans online.", keyTakeaways: ["Test Person did a thing"], faq: [], whatWeKnow: [], whatWeDont: [] },
  frame: { tier: "REPORTED_BY_MAJOR", severity: "NORMAL", uiLabel: "Reported", monitor: false },
  provenance: { sensitivity: "normal", attribution: "Outlet", monitor: false, sources: [{ outlet: "Outlet", tier: 6 }], corroborationCount: 1 },
  route: { category: "celebrity", subcategory: "news" },
  bundle: { sources: [{ outlet: "Outlet", tier: 6, text: "Test Person did a thing today." }] },
  auto: { score: 90, subscores: { safety: 9 } },
};

// 1) REVIEW mode: with GOSSIP_REVIEW_DIR set, the writer receives dir=<review dir> (article → artifact-only).
{
  const rdir = tmp();
  process.env.GOSSIP_REVIEW_DIR = rdir; // absolute path also resolves fine via path.resolve
  let gotDir = null;
  await gossipRun({
    fromFind: true,
    dequeueImpl: (() => { let done = false; return () => (done ? [] : (done = true, [topic])); })(),
    runImpl: async () => publishResult,
    writeImpl: (o) => { gotDir = o.dir || null; return { slug: topic.slug, path: "/x", frontmatter: {}, md: "", written: true }; },
    dedup: false, verify: false, judge: false, limit: 1,
  });
  check("review mode passes the review dir to the writer", gotDir === path.resolve(rdir) || gotDir === rdir, String(gotDir));
  delete process.env.GOSSIP_REVIEW_DIR;
  check("reviewDir() null when env unset", reviewDir() === null);
}
// 2) stats ledger: gossipRun writes a run-*.json with cost ÷ published + byRole (default stats dir is data/gossip
//    — exercised via writeRunStats directly against a temp dir to keep the repo clean).
{
  const sdir = tmp();
  const fp = writeRunStats({ ts: "2026-07-17T00:00:00.000Z", mode: "from-find", review: false, published: ["a"], topics: 2, held: 0, rejected: 1, skipped: 0, blocked: 0, costUSD: 0.01, costPerPublished: 0.01, byModel: {}, byRole: {} }, { dir: sdir });
  const back = JSON.parse(fs.readFileSync(fp, "utf8"));
  check("stats ledger writes + round-trips", back.costPerPublished === 0.01 && back.published[0] === "a" && fp.includes("run-2026-07-17"));
}
// 3) streak: attempted-zero increments, publish resets, no-op tick does neither.
{
  const sdir = tmp();
  check("attempted zero-publish increments", updateStreak({ published: 0, processed: 3 }, { dir: sdir }) === 1);
  check("second zero → 2", updateStreak({ published: 0, processed: 1 }, { dir: sdir }) === 2);
  check("no-op tick (processed 0) holds", updateStreak({ published: 0, processed: 0 }, { dir: sdir }) === 2);
  check("a publish resets to 0", updateStreak({ published: 1, processed: 2 }, { dir: sdir }) === 0);
  const warn = updateStreak({ published: 0, processed: 1 }, { dir: sdir, threshold: 1 });
  check("threshold crossing returns the streak (warning logged)", warn === 1);
}
// 4) PAUSED kill-switch: tick no-ops without calling find or run.
{
  const dir = tmp();
  const paused = path.join(dir, "PAUSED");
  fs.writeFileSync(paused, "stop\n");
  let ran = false;
  const out = await tick({
    pausedPath: paused,
    schedPath: path.join(dir, "schedule.json"),
    findImpl: async () => { ran = true; return []; },
    runImpl: async () => { ran = true; return { published: [], topics: 0, held: [], rejected: [], skipped: [], blocked: [] }; },
    force: true,
  });
  check("PAUSED → no-op, nothing runs", out.reason === "paused" && ran === false);
}
// 5) review runs don't stamp the live cadence clock.
{
  const dir = tmp();
  const schedPath = path.join(dir, "schedule.json");
  process.env.GOSSIP_REVIEW_DIR = tmp();
  await tick({
    pausedPath: path.join(dir, "PAUSED"),
    schedPath,
    findImpl: async () => [],
    runImpl: async () => ({ published: [{ slug: "x" }], topics: 1, held: [], rejected: [], skipped: [], blocked: [] }),
    force: true,
  });
  const sched = fs.existsSync(schedPath) ? JSON.parse(fs.readFileSync(schedPath, "utf8")) : {};
  check("review run leaves lastPostAt unstamped", !sched.lastPostAt);
  delete process.env.GOSSIP_REVIEW_DIR;
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Phase 0 infra green. ✅\n");
