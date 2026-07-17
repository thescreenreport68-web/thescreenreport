// GOSSIP DRAIN-CAP test — the --from-find consumer must (a) drain PAST held/dup topics until one publishes, and
// (b) NEVER runaway-drain the whole backlog: it stops after `maxDrain` processed topics per tick (bounds the cloud
// tick's wall-clock). Uses an injected dequeue + runImpl (no queue file, no network). Run: node .../drain-cap-test.mjs
import { gossipRun } from "../gossiprun.mjs";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join as _join } from "node:path";
process.env.GOSSIP_STATS_DIR = mkdtempSync(_join(tmpdir(), "gossip-stats-")); // keep test stats out of data/gossip

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

const mkTopic = (i) => ({ id: `q${i}`, primaryEntity: `Star ${i}`, subjectType: "actor", title: `t${i}`, slug: `t${i}` });
// a dequeueImpl backed by an in-memory array (FIFO), like the real queue.
function fakeQueue(n) {
  const arr = Array.from({ length: n }, (_, i) => mkTopic(i));
  return (k) => arr.splice(0, k);
}
const writeImpl = ({ topic }) => ({ slug: topic.slug, written: false, path: "x" });
const publishRun = async () => ({ status: "PUBLISH", article: { title: "T", body: "b" }, frame: { tier: "CONFIRMED", severity: "NORMAL", uiLabel: "Confirmed" }, provenance: {}, route: { category: "celebrity" }, bundle: { sources: [] }, auto: null });
const heldRun = async () => ({ status: "HELD", reason: "held" });

console.log("\n=== GOSSIP DRAIN-CAP TEST ===\n");

// 1) drains PAST held topics until ONE publishes (limit=1).
{
  let n = 0;
  const runImpl = async (t) => { n++; return n < 3 ? heldRun() : publishRun(); }; // first 2 held, 3rd publishes
  const report = await gossipRun({ fromFind: true, limit: 1, dedup: false, judge: false, verify: false, dequeueImpl: fakeQueue(10), runImpl, writeImpl });
  check("drains past held topics to publish exactly 1", report.published.length === 1, JSON.stringify({ pub: report.published.length, held: report.held.length, topics: report.topics }));
  check("processed 3 topics (2 held + 1 published)", report.topics === 3);
}

// 2) CAP: if nothing publishes, stop after maxDrain — never drain the whole backlog.
{
  const report = await gossipRun({ fromFind: true, limit: 1, maxDrain: 4, dedup: false, judge: false, verify: false, dequeueImpl: fakeQueue(50), runImpl: heldRun, writeImpl });
  check("stops after maxDrain topics when none publish (no runaway)", report.topics === 4 && report.published.length === 0, JSON.stringify({ topics: report.topics }));
}

// 3) empty backlog → clean stop, nothing published.
{
  const report = await gossipRun({ fromFind: true, limit: 1, dedup: false, judge: false, verify: false, dequeueImpl: () => [], runImpl: publishRun, writeImpl });
  check("empty backlog → 0 published, 0 processed, no crash", report.published.length === 0 && report.topics === 0);
}

// 4) limit=3 publishes exactly 3 (draining as needed) and respects the cap.
{
  const report = await gossipRun({ fromFind: true, limit: 3, maxDrain: 20, dedup: false, judge: false, verify: false, dequeueImpl: fakeQueue(10), runImpl: publishRun, writeImpl });
  check("limit=3 publishes exactly 3", report.published.length === 3 && report.topics === 3);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Drain-cap green. ✅\n");
