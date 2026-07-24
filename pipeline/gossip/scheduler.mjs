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
import { gossipFind, enqueue, loadQueue, peekTopScore } from "./find.mjs";
import { gossipRun, reviewDir } from "./gossiprun.mjs";
import { runProbes } from "./probes.mjs";
import { getSearchSignals, buildDemandMap, strikingDistance } from "./gscSignals.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHED_PATH = path.resolve(__dirname, "../../data/gossip/schedule.json");
const PAUSED_PATH = path.resolve(__dirname, "../../data/gossip/PAUSED");

const INTERVAL_MIN = Number(process.env.INTERVAL_MIN ?? 115); // ~2h between posts (24/7) ⇒ ~12/day
const MIN_BACKLOG = Number(process.env.MIN_BACKLOG ?? 15);
// Phase 5 — TIER-S BURST LANE: a mega-story (demand score ≥ BURST_SCORE: heat window + viral engagement +
// hot class) publishes IMMEDIATELY instead of waiting out the ~2h interval. HARD-CAPPED (the news lane's
// lesson: an unlimited bypass could legally flood): ≤ BURST_MAX_PER_DAY extra posts/day, and never within
// BURST_MIN_GAP_MIN of the last post. Counters persist in schedule.json (UTC-day rollover).
const BURST_SCORE = Number(process.env.BURST_SCORE ?? 65);
const BURST_MAX_PER_DAY = Number(process.env.BURST_MAX_PER_DAY ?? 3);
const BURST_MIN_GAP_MIN = Number(process.env.BURST_MIN_GAP_MIN ?? 30);
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

  // GOOGLE SEARCH SIGNALS — STEP 1 (owner-approved 2026-07-24): fetch + cache + LOG ONLY.
  // Nothing downstream consumes this yet. It runs every tick so the cache warms and we can watch the
  // recovery, and it is wrapped so a GSC failure can never affect publishing. Steps 2–4 (demand-nudged
  // selection, query-phrased headlines, striking-distance updates) stay OFF until impressions recover —
  // the whole site earned 21 impressions in the 7 days to 2026-07-24, which is noise, not signal.
  try {
    const gsc = await getSearchSignals({ now: now.getTime() });
    if (gsc.ok || (gsc.queries || []).length) {
      const imps = (gsc.queries || []).reduce((a, q) => a + (Number(q.impressions) || 0), 0);
      const names = buildDemandMap(gsc).size;
      const sd = strikingDistance(gsc).length;
      console.log(`[gsc] ${imps} impressions / ${(gsc.queries || []).length} queries (7d) · ${names} name(s) with demand · ${sd} page(s) at pos 8–30${gsc.cached ? " (cached)" : ""} — informational only, selection unchanged`);
    } else {
      console.log(`[gsc] unavailable — ${gsc.reason}. Lane continues exactly as before.`);
    }
  } catch (e) {
    console.log(`[gsc] skipped: ${String(e?.message || e).slice(0, 60)} — never blocks a tick`);
  }
  const sched = loadSchedule(schedPath);
  const since = minsSinceLastPost(now, sched);
  let burst = false, burstTopicId = null;
  if (!force && since < intervalMin) {
    // BURST CHECK (Phase 5): peek (no claim) — a Tier-S story may bypass the interval, within hard caps.
    const day = now.toISOString().slice(0, 10);
    const burstsToday = sched.burstDay === day ? (sched.burstsToday || 0) : 0;
    const top = since >= BURST_MIN_GAP_MIN && burstsToday < BURST_MAX_PER_DAY ? peekTopScore({ nowMs: now.getTime() }) : null;
    if (top && top.score >= BURST_SCORE) {
      burst = true;
      burstTopicId = top.id || null;
      console.log(`[scheduler] 🔥 BURST: top topic "${top.entity}" scores ${top.score} (≥ ${BURST_SCORE}) — bypassing the interval (${burstsToday + 1}/${BURST_MAX_PER_DAY} today).`);
    } else {
      console.log(`[scheduler] only ${Math.round(since)}min since last post (< ${intervalMin}); no-op.`);
      setOutput({ published: 0, reason: "too-soon" });
      return { published: 0, reason: "too-soon" };
    }
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
  // A burst bypasses the ~115-min interval because ONE peeked topic scored Tier-S. The article that
  // actually shipped was whatever survived the drain, so an ordinary story could ride the Tier-S slot.
  // When the bypass was granted, require the run to publish THAT topic or nothing.
  const report = await runImpl({ fromFind: true, limit: PER_TICK, hero: true, links: true, categoryGuard: true, ...(burst && burstTopicId ? { requireTopicId: burstTopicId } : {}) });
  // Stamp the interval clock ONLY when something actually published (a dry slot retries on the next tick).
  // REVIEW runs never stamp the live cadence clock (the preview must not delay the next real post).
  if (report.published.length > 0 && !reviewDir()) {
    const day = now.toISOString().slice(0, 10);
    const burstsToday = (sched.burstDay === day ? (sched.burstsToday || 0) : 0) + (burst ? 1 : 0);
    saveSchedule({ ...sched, lastPostAt: now.toISOString(), lastSlugs: report.published.map((p) => p.slug), burstDay: day, burstsToday }, schedPath);
  }
  const slugs = report.published.map((p) => p.slug);
  console.log(`[scheduler] ${force ? "(forced) " : ""}published ${report.published.length} (processed ${report.topics}; held ${report.held.length}, rejected ${report.rejected.length}, skipped ${report.skipped.length}, blocked ${report.blocked.length}). backlog now ${loadQueue().topics.length}.`);
  setOutput({ published: report.published.length, slugs: slugs.join(",") });
  return { published: report.published.length, slugs };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await tick();
}
