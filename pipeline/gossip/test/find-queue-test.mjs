// GOSSIP FIND + QUEUE test — the producer half of the FIND→MAKE split. Proves gossipFind (discover→categorize→
// guard) with injected impls, and the backlog queue enqueue/dequeue/dedup behavior on a TEMP file (never the real
// queue). Run: node .../find-queue-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gossipFind, enqueue, dequeue, loadQueue, saveQueue } from "../find.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
const TMP = path.join(os.tmpdir(), `gossip-queue-test-${process.pid}.json`);
const cleanup = () => { try { fs.unlinkSync(TMP); } catch {} };

console.log("\n=== GOSSIP FIND + QUEUE TEST ===\n");
cleanup();

// 1) gossipFind runs discover→categorize→guard with injected impls (offline).
{
  const discoverImpl = async () => [
    { outlet: "Page Six", url: "https://x/1", title: "Star A spotted with Star B" },
    { outlet: "Just Jared", url: "https://x/2", title: "Star C new album tease" },
  ];
  const categorizeImpl = async (cands) => cands.map((c, i) => ({ id: `t${i}`, title: c.title, slug: `t${i}`, primaryEntity: `Star ${i}`, subjectType: "actor", sources: [{ outlet: c.outlet, url: c.url }] }));
  const topics = await gossipFind({ discoverImpl, categorizeImpl });
  check("gossipFind returns categorized topics", Array.isArray(topics) && topics.length === 2 && topics[0].id === "t0");
}

// 2) enqueue appends fresh, and is idempotent by id (no double-queue).
{
  saveQueue([], TMP);
  const a = enqueue([{ id: "x1", title: "A" }, { id: "x2", title: "B" }], { filePath: TMP, nowIso: "2026-07-04T10:00:00Z" });
  check("enqueue adds new topics", a.added === 2 && a.total === 2);
  const b = enqueue([{ id: "x2", title: "B-dup" }, { id: "x3", title: "C" }], { filePath: TMP });
  check("enqueue skips an already-queued id, adds only the new one", b.added === 1 && b.total === 3);
  check("queue persists to file", loadQueue(TMP).topics.length === 3);
  check("queuedAt stamped on enqueue", loadQueue(TMP).topics[0].queuedAt === "2026-07-04T10:00:00Z");
}

// 3) dequeue pops the OLDEST first (FIFO) and removes them (the claim).
{
  const popped = dequeue(2, { filePath: TMP });
  check("dequeue returns the oldest n (FIFO)", popped.length === 2 && popped[0].id === "x1" && popped[1].id === "x2");
  check("dequeued topics are removed from the queue", loadQueue(TMP).topics.length === 1 && loadQueue(TMP).topics[0].id === "x3");
}

// 4) dequeue never over-pops an empty/short queue.
{
  const popped = dequeue(10, { filePath: TMP });
  check("dequeue caps at available (no crash on over-pop)", popped.length === 1 && loadQueue(TMP).topics.length === 0);
  check("dequeue on empty queue returns []", dequeue(5, { filePath: TMP }).length === 0);
}

// 5) loadQueue tolerates a missing/corrupt file.
{
  const missing = path.join(os.tmpdir(), `nope-${process.pid}.json`);
  check("loadQueue on a missing file returns an empty queue", loadQueue(missing).topics.length === 0);
}

cleanup();
console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Find + queue green. ✅\n");
