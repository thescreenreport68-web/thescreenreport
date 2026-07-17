// GOSSIP — MAKE orchestrator (the consumer half of the FIND→MAKE seam). FIND (`find.mjs`) fills the backlog queue;
// this drains it — or, in the one-shot local/offline path, discovers inline via `gossipFind` — and runs each topic
// through the full single-topic pipeline (gather → editorial gate → frame → write → gates → JUDGE → publish), then
// picks a hero + internal links. Prints a monitoring report. All stage impls are injectable so the harness drives
// it offline; the CLI runs live.
//   FIND→MAKE (cloud drip):  node pipeline/gossip/find.mjs                          # fill the backlog
//                            node pipeline/gossip/gossiprun.mjs --from-find --limit=1   # publish one from it
//   One-shot local:          node pipeline/gossip/gossiprun.mjs --limit=20             # discover + publish inline
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gossipFind, dequeue, enqueue } from "./find.mjs";
import { runGossip } from "./run.mjs";
import { writeGossipArticle } from "./assemble.mjs";
import { detectGossipType, LEDE_ORDER } from "./writer.mjs";
import { loadRecentIndex, isCrossDup } from "./crossDedup.mjs";
import { routeBySubject } from "./config.gossip.mjs";
import { openStore } from "./vecStore.mjs";
import { dedupCheck, recordPublished } from "./dedup.mjs";
import { costReport } from "../lib/openrouter.mjs";
import { meterReport, meterReset } from "./models.mjs";
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

// Lede-rotation counter (fix #3): persisted in data/gossip so consecutive PUBLISHED articles never open the
// same way — the round-robin survives across drip ticks (each tick publishes ~1, committing data/gossip).
const ROT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/gossip/rotation.json");
function readRot() { try { return Number(JSON.parse(fs.readFileSync(ROT_PATH, "utf8")).ledeIndex) || 0; } catch { return 0; } }
function saveRot(n) { try { fs.mkdirSync(path.dirname(ROT_PATH), { recursive: true }); fs.writeFileSync(ROT_PATH, JSON.stringify({ ledeIndex: n }, null, 2) + "\n"); } catch { /* best-effort */ } }

