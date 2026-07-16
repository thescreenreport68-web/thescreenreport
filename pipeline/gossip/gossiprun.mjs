// GOSSIP — MAKE orchestrator (the consumer half of the FIND→MAKE seam). FIND (`find.mjs`) fills the backlog queue;
// this drains it — or, in the one-shot local/offline path, discovers inline via `gossipFind` — and runs each topic
// through the full single-topic pipeline (gather → editorial gate → frame → write → gates → JUDGE → publish), then
// picks a hero + internal links. Prints a monitoring report. All stage impls are injectable so the harness drives
// it offline; the CLI runs live.
//   FIND→MAKE (cloud drip):  node pipeline/gossip/find.mjs                          # fill the backlog
//                            node pipeline/gossip/gossiprun.mjs --from-find --limit=1   # publish one from it
//   One-shot local:          node pipeline/gossip/gossiprun.mjs --limit=20             # discover + publish inline
import { gossipFind, dequeue } from "./find.mjs";
import { runGossip } from "./run.mjs";
import { writeGossipArticle } from "./assemble.mjs";
import { detectGossipType } from "./writer.mjs";
import { routeBySubject } from "./config.gossip.mjs";
import { openStore } from "./vecStore.mjs";
import { dedupCheck, recordPublished } from "./dedup.mjs";
import { costReport } from "../lib/openrouter.mjs";
import { pickHero } from "./heroImage.mjs";
import { buildLinkIndex } from "./linkIndex.mjs";
import { findRelatedLinks } from "./internalLinks.mjs";

// One topic per category (celebrity/music/awards) — topics arrive freshest-first from discover, so first wins.
function onePerCategoryPick(topics) {
  const byCat = new Map();
  for (const t of topics) {
    const cat = routeBySubject(t.subjectType).category;
    if (!byCat.has(cat)) byCat.set(cat, t);
  }
  return [...byCat.values()];
}

