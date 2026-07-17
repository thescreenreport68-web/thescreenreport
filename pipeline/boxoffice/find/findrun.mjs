// P2 FIND — the queue builder (BOX_OFFICE_UPGRADE_PLAN §L2). On demand (borun triggers when the queue is
// stale), sweep the EVENT sources (trade RSS + gnews), categorize in ONE batched cheap call, cluster,
// score deterministically, and write the ranked queue the finder consumes. Inventory sources (daily
// chart, Netflix TSV, provider diffs) stay in the finder — this file only adds the EVENT stream the lane
// never had. Total cost per run ≈ one flash-lite categorize batch (~$0.001).
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config.bo.mjs";
import { sweepFeeds, sweepGnews } from "./sources.mjs";
import { categorize, cluster } from "./events.mjs";
import { scoreEvent } from "./score.mjs";

export const QUEUE_PATH = path.join(DATA_DIR, "find", "queue.json");
export const QUEUE_FRESH_MIN = 45;

export function readQueue({ file = QUEUE_PATH, nowMs = Date.now(), freshMin = QUEUE_FRESH_MIN } = {}) {
  try {
    const q = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!q?.builtAt || (nowMs - Date.parse(q.builtAt)) / 60000 > freshMin) return null;
    return q;
  } catch { return null; }
}

export function markConsumed(slugs, { file = QUEUE_PATH, nowMs = Date.now() } = {}) {
  if (!slugs?.length) return;
  try {
    const q = JSON.parse(fs.readFileSync(file, "utf8"));
    const set = new Set(slugs);
    for (const ev of q.events || []) if (set.has(ev.slug)) ev.consumedAt = new Date(nowMs).toISOString();
    fs.writeFileSync(file, JSON.stringify(q, null, 1));
  } catch { /* best-effort */ }
}

// runFind() → the queue object (also persisted). Injectable impls keep the suite network-free.
export async function runFind({ fetchImpl = fetch, chatImpl = null, nowMs = Date.now(), trackedFilms = null, file = QUEUE_PATH } = {}) {
  const [rss, gnews] = [await sweepFeeds({ fetchImpl, nowMs }), await sweepGnews({ fetchImpl, nowMs })];
  const categorized = await categorize([...rss, ...gnews], { chatImpl });
  const events = cluster(categorized, { nowMs });
  // Enrich with days-in-release from the tracked ledger (title match, best-effort) for the recency prior.
  const daysByTitle = new Map();
  for (const rec of Object.values(trackedFilms || {})) {
    if (rec?.title && Number.isFinite(rec?.daysInReleaseApprox)) daysByTitle.set(rec.title.toLowerCase(), rec.daysInReleaseApprox);
  }
  for (const ev of events) {
    ev.daysInRelease = daysByTitle.get(ev.filmTitle.toLowerCase());
    ev.priority = scoreEvent(ev, { nowMs });
  }
  events.sort((a, b) => b.priority - a.priority);
  const queue = { builtAt: new Date(nowMs).toISOString(), events };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(queue, null, 1));
  } catch { /* best-effort persist */ }
  return queue;
}
