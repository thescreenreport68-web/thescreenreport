// GOSSIP — TOP ORCHESTRATOR (the whole pipeline for one run). discover -> categorize -> [per topic]
// gather -> frame -> write -> legal+quality gate -> publish -> JUDGE (score). Prints a monitoring report. All
// stage impls are injectable so the harness drives it offline; the CLI runs it live.
//   Live run (one article per category): cd site-gossip && set -a; . "/Users/sivajithcu/Movie News site/.env"; set +a; node pipeline/gossip/gossiprun.mjs --one-per-category [--dry-run]
import { discoverGossip } from "./discover.mjs";
import { categorizeGossip } from "./categorize.mjs";
import { runGossip } from "./run.mjs";
import { writeGossipArticle } from "./assemble.mjs";
import { judgeGossip } from "./judge.mjs";
import { detectGossipType } from "./writer.mjs";
import { routeBySubject } from "./config.gossip.mjs";

// One topic per category (celebrity/music/awards) — topics arrive freshest-first from discover, so first wins.
function onePerCategoryPick(topics) {
  const byCat = new Map();
  for (const t of topics) {
    const cat = routeBySubject(t.subjectType).category;
    if (!byCat.has(cat)) byCat.set(cat, t);
  }
  return [...byCat.values()];
}

export async function gossipRun({ discoverImpl, categorizeImpl, runImpl = runGossip, writeImpl = writeGossipArticle, judgeImpl = judgeGossip, onePerCategory = false, judge = true, limit = 0, dryRun = false, nowMs } = {}) {
  const candidates = discoverImpl ? await discoverImpl() : await discoverGossip();
  // Shortlist the freshest for the categorize LLM (cost + token control; candidates arrive freshest-first).
  const shortlist = candidates.slice(0, 24);
  const all = categorizeImpl ? await categorizeImpl(candidates) : await categorizeGossip(shortlist);
  let topics = onePerCategory ? onePerCategoryPick(all) : all;
  if (limit) topics = topics.slice(0, limit);
  const now = nowMs ?? Date.now();
  const report = { candidates: candidates.length, inScope: all.length, topics: topics.length, published: [], held: [], blocked: [] };

  for (let i = 0; i < topics.length; i++) {
    const t = topics[i];
    const dateISO = new Date(now - i * 60000).toISOString();
    const cat = routeBySubject(t.subjectType).category;
    let r;
    try {
      r = await runImpl(t);
    } catch (e) {
      report.blocked.push({ id: t.id, category: cat, status: "ERROR", reason: String(e?.message || e).slice(0, 140) });
      continue;
    }
    if (r.status === "PUBLISH") {
      let auto = null;
      if (judge) { try { auto = await judgeImpl({ article: r.article, bundle: r.bundle, frame: r.frame }); } catch (e) { auto = { error: String(e?.message || e).slice(0, 80) }; } }
      // FAIL-CLOSED JUDGE GATE: judge runs BEFORE we write. A fabrication/safety problem (safety subscore < 7,
      // or no readable safety score) BLOCKS publication — the judge is now a gate, not just a score.
      const safety = auto?.subscores?.safety;
      // Block if safety is low OR the judge explicitly flagged a fabrication/unsupported-claim, regardless of
      // the number (a fabricated quote scored "safety 7" still published before — catch the FLAG, not just the score).
      const issuesText = (auto?.issues || []).join(" ");
      const fabFlag = /not (in|supported|present|found|directly|backed).{0,30}(bundle|source|snippet|provided|text|report)|fabricat|invented|\bmade up\b|not supported by|unsubstantiated|not directly supported|quote is not/i.test(issuesText);
      if (judge && (!Number.isFinite(safety) || safety < 8 || fabFlag)) {
        report.blocked.push({ id: t.id, category: cat, status: "BLOCKED_JUDGE", autoScore: auto?.score ?? null, reason: `safety ${safety ?? "?"}${fabFlag ? " + fabrication flagged" : ""} — ${(auto?.issues || []).slice(0, 2).join("; ") || auto?.error || "unsafe"}` });
        continue;
      }
      const out = writeImpl({ article: r.article, frame: r.frame, provenance: r.provenance, route: r.route, topic: t, dateISO, dryRun });
      report.published.push({
        id: t.id, category: cat, slug: out.slug, entity: t.primaryEntity, title: r.article.title,
        gossipType: detectGossipType(t), tier: r.frame.tier, severity: r.frame.severity, label: r.frame.uiLabel,
        autoScore: auto?.score ?? null, subscores: auto?.subscores ?? null, autoIssues: auto?.issues ?? [],
        sources: (r.bundle?.sources || []).map((s) => `${s.outlet}/${s.tier}`), written: out.written, path: out.path,
      });
    } else if (r.status === "HELD") {
      report.held.push({ id: t.id, category: cat, reason: r.reason });
    } else {
      const reason = (r.blocks || r.issues || [r.reason]).join ? (r.blocks || r.issues || [r.reason]).join(" | ") : r.reason;
      report.blocked.push({ id: t.id, category: cat, status: r.status, reason });
    }
  }
  return report;
}

// CLI
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dryRun = process.argv.includes("--dry-run");
  const onePerCategory = process.argv.includes("--one-per-category");
  const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 0;
  const report = await gossipRun({ dryRun, onePerCategory, limit });
  console.log(`\n${"━".repeat(60)}\n GOSSIP AUTOMATION — RUN REPORT\n${"━".repeat(60)}`);
  console.log(`DISCOVER: ${report.candidates} candidates  →  CATEGORIZE: ${report.inScope} in-scope  →  SELECTED: ${report.topics}`);
  console.log(`\nPUBLISHED (${report.published.length}):`);
  for (const p of report.published) {
    console.log(`\n  ● [${p.category}] ${p.title}`);
    console.log(`     type=${p.gossipType} · tier=${p.tier} · sev=${p.severity} · label="${p.label}" · sources=[${p.sources.join(", ")}]`);
    console.log(`     AUTOMATION SCORE: ${p.autoScore}  ${p.subscores ? JSON.stringify(p.subscores) : ""}`);
    if (p.autoIssues?.length) console.log(`     auto-flagged issues: ${p.autoIssues.join(" | ")}`);
    console.log(`     ${p.written ? "WROTE" : "(dry)"} ${p.slug}.md`);
  }
  if (report.held.length) { console.log(`\nHELD (${report.held.length}):`); for (const h of report.held) console.log(`  ⏸ [${h.category}] ${h.id} — ${h.reason}`); }
  if (report.blocked.length) { console.log(`\nBLOCKED (${report.blocked.length}):`); for (const b of report.blocked) console.log(`  ✗ [${b.category}] [${b.status}] ${b.id} — ${b.reason}`); }
  console.log("");
}