export async function gossipRun({
  discoverImpl, categorizeImpl, runImpl = runGossip, writeImpl = writeGossipArticle,
  heroImpl = pickHero, linkIndexImpl = buildLinkIndex, findRelatedImpl = findRelatedLinks, categoryGuardImpl,
  onePerCategory = false, verify = true, judge = true, hero = false, links = false, categoryGuard = false,
  dedup = true, social = true, storeImpl = null, embedImpl, adjudicateImpl,
  limit = 0, fromFind = false, dequeueImpl = dequeue, maxDrain = 10, dryRun = false, nowMs,
} = {}) {
  const now = nowMs ?? Date.now();
  const store = dedup ? (storeImpl || openStore()) : null;
  // STEP 7 — build the internal-link index ONCE over the published corpus (off by default offline; the CLI turns it on).
  let linkIndex = null;
  if (links) { try { linkIndex = await linkIndexImpl(); } catch { linkIndex = null; } }

  // TOPIC SOURCE: --from-find drains the FINDER's backlog queue (a pop IS the claim); otherwise discover inline
  // (the one-shot local run + offline tests). Same categorized-topic shape either way.
  let inlineTopics = null, inlineIdx = 0;
  if (!fromFind) {
    const all = await gossipFind({ discoverImpl, categorizeImpl, categoryGuardImpl, categoryGuard, social });
    inlineTopics = onePerCategory ? onePerCategoryPick(all) : all;
    if (limit) inlineTopics = inlineTopics.slice(0, limit);
  }
  const nextTopic = () => fromFind ? (dequeueImpl(1)[0] || null) : (inlineIdx < inlineTopics.length ? inlineTopics[inlineIdx++] : null);
  // --from-find keeps draining until `limit` articles actually PUBLISH (skipping past any held/dup) or the queue
  // empties — so a drip tick reliably yields one live article. Inline mode processes its fixed (already-limited) list.
  const publishTarget = fromFind ? (limit || 1) : Infinity;

  const report = { mode: fromFind ? "from-find" : "inline", inScope: fromFind ? null : inlineTopics.length, topics: 0, published: [], held: [], blocked: [], skipped: [], rejected: [] };

  // In --from-find mode, cap topics PROCESSED per invocation so one tick can't runaway-drain the whole backlog
  // chasing a publish (bounds the cloud tick's wall-clock). Inline mode is already bounded by its fixed list.
  let i = 0;
  while (report.published.length < publishTarget && (!fromFind || report.topics < maxDrain)) {
    const t = nextTopic();
    if (!t) break;
    report.topics++;
    const dateISO = new Date(now - i * 60000).toISOString();
    i++;
    const cat = routeBySubject(t.subjectType).category;
    // STEP 2 — DEDUP claim-guard, before any content-find/write spend. Never republish a story — a duplicate, a
    // fail-closed HOLD, and an "UPDATE" on the same event are all skipped; only a truly NEW event runs.
    let dd = null;
    if (dedup && store) {
      dd = await dedupCheck(t, store, { embedImpl, adjudicateImpl, now: new Date(now) });
      if (dd.decision === "DUPLICATE" || dd.decision === "HOLD" || dd.decision === "UPDATE") {
        report.skipped.push({ id: t.id, category: cat, decision: dd.decision, reason: dd.reason, parentKey: dd.parentKey || null });
        continue;
      }
    }
    let r;
    try {
      r = await runImpl(t, { verify, judge });
    } catch (e) {
      report.blocked.push({ id: t.id, category: cat, status: "ERROR", reason: String(e?.message || e).slice(0, 140) });
      continue;
    }
    if (r.status === "PUBLISH") {
      const auto = r.auto || null; // judge already ran inside runGossip as the backstop gate
      // STEP 6 — pick a powerful, story-specific hero. Off by default offline; the live CLI sets hero:true. Fail-safe → none.
      if (hero) { try { r.article.hero = await heroImpl({ topic: { ...t, gossipType: detectGossipType(t) }, article: r.article, bundle: r.bundle, frame: r.frame }); } catch { r.article.hero = null; } }
      // STEP 7 — internal links to REAL related published articles (shared-entity gate + contradiction firewall).
      if (links && linkIndex) { try { r.article.relatedLinks = await findRelatedImpl({ article: r.article, topic: t, index: linkIndex, selfSlug: t.slug }); } catch { r.article.relatedLinks = []; } }
      const out = writeImpl({ article: r.article, frame: r.frame, provenance: r.provenance, route: r.route, topic: t, dateISO, dryRun });
      // record it in the dedup store so future runs won't re-publish it. A DRY RUN never mutates the store.
      if (dedup && store && dd && !dryRun) recordPublished(t, store, { urlHash: dd.urlHash, eventKey: dd.eventKey, embedding: dd.embedding, slug: out.slug, parentKey: dd.parentKey, now: new Date(now) });
      report.published.push({
        id: t.id, category: r.route?.category || cat, slug: out.slug, entity: t.primaryEntity, title: r.article.title,
        gossipType: detectGossipType(t), tier: r.frame.tier, severity: r.frame.severity, label: r.frame.uiLabel,
        autoScore: auto?.score ?? null, subscores: auto?.subscores ?? null, autoIssues: auto?.issues ?? [],
        hero: r.article.hero ? { source: r.article.hero.source, kind: r.article.hero.kind, score: r.article.hero.score, embed: r.article.hero.embed?.platform || null } : null,
        corroboration: r.provenance?.corroborationCount ?? null,
        verifyDegraded: !!r.provenance?.verifyDegraded,
        relatedLinks: (r.article.relatedLinks || []).map((l) => l.slug),
        sources: (r.bundle?.sources || []).map((s) => `${s.outlet}/${s.tier}`), written: out.written, path: out.path,
      });
    } else if (r.status === "HELD") {
      report.held.push({ id: t.id, category: cat, reason: r.reason });
    } else if (r.status === "REJECTED_THIN") {
      // editorial gate: not a real/substantive story (a bare social post / photo / non-story) — never written.
      report.rejected.push({ id: t.id, category: cat, entity: t.primaryEntity, title: t.title, reason: r.reason });
    } else {
      const reason = (r.blocks || r.issues || [r.reason]).join ? (r.blocks || r.issues || [r.reason]).join(" | ") : r.reason;
      report.blocked.push({ id: t.id, category: cat, status: r.status, reason, autoScore: r.auto?.score ?? null });
    }
  }
  // Cost telemetry (owner): log the run's EXACT OpenRouter spend (usage.cost is what OpenRouter actually
  // billed per call) + the per-published-article cost, so every tick records its dollars in the run log.
  try {
    const cr = costReport();
    report.costUSD = cr.total;
    report.costByModel = cr.byModel;
    const perArt = report.published.length ? `  =  $${(cr.total / report.published.length).toFixed(4)}/article (${report.published.length} published)` : ` (0 published)`;
    console.log(`\n💰 COST — $${cr.total.toFixed(4)} over ${cr.calls} model calls${perArt}`);
    for (const [m, v] of Object.entries(cr.byModel).sort((a, b) => b[1].usd - a[1].usd)) {
      console.log(`     ${m}: ${v.calls} calls · ${v.in}+${v.out} tok · $${v.usd.toFixed(4)}`);
    }
  } catch (e) {
    console.error("[cost] report failed:", String(e?.message || e).slice(0, 100));
  }
  return report;
}

