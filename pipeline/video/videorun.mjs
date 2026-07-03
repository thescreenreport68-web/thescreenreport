// REELS VIDEO — the DAILY ORCHESTRATOR (fully autonomous; the human touches nothing).
// Picks the top stories from the article pipeline's publish ledger → renders each one through the full
// production line (script → voice → captions → frames → premium render + brand) → drops MP4 + caption
// sidecar in the outbox (data/video/out/). Social posting is NOT wired yet (owner 2026-07-03: build and
// test the automation first; platforms connect later — the outbox is the interface they'll read from).
// Run: cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; \
//      node site/pipeline/video/videorun.mjs [--count=10] [--window-hours=24]
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { VIDEO } from "./config.mjs";
import { makeVideo } from "./makevideo.mjs";
import { costReport } from "../lib/openrouter.mjs";
import { detectSensitive } from "./sensitive.mjs";

const ROOT = "/Users/sivajithcu/Movie News site/site";
const arg = (k, d = null) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=").slice(1).join("=") || d;
const COUNT = Number(arg("count", VIDEO.dailyCount));
const WINDOW_H = Number(arg("window-hours", VIDEO.windowHours));

// ── 1 · CANDIDATES: the publish ledger, newest window, one per event, not already rendered
const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, "data/find/published.json"), "utf8"));
const cutoff = Date.now() - WINDOW_H * 3600 * 1000;
const seenEvent = new Set();
const candidates = [];
for (const r of [...ledger].reverse()) { // newest first
  if (!r.slug || !r.at || Date.parse(r.at) < cutoff) continue;
  if (r.eventSlug && seenEvent.has(r.eventSlug)) continue;
  if (fs.existsSync(path.join(VIDEO.outDir, `${r.slug}.mp4`))) continue; // cross-run dedup: never re-render
  const mdPath = path.join(ROOT, "content/articles", `${r.slug}.md`);
  if (!fs.existsSync(mdPath)) continue;
  const { data: fm } = matter(fs.readFileSync(mdPath, "utf8"));
  if (String(fm.storyStatus).toUpperCase() === "RUMOR") continue; // rumors never get videos (v1 policy)
  // PHASE 2: sensitivity policy as CODE (was a comment). Legal/minor: always blocked. Death: per policy.
  const sens2 = detectSensitive(fm, fs.readFileSync(mdPath, "utf8").slice(0, 1200));
  if (sens2.legal || sens2.minor) { console.log(`  ⛔ sensitive (legal/minor) — skipped: ${r.slug}`); continue; }
  if (sens2.death && VIDEO.sensitivePolicy !== "somber") { console.log(`  ⛔ sensitive (death, policy=block) — skipped: ${r.slug}`); continue; }
  if (r.eventSlug) seenEvent.add(r.eventSlug);
  candidates.push({
    slug: r.slug, title: r.title || fm.title, at: r.at,
    priority: Number.isFinite(r.priority) ? r.priority : 0, // present on new records (recordPublished v2)
    pop: r.signals?.pop || 0,
    category: r.category || fm.category || "movies",
    sensitivity: fm?.provenance?.sensitivity || null,
  });
}
// ── 2 · RANK: priority + popularity, newest as tiebreak; CATEGORY DIVERSITY cap so one beat can't own the feed
candidates.sort((a, b) => (b.priority + b.pop) - (a.priority + a.pop) || Date.parse(b.at) - Date.parse(a.at));
const capPerCat = Math.max(2, Math.ceil(COUNT * 0.4));
const catCount = {}, queue = [], overflow = [];
for (const c of candidates) {
  if ((catCount[c.category] || 0) < capPerCat) { catCount[c.category] = (catCount[c.category] || 0) + 1; queue.push(c); }
  else overflow.push(c);
}
queue.push(...overflow); // diversity preferred, but never leave slots empty

const runId = `vrun-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
console.log(`\n■ ${runId} — ${candidates.length} candidate(s) in last ${WINDOW_H}h, target ${COUNT} video(s)\n`);

// ── 3 · PRODUCE: sequential; a failed story logs + the next candidate takes its slot
const made = [], failed = [];
for (const c of queue) {
  if (made.length >= COUNT) break;
  const before = costReport().total || 0;
  console.log(`\n=== [${made.length + 1}/${COUNT}] ${c.title} (${c.category}, prio ${c.priority}) ===`);
  try {
    const r = await makeVideo({ slug: c.slug });
    const usd = (costReport().total || 0) - before;
    fs.copyFileSync(r.out, "/Users/sivajithcu/Movie News site/Latest-Video.mp4"); // stable owner-review handle
    made.push({ slug: c.slug, title: c.title, category: c.category, seconds: r.seconds, usd: +usd.toFixed(5), file: r.out });
    console.log(`  ✓ ${r.seconds}s · $${usd.toFixed(4)}`);
  } catch (e) {
    failed.push({ slug: c.slug, error: String(e.message || e).slice(0, 200) });
    console.log(`  ✗ ${String(e.message || e).slice(0, 160)}`);
  }
}

// ── 4 · RUN REPORT (plain inspectable JSON, findrun convention)
const report = {
  runId, at: new Date().toISOString(), windowHours: WINDOW_H, target: COUNT,
  candidates: candidates.length, made, failed,
  cost: costReport(),
};
fs.mkdirSync(path.join(ROOT, "data/video/runs"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data/video/runs", `${runId}.json`), JSON.stringify(report, null, 2));
console.log(`\n■ DONE: ${made.length} made, ${failed.length} failed · total $${(report.cost.total || 0).toFixed(4)} · report data/video/runs/${runId}.json`);