// ── Phase 0 infra: stats ledger + zero-publish streak alarm + REVIEW mode (GOSSIP_MULTI_AGENT_UPGRADE_PLAN §8) ──
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/gossip");
// REVIEW mode: articles land in an artifact-only dir (gitignored) instead of content/articles; nothing deploys.
export const reviewDir = () => (process.env.GOSSIP_REVIEW_DIR ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", process.env.GOSSIP_REVIEW_DIR) : null);

// Per-run stats ledger — cost ÷ PUBLISHED (never ÷ processed) + the per-role meter, one JSON per run.
export function writeRunStats(entry, { dir = path.join(DATA_DIR, "stats") } = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, `run-${String(entry.ts || new Date().toISOString()).replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(fp, JSON.stringify(entry, null, 2) + "\n");
    return fp;
  } catch (e) { console.error("[stats] write failed:", String(e?.message || e).slice(0, 80)); return null; }
}

// Zero-publish STREAK alarm: N consecutive live ticks that ATTEMPTED (processed > 0) but published 0 is the
// silent-expensive failure mode (boxoffice once burned 48h of full-cost zero-publish ticks unnoticed).
export function updateStreak({ published, processed }, { dir = path.join(DATA_DIR, "stats"), threshold = 6 } = {}) {
  const fp = path.join(dir, "streak.json");
  let n = 0;
  try { n = Number(JSON.parse(fs.readFileSync(fp, "utf8")).zeroStreak) || 0; } catch { /* fresh */ }
  if (published > 0) n = 0;
  else if (processed > 0) n++;               // a no-op tick (nothing attempted) neither resets nor increments
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(fp, JSON.stringify({ zeroStreak: n, updatedAt: new Date().toISOString() }, null, 2) + "\n"); } catch { /* best-effort */ }
  if (n >= threshold) console.log(`::warning::gossip zero-publish streak: ${n} consecutive attempted ticks published nothing — check supply/gates (data/gossip/stats/)`);
  return n;
}

export async function gossipRun({
  discoverImpl, categorizeImpl, runImpl = runGossip, writeImpl = writeGossipArticle,
  heroImpl = pickHero, linkIndexImpl = buildLinkIndex, findRelatedImpl = findRelatedLinks, categoryGuardImpl,
  onePerCategory = false, verify = true, judge = true, hero = false, links = false, categoryGuard = false,
  dedup = true, social = true, storeImpl = null, embedImpl, adjudicateImpl,
  limit = 0, fromFind = false, dequeueImpl = dequeue, maxDrain = 10, dryRun = false, nowMs,
} = {}) {
  const now = nowMs ?? Date.now();
  meterReset(); // per-run per-role meter (models.mjs agentChat)
  const REVIEW = reviewDir();
  if (REVIEW) console.log(`[review] GOSSIP_REVIEW_DIR set — articles land in ${REVIEW} (artifact-only, no deploy)`);
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

  // Pre-publish cross-dedup index (ALL lanes' articles from the last 72h) + the lede-rotation counter.
  // The cross-dedup only runs on the live drip (fromFind); inline/offline runs use fixture topics.
  const recentIndex = fromFind ? loadRecentIndex({ now }) : [];
  let rotIdx = readRot();

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
      // Phase 3 — a genuine NEW DEVELOPMENT (adjudicated UPDATE: "dating"→"engaged", "hospitalized"→"released")
      // publishes as a FOLLOW-UP linked to the parent, instead of being silently skipped (a missed real story).
      // Same-event re-tellings stay DUPLICATE-blocked — no second URL for the same moment ever ships.
      if (dd.decision === "UPDATE" && dd.parentKey) {
        t.parentSlug = dd.parentKey;
        t.isUpdate = true;
        t.updateFact = String(dd.reason || "").replace(/^update:\s*/i, "");
      } else if (dd.decision === "DUPLICATE" || dd.decision === "HOLD" || dd.decision === "UPDATE") {
        // Phase 1 waste-kill: a TRANSIENT dedup error (embed/store outage, fail-closed HOLD) used to lose the
        // popped topic forever (pop = claim). Re-queue it once so the next tick retries; a real dup stays dropped.
        if (dd.decision === "HOLD" && /dedup error/i.test(dd.reason || "") && !dryRun && (t.requeueCount || 0) < 1) {
          enqueue([{ ...t, requeueCount: (t.requeueCount || 0) + 1 }], { nowIso: new Date(now).toISOString() });
          report.skipped.push({ id: t.id, category: cat, decision: "REQUEUED", reason: dd.reason });
          continue;
        }
        report.skipped.push({ id: t.id, category: cat, decision: dd.decision, reason: dd.reason, parentKey: dd.parentKey || null });
        continue;
      }
    }
    // Fix #4 — cross-lane 72h fuzzy dup guard (entity+event, not slug equality): never publish the same story twice.
    // (An adjudicated UPDATE follow-up legitimately matches its parent — the smarter verdict wins, skip the guard.)
    if (fromFind && !t.isUpdate) {
      const xdup = isCrossDup(t, recentIndex, { now });
      if (xdup) { report.skipped.push({ id: t.id, category: cat, decision: "CROSS_DUP", reason: `same story as ${xdup.slug} (published in last 72h)` }); continue; }
    }
    const ledeStyle = LEDE_ORDER[rotIdx % LEDE_ORDER.length]; // fix #3 — rotate the lede so no two open alike
    let r;
    try {
      r = await runImpl(t, { verify, judge, ledeStyle, synth: true, headline: true });
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
      // Phase 3 — follow-up link-chain: an UPDATE always links its parent FIRST, by exact title (deterministic).
      if (t.parentSlug) {
        try {
          const pf = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../content/articles", `${t.parentSlug}.md`);
          const raw = fs.readFileSync(pf, "utf8");
          const pTitle = (raw.match(/^title:\s*(?:>-?\s*\n\s*)?['"]?(.+?)['"]?\s*$/m) || [])[1] || t.parentSlug;
          const pCat = (raw.match(/^category:\s*(.+)$/m) || [])[1]?.trim() || "celebrity";
          const chain = { slug: t.parentSlug, title: pTitle, url: `/${pCat}/${t.parentSlug}/` };
          r.article.relatedLinks = [chain, ...(r.article.relatedLinks || []).filter((l) => l.slug !== t.parentSlug)];
        } catch { /* parent file unavailable (e.g. review-only) — chain skipped */ }
      }
      const out = writeImpl({ article: r.article, frame: r.frame, provenance: r.provenance, route: r.route, topic: t, dateISO, dryRun, bundle: r.bundle, ...(REVIEW ? { dir: REVIEW } : {}) });
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
        isUpdate: !!t.isUpdate, parentSlug: t.parentSlug || null,
        headline: r.headline || null, seoSemantic: r.seoSemantic || null,
        seoIssues: (out.seoIssues || []).map((i) => `${i.code}:${i.action}`),
      });
      rotIdx++; // advance the lede rotation ONLY on an actual publish, so consecutive live articles differ
    } else if (r.status === "HELD") {
      // Phase 1 waste-kill: a frame-HOLD (EXTREME class awaiting an established outlet) already paid for
      // gather + editorial — re-queue it ONCE (waitingForMajor) so it publishes when a major picks it up,
      // instead of losing the story forever. A second HOLD drops it for real (3-strikes-lite).
      if (r.stage === "frame" && !dryRun && (t.requeueCount || 0) < 1) {
        enqueue([{ ...t, requeueCount: (t.requeueCount || 0) + 1, waitingForMajor: true }], { nowIso: new Date(now).toISOString() });
        report.held.push({ id: t.id, category: cat, reason: r.reason, requeued: true });
      } else report.held.push({ id: t.id, category: cat, reason: r.reason });
    } else if (r.status === "REJECTED_THIN") {
      // editorial gate: not a real/substantive story (a bare social post / photo / non-story) — never written.
      report.rejected.push({ id: t.id, category: cat, entity: t.primaryEntity, title: t.title, reason: r.reason });
    } else {
      const reason = (r.blocks || r.issues || [r.reason]).join ? (r.blocks || r.issues || [r.reason]).join(" | ") : r.reason;
      report.blocked.push({ id: t.id, category: cat, status: r.status, reason, autoScore: r.auto?.score ?? null });
    }
  }
  if (!dryRun) saveRot(rotIdx); // persist the lede rotation for the next drip tick
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
  // Stats ledger + streak alarm (skip both for dry runs; review runs ARE logged, marked review:true).
  if (!dryRun) {
    try {
      report.review = !!REVIEW;
      const cr = costReport();
      const statsDir = process.env.GOSSIP_STATS_DIR ? path.resolve(process.env.GOSSIP_STATS_DIR) : undefined;
      writeRunStats({
        ts: new Date(now).toISOString(), mode: report.mode, review: !!REVIEW,
        published: report.published.map((p) => p.slug), topics: report.topics,
        held: report.held.length, rejected: report.rejected.length, skipped: report.skipped.length, blocked: report.blocked.length,
        costUSD: Number(cr.total.toFixed(6)), costPerPublished: report.published.length ? Number((cr.total / report.published.length).toFixed(6)) : null,
        byModel: cr.byModel, byRole: meterReport(),
      }, statsDir ? { dir: statsDir } : {});
      if (!REVIEW) updateStreak({ published: report.published.length, processed: report.topics }, statsDir ? { dir: statsDir } : {});
    } catch (e) { console.error("[stats] failed:", String(e?.message || e).slice(0, 80)); }
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