// CLI
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dryRun = process.argv.includes("--dry-run");
  const onePerCategory = process.argv.includes("--one-per-category");
  const fromFind = process.argv.includes("--from-find"); // drain the FINDER's backlog queue instead of discovering inline
  const noHero = process.argv.includes("--no-hero"); // hero picker hits TMDB + a cheap vision call; on by default live
  const noLinks = process.argv.includes("--no-links"); // internal links embed the corpus + a cheap firewall call/link
  const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 0;
  const report = await gossipRun({ dryRun, onePerCategory, fromFind, limit, hero: !noHero, links: !noLinks, categoryGuard: true });
  console.log(`\n${"━".repeat(60)}\n GOSSIP AUTOMATION — RUN REPORT (${report.mode})\n${"━".repeat(60)}`);
  console.log(fromFind
    ? `DRAINED from backlog: processed ${report.topics}  →  PUBLISHED ${report.published.length}`
    : `IN-SCOPE: ${report.inScope}  →  PROCESSED: ${report.topics}`);
  console.log(`\nPUBLISHED (${report.published.length}):`);
  for (const p of report.published) {
    console.log(`\n  ● [${p.category}] ${p.title}`);
    console.log(`     type=${p.gossipType} · tier=${p.tier} · sev=${p.severity} · label="${p.label}" · sources=[${p.sources.join(", ")}]`);
    console.log(`     AUTOMATION SCORE: ${p.autoScore}  ${p.subscores ? JSON.stringify(p.subscores) : ""}`);
    console.log(`     hero=${p.hero ? `${p.hero.kind}/${p.hero.source}${p.hero.score != null ? ` (vision ${p.hero.score})` : ""}${p.hero.embed ? ` +${p.hero.embed}-embed` : ""}` : "none"} · corroboration=${p.corroboration ?? "?"} outlets · related=${(p.relatedLinks || []).length}${p.verifyDegraded ? "  ⚠ VERIFY DEGRADED (L1-only — judge backstopped)" : ""}`);
    if (p.relatedLinks?.length) console.log(`     related links: ${p.relatedLinks.join(", ")}`);
    if (p.autoIssues?.length) console.log(`     auto-flagged issues: ${p.autoIssues.join(" | ")}`);
    console.log(`     ${p.written ? "WROTE" : "(dry)"} ${p.slug}.md`);
  }
  if (report.held.length) { console.log(`\nHELD (${report.held.length}):`); for (const h of report.held) console.log(`  ⏸ [${h.category}] ${h.id} — ${h.reason}`); }
  if (report.rejected.length) { console.log(`\nREJECTED — not a real story / editorial gate (${report.rejected.length}):`); for (const rj of report.rejected) console.log(`  ⊗ [${rj.category}] ${rj.entity} — ${rj.reason}`); }
  if (report.skipped.length) { console.log(`\nSKIPPED — already published / dedup (${report.skipped.length}):`); for (const s of report.skipped) console.log(`  ⊘ [${s.category}] [${s.decision}] ${s.id} — ${s.reason}`); }
  if (report.blocked.length) { console.log(`\nBLOCKED (${report.blocked.length}):`); for (const b of report.blocked) console.log(`  ✗ [${b.category}] [${b.status}] ${b.id} — ${b.reason}`); }
  console.log("");
}
