// GOSSIP — FIND (producer). Mirrors the news FIND→MAKE seam (find/findrun.mjs): discover → shortlist → categorize
// → category-guard → APPEND the in-scope topics to a persistent backlog QUEUE (data/gossip/queue.json). It writes
// NOTHING live — MAKE (`gossiprun.mjs --from-find`) drains the queue on the drip. This is the owner's "pending
// stories" backlog: FIND over-produces to build a buffer; MAKE pops the oldest and publishes.
//
// Dedup vs already-PUBLISHED happens at PUBLISH time (the claim-guard in gossiprun) — FIND only avoids queuing the
// SAME discovered story twice (by topic id). discoverImpl/categorizeImpl are injectable so the harness runs offline.
// Run (live): cd site && set -a; . "../.env"; set +a; node pipeline/gossip/find.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverGossip } from "./discover.mjs";
import { discoverSocial } from "./discoverSocial.mjs";
import { categorizeGossip } from "./categorize.mjs";
import { correctSubjectType } from "./categoryGuard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const QUEUE_PATH = path.resolve(__dirname, "../../data/gossip/queue.json");

// ── QUEUE (the backlog) ──────────────────────────────────────────────────────────────────────────────────────
export function loadQueue(filePath = QUEUE_PATH) {
  try { const q = JSON.parse(fs.readFileSync(filePath, "utf8")); return Array.isArray(q?.topics) ? q : { topics: [] }; }
  catch { return { topics: [] }; }
}
export function saveQueue(topics, filePath = QUEUE_PATH, builtAt = null) {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch { /* dir exists */ }
  fs.writeFileSync(filePath, JSON.stringify({ builtAt, count: topics.length, topics }, null, 2));
  return topics.length;
}
// APPEND fresh topics to the backlog, skipping any already queued (by id). Returns {added, total}.
export function enqueue(freshTopics, { filePath = QUEUE_PATH, nowIso = null } = {}) {
  const q = loadQueue(filePath);
  const have = new Set(q.topics.map((t) => t?.id).filter(Boolean));
  let added = 0;
  for (const t of freshTopics || []) {
    if (t && t.id && !have.has(t.id)) { q.topics.push({ ...t, queuedAt: nowIso }); have.add(t.id); added++; }
  }
  saveQueue(q.topics, filePath, nowIso || q.builtAt);
  return { added, total: q.topics.length };
}
// POP the oldest n topics (FIFO) and remove them from the file — this IS the claim (a popped topic can't be
// grabbed by an overlapping tick). Returns the popped topics.
export function dequeue(n, { filePath = QUEUE_PATH } = {}) {
  const q = loadQueue(filePath);
  const take = Math.max(0, Math.min(n, q.topics.length));
  const popped = q.topics.slice(0, take);
  saveQueue(q.topics.slice(take), filePath, q.builtAt);
  return popped;
}

// ── FIND (discover → categorize → guard) ─────────────────────────────────────────────────────────────────────
// Returns the in-scope topics (categorizer output). No dedup here; MAKE's claim-guard handles already-published.
export async function gossipFind({
  discoverImpl, categorizeImpl,
  categoryGuardImpl = correctSubjectType, categoryGuard = false,
  social = true, short = 100,
} = {}) {
  const rss = discoverImpl ? await discoverImpl() : await discoverGossip();
  const soc = discoverImpl ? [] : (social ? await discoverSocial() : []);
  // Reserve ~40% of the shortlist for SOCIAL (the speculation lane RSS can't see); categorize scope-filters the rest.
  const socN = Math.min(soc.length, Math.round(short * 0.4));
  const shortlist = [...rss.slice(0, short - socN), ...soc.slice(0, socN)];
  const candidates = [...rss, ...soc];
  const all = categorizeImpl ? await categorizeImpl(candidates) : await categorizeGossip(shortlist);
  // CATEGORY GUARD (deterministic): fix any non-musician mislabeled "musician" so it never files under Music.
  if (categoryGuard) for (const t of all) { try { const s = await categoryGuardImpl(t); if (s) t.subjectType = s; } catch { /* keep LLM label */ } }
  return all;
}

// CLI: top up the backlog.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const topics = await gossipFind({ categoryGuard: true });
  const { added, total } = enqueue(topics, { nowIso: new Date().toISOString() });
  console.log(`GOSSIP FIND — ${topics.length} in-scope topics discovered → ${added} new enqueued → backlog now ${total}.`);
}
