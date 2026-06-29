// GOSSIP — TOP ORCHESTRATOR (the whole pipeline for one run). discover → categorize → [per topic]
// gather → frame → write → legal+quality gate → publish. Prints a report. All stage impls are injectable so
// the harness drives the entire pipeline offline; the CLI runs it live.
//   Live run:  cd site-gossip && set -a; . "/Users/sivajithcu/Movie News site/.env"; set +a; node pipeline/gossip/gossiprun.mjs [--dry-run] [--limit=N]
import { discoverGossip } from "./discover.mjs";
import { categorizeGossip } from "./categorize.mjs";
import { runGossip } from "./run.mjs";
import { writeGossipArticle } from "./assemble.mjs";

export async function gossipRun({ discoverImpl, categorizeImpl, runImpl = runGossip, writeImpl = writeGossipArticle, limit = 0, dryRun = false, nowMs } = {}) {
  const candidates = discoverImpl ? await discoverImpl() : await discoverGossip();
  const all = categorizeImpl ? await categorizeImpl(candidates) : await categorizeGossip(candidates);
  const topics = limit ? all.slice(0, limit) : all;
  const now = nowMs ?? Date.now();
  const report = { candidates: candidates.length, topics: topics.length, published: [], held: [], blocked: [] };

  for (let i = 0; i < topics.length; i++) {
    const t = topics[i];
    const dateISO = new Date(now - i * 60000).toISOString();
    let r;
    try {
      r = await runImpl(t);
    } catch (e) {
      report.blocked.push({ id: t.id, status: "ERROR", reason: String(e?.message || e).slice(0, 140) });
      continue;
    }
    if (r.status === "PUBLISH") {
      const out = writeImpl({ article: r.article, frame: r.frame, provenance: r.provenance, route: r.route, topic: t, dateISO, dryRun });
      report.published.push({ id: t.id, slug: out.slug, label: r.frame.uiLabel, written: out.written });
    } else if (r.status === "HELD") {
      report.held.push({ id: t.id, reason: r.reason });
    } else {
      const reason = (r.blocks || r.issues || [r.reason]).join ? (r.blocks || r.issues || [r.reason]).join(" | ") : r.reason;
      report.blocked.push({ id: t.id, status: r.status, reason });
    }
  }
  return report;
}

// CLI
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dryRun = process.argv.includes("--dry-run");
  const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 0;
  const report = await gossipRun({ dryRun, limit });
  console.log(`\n── GOSSIP RUN ──`);
  console.log(`candidates ${report.candidates} → in-scope topics ${report.topics}`);
  console.log(`PUBLISHED ${report.published.length}:`);
  for (const p of report.published) console.log(`  ✓ [${p.label}] ${p.slug}${p.written ? "" : " (dry)"}`);
  if (report.held.length) { console.log(`HELD ${report.held.length}:`); for (const h of report.held) console.log(`  ⏸ ${h.id} — ${h.reason}`); }
  if (report.blocked.length) { console.log(`BLOCKED ${report.blocked.length}:`); for (const b of report.blocked) console.log(`  ✗ [${b.status}] ${b.id} — ${b.reason}`); }
}
