// PHASE 5 — Tier-S burst lane: interval bypass for mega-stories, hard-capped. Offline.
//   node pipeline/gossip/test/burst-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tick } from "../scheduler.mjs";
import { peekTopScore, saveQueue, QUEUE_PATH } from "../find.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
process.env.GOSSIP_STATS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-stats-"));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gossip-b-"));

console.log("\n=== PHASE 5: BURST LANE ===\n");

// a Tier-S topic: tier-6 outlet + viral engagement + heat window + hot class + fresh ⇒ score well over 65
const MEGA = { id: "mega", title: "Star X and Star Y split", claim: "split", primaryEntity: "Star X", engagement: 20000, heat: 6, ageMin: 30, queuedAt: null, sources: [{ tier: 6 }] };
const MILD = { id: "mild", title: "a quiet sighting", primaryEntity: "Star Z", queuedAt: null, sources: [{ tier: 5 }] };

const stubRun = (published = 1) => async () => ({ published: published ? [{ slug: "s" }] : [], topics: 1, held: [], rejected: [], skipped: [], blocked: [] });
const findStub = async () => [];
const mkSched = (dir, lastMinsAgo, extra = {}) => {
  const p = path.join(dir, "schedule.json");
  fs.writeFileSync(p, JSON.stringify({ lastPostAt: new Date(Date.now() - lastMinsAgo * 60000).toISOString(), ...extra }));
  return p;
};

// snapshot/restore the real queue (peekTopScore reads the default path)
const snapshot = fs.existsSync(QUEUE_PATH) ? fs.readFileSync(QUEUE_PATH, "utf8") : null;
try {
  // 1) peek scores without claiming
  saveQueue([MILD, MEGA], QUEUE_PATH);
  const top = peekTopScore();
  check("peek finds the mega topic without claiming", top.id === "mega" && top.score >= 65 && JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8")).topics.length === 2, JSON.stringify(top));

  // 2) too-soon + mega topic ⇒ BURST publishes
  {
    const dir = tmp();
    const out = await tick({ schedPath: mkSched(dir, 40), pausedPath: path.join(dir, "PAUSED"), findImpl: findStub, runImpl: stubRun(), force: false, intervalMin: 115 });
    const sched = JSON.parse(fs.readFileSync(path.join(dir, "schedule.json"), "utf8"));
    check("burst fires past the interval gate", out.published === 1 && sched.burstsToday === 1, JSON.stringify(out));
  }
  // 3) burst respects the 30-min gap
  {
    const dir = tmp();
    const out = await tick({ schedPath: mkSched(dir, 10), pausedPath: path.join(dir, "PAUSED"), findImpl: findStub, runImpl: stubRun(), force: false, intervalMin: 115 });
    check("no burst within 30min of the last post", out.reason === "too-soon");
  }
  // 4) burst daily cap
  {
    const dir = tmp();
    const day = new Date().toISOString().slice(0, 10);
    const out = await tick({ schedPath: mkSched(dir, 40, { burstDay: day, burstsToday: 3 }), pausedPath: path.join(dir, "PAUSED"), findImpl: findStub, runImpl: stubRun(), force: false, intervalMin: 115 });
    check("daily burst cap (3) respected", out.reason === "too-soon");
  }
  // 5) day rollover resets the cap
  {
    const dir = tmp();
    const out = await tick({ schedPath: mkSched(dir, 40, { burstDay: "2026-01-01", burstsToday: 3 }), pausedPath: path.join(dir, "PAUSED"), findImpl: findStub, runImpl: stubRun(), force: false, intervalMin: 115 });
    const sched = JSON.parse(fs.readFileSync(path.join(dir, "schedule.json"), "utf8"));
    check("UTC-day rollover resets the burst budget", out.published === 1 && sched.burstsToday === 1 && sched.burstDay !== "2026-01-01");
  }
  // 6) mild queue never bursts
  {
    saveQueue([MILD], QUEUE_PATH);
    const dir = tmp();
    const out = await tick({ schedPath: mkSched(dir, 40), pausedPath: path.join(dir, "PAUSED"), findImpl: findStub, runImpl: stubRun(), force: false, intervalMin: 115 });
    check("ordinary topics wait out the interval", out.reason === "too-soon");
  }
  // 7) the normal interval path still works + burst counter untouched on a normal publish
  {
    saveQueue([MILD], QUEUE_PATH);
    const dir = tmp();
    const out = await tick({ schedPath: mkSched(dir, 120), pausedPath: path.join(dir, "PAUSED"), findImpl: findStub, runImpl: stubRun(), force: false, intervalMin: 115 });
    const sched = JSON.parse(fs.readFileSync(path.join(dir, "schedule.json"), "utf8"));
    check("normal interval publish unchanged (burstsToday 0)", out.published === 1 && (sched.burstsToday || 0) === 0);
  }
} finally {
  if (snapshot != null) fs.writeFileSync(QUEUE_PATH, snapshot); else { try { fs.unlinkSync(QUEUE_PATH); } catch {} }
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Burst lane green. ✅\n");
