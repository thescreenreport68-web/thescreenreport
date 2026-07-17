// GOSSIP — SCHEDULER (one "tick"). Called by the GitHub Actions workflow, clocked by a Cloudflare Worker Cron
// Trigger. Timing model (owner 2026-07-05): post ~1 article every ~2 HOURS, AROUND THE CLOCK (24/7) — ~12/day.
// One tick:
//   1) INTERVAL GATE — publish only if >= INTERVAL_MIN minutes since the LAST published article (tracked in
//      data/gossip/schedule.json). Otherwise no-op. (`--force` / FORCE=1 bypasses it — e.g. to post immediately.)
//   2) TOP UP the backlog queue if it's running low.
//   3) PUBLISH ONE article; on success, stamp lastPostAt = now (a dry slot leaves the clock so the next tick retries).
// It writes the article .md + updates dedup/queue state; the WORKFLOW then commits + builds + deploys. Emits
// `published=<n>` + `slugs=<..>` to $GITHUB_OUTPUT so the workflow only builds/deploys when something published.
// The CONTENT pipeline (find → make → verify → publish) is UNCHANGED — this only governs WHEN we post.
// Run (manual, post now):  cd site && set -a; . "../.env"; set +a; node pipeline/gossip/scheduler.mjs --force
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gossipFind, enqueue, loadQueue } from "./find.mjs";
import { gossipRun, reviewDir } from "./gossiprun.mjs";
import { runProbes } from "./probes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHED_PATH = path.resolve(__dirname, "../../data/gossip/schedule.json");
const PAUSED_PATH = path.resolve(__dirname, "../../data/gossip/PAUSED");

const INTERVAL_MIN = Number(process.env.INTERVAL_MIN ?? 115); // ~2h between posts (24/7) ⇒ ~12/day
const MIN_BACKLOG = Number(process.env.MIN_BACKLOG ?? 15);
const PER_TICK = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 1;
const FORCE = process.argv.includes("--force") || process.env.FORCE === "1";

export function loadSchedule(filePath = SCHED_PATH) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return {}; }
}
export function saveSchedule(obj, filePath = SCHED_PATH) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, JSON.stringify(obj, null, 2)); } catch { /* best-effort */ }
}
// Minutes since the last PUBLISHED article (Infinity if never posted → post now).
export function minsSinceLastPost(now = new Date(), sched = loadSchedule()) {
  if (!sched?.lastPostAt) return Infinity;
  return (now.getTime() - new Date(sched.lastPostAt).getTime()) / 60000;
}

function setOutput(kv) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  try { fs.appendFileSync(f, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"); } catch { /* not on CI */ }
}

export async function tick({ now = new Date(), findImpl = gossipFind, runImpl = gossipRun, force = FORCE, intervalMin = INTERVAL_MIN, schedPath = SCHED_PATH, pausedPath = PAUSED_PATH } = {}) {
  // KILL SWITCH (Phase 0): `touch data/gossip/PAUSED` (+ commit) stops all publishing until the file is removed.
  if (fs.existsSync(pausedPath)) {
    console.log("[scheduler] PAUSED file present (data/gossip/PAUSED) — no-op. Remove the file to resume.");
    setOutput({ published: 0, reason: "paused" });
    return { published: 0, reason: "paused" };
  }
  // Dependency probes (Phase 0): GOSSIP_DIAG=1 logs one status line per free dependency (dead feed ≠ quiet day).
  if (process.env.GOSSIP_DIAG === "1") { try { await runProbes(); } catch { /* diag never blocks */ } }
  const sched = loadSchedule(schedPath);
  const since = minsSinceLastPost(now, sched);
  if (!force && since < intervalMin) {
    console.log(`[scheduler] only ${Math.round(since)}min since last post (< ${intervalMin}); no-op.`);
    setOutput({ published: 0, reason: "too-soon" });
    return { published: 0, reason: "too-soon" };
  }
  // TOP UP only when the backlog is low (find on demand = lean; no discovery every tick).
  const before = loadQueue().topics.length;
  if (before < MIN_BACKLOG) {
    try {
      const found = await findImpl({ categoryGuard: true });
      const { added, total } = enqueue(found, { nowIso: now.toISOString() });
      console.log(`[scheduler] backlog ${before} (< ${MIN_BACKLOG}) → found ${found.length}, enqueued ${added}, backlog now ${total}.`);
    } catch (e) { console.error(`[scheduler] find top-up failed: ${String(e?.message || e).slice(0, 120)}`); }
  }
  // PUBLISH one from the backlog.
  const report = await runImpl({ fromFind: true, limit: PER_TICK, hero: true, links: true, categoryGuard: true });
  // Stamp the interval clock ONLY when something actually published (a dry slot retries on the next tick).
  // REVIEW runs never stamp the live cadence clock (the preview must not delay the next real post).
  if (report.published.length > 0 && !reviewDir()) saveSchedule({ ...sched, lastPostAt: now.toISOString(), lastSlugs: report.published.map((p) => p.slug) }, schedPath);
  const slugs = report.published.map((p) => p.slug);
  console.log(`[scheduler] ${force ? "(forced) " : ""}published ${report.published.length} (processed ${report.topics}; held ${report.held.length}, rejected ${report.rejected.length}, skipped ${report.skipped.length}, blocked ${report.blocked.length}). backlog now ${loadQueue().topics.length}.`);
  setOutput({ published: report.published.length, slugs: slugs.join(",") });
  return { published: report.published.length, slugs };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await tick();
}
