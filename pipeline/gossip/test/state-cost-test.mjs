// 2026-07-19 Batch D — dedup persistence, tick state, burst accounting, cost bounds.
//   node pipeline/gossip/test/state-cost-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dedupCheck } from "../dedup.mjs";
import { writeGossipArticle } from "../assemble.mjs";
import { gossipRun } from "../gossiprun.mjs";
import { AGENTS } from "../models.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
process.env.GOSSIP_STATS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-stats-"));
console.log("\n=== BATCH D: STATE / DEDUP PERSISTENCE / COST ===\n");

// ── #16 an UPDATE publishes, so its record MUST stay semantically searchable ──
{
  const store = { byUrlHash: () => null, byEventKey: () => [{ key: "parent", summary: "Jelly Roll: files for divorce", createdAt: new Date().toISOString() }], search: () => [] };
  let embedCalls = 0;
  const r = await dedupCheck({ primaryEntity: "Jelly Roll", title: "Jelly Roll divorce finalized", claim: "divorce finalized", sources: [{ url: "https://x.com/a" }] },
    store, { adjudicateImpl: async () => ({ verdict: "UPDATE", newFact: "finalized" }), embedImpl: async () => { embedCalls++; return new Float32Array(8).fill(0.2); } });
  check("UPDATE decision returned", r.decision === "UPDATE");
  check("UPDATE carries an embedding (not invisible to L3 forever)", Array.isArray(r.embedding) && r.embedding.length === 8, JSON.stringify(r.embedding));
  // a DUPLICATE never publishes, so it must not pay for an embedding
  const r2 = await dedupCheck({ primaryEntity: "Jelly Roll", title: "same story", claim: "divorce", sources: [{ url: "https://x.com/b" }] },
    store, { adjudicateImpl: async () => ({ verdict: "DUPLICATE" }), embedImpl: async () => { embedCalls++; return new Float32Array(8).fill(0.2); } });
  check("DUPLICATE does not pay for an embedding", r2.decision === "DUPLICATE" && r2.embedding === null);
}
// ── #24 a follow-up must never overwrite the parent article it links to ──
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arts-"));
  const base = {
    article: { title: "Star A and Star B Finalize Divorce", dek: "The pair settled quietly this week in court.", body: "Star A and Star B finalized their divorce on July 3, People reports. " + "More verified detail here. ".repeat(20), keyTakeaways: ["k"], faq: [], whatWeKnow: ["Star A divorced"] },
    frame: { tier: "CONFIRMED", severity: "NORMAL", uiLabel: "Confirmed", monitor: false },
    provenance: { sensitivity: "normal", attribution: "People", monitor: false, sources: [], corroborationCount: 1, publishedAt: "2026-07-19T00:00:00Z" },
    route: { category: "celebrity", subcategory: "news" },
    topic: { primaryEntity: "Star A", id: "t1" },
    dateISO: "2026-07-19T00:00:00.000Z", dir,
  };
  const first = writeGossipArticle(base);
  const second = writeGossipArticle(base);           // identical slug — the follow-up collision case
  check("a colliding write gets a NEW slug, not an overwrite", first.slug !== second.slug, `${first.slug} vs ${second.slug}`);
  check("the parent file still exists and is untouched", fs.existsSync(first.path) && fs.existsSync(second.path));
  check("both files are non-empty", fs.readFileSync(first.path, "utf8").length > 100 && fs.readFileSync(second.path, "utf8").length > 100);
}
// ── #27 a re-queued topic must not be re-popped (and re-paid for) in the SAME tick ──
{
  const topic = { id: "hold-me", primaryEntity: "Star Z", title: "t", claim: "c", subjectType: "actor", sources: [{ outlet: "P", text: "x ".repeat(200) }] };
  let runs = 0;
  const r = await gossipRun({
    fromFind: true, limit: 1, maxDrain: 6,
    dequeueImpl: () => [ { ...topic } ],                       // always hands back the SAME id
    runImpl: async () => { runs++; return { status: "HELD", stage: "frame", reason: "extreme", frame: {}, article: null }; },
    writeImpl: () => ({ slug: "x", path: "/x", frontmatter: {}, md: "", written: false, seoIssues: [] }),
    dedup: false, hero: false, links: false, dryRun: true,
  });
  check("the same topic is processed ONCE per tick, not repeatedly", runs === 1, `runImpl ran ${runs}x`);
  check("the drain budget still terminates the tick", r.topics <= 6, `topics=${r.topics}`);
}
// ── #26 a burst slot may only be spent on the topic that earned it ──
{
  let published = null;
  const r = await gossipRun({
    fromFind: true, limit: 1, maxDrain: 5, requireTopicId: "tier-s",
    dequeueImpl: (() => { const q = [{ id: "ordinary", primaryEntity: "Star Y", title: "t", claim: "c", subjectType: "actor" }, { id: "tier-s", primaryEntity: "Star S", title: "t", claim: "c", subjectType: "actor" }]; return () => (q.length ? [q.shift()] : []); })(),
    runImpl: async (t) => { published = t.id; return { status: "HELD", stage: "editorial", reason: "stub", frame: {}, article: null }; },
    writeImpl: () => ({ slug: "x", path: "/x", frontmatter: {}, md: "", written: false, seoIssues: [] }),
    dedup: false, hero: false, links: false, dryRun: true,
  });
  check("an ordinary topic cannot ride the Tier-S burst slot", published === "tier-s", `ran: ${published}`);
  check("the skipped topic is recorded as NOT_BURST_TOPIC", (r.skipped || []).some((x) => x.decision === "NOT_BURST_TOPIC"));
}
// ── #28 chat() must be a single bounded attempt per model ──
{
  const { agentChat } = await import("../models.mjs");
  let sawRetries = null;
  await agentChat("linker", { system: "s", user: "u" }, { chatImpl: async (a) => { sawRetries = a.retries; return { data: {}, usage: {} }; } });
  check("chat() gets retries=0 (agentChat owns retrying, per-attempt deadlines hold)", sawRetries === 0, String(sawRetries));
  const roles = Object.entries(AGENTS).filter(([, c]) => c.attemptDeadlineMs);
  check("every role still declares an attempt deadline", roles.length >= 10, String(roles.length));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Batch D green — state persists, dedup stays searchable, spend is bounded. ✅\n");
