// GOSSIP — TOP ORCHESTRATOR (the whole pipeline for one run). discover -> categorize -> [per topic]
// gather -> frame -> write -> legal+quality gate -> publish -> JUDGE (score). Prints a monitoring report. All
// stage impls are injectable so the harness drives it offline; the CLI runs it live.
//   Live run (one article per category): cd site-gossip && set -a; . "/Users/sivajithcu/Movie News site/.env"; set +a; node pipeline/gossip/gossiprun.mjs --one-per-category [--dry-run]
import { discoverGossip } from "./discover.mjs";
import { discoverSocial } from "./discoverSocial.mjs";
import { categorizeGossip } from "./categorize.mjs";
import { runGossip } from "./run.mjs";
import { writeGossipArticle } from "./assemble.mjs";
import { detectGossipType } from "./writer.mjs";
import { routeBySubject } from "./config.gossip.mjs";
import { openStore } from "./vecStore.mjs";
import { dedupCheck, recordPublished } from "./dedup.mjs";
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

export async function gossipRun({ discoverImpl, categorizeImpl, runImpl = runGossip, writeImpl = writeGossipArticle, heroImpl = pickHero, linkIndexImpl = buildLinkIndex, findRelatedImpl = findRelatedLinks, onePerCategory = false, verify = true, judge = true, hero = false, links = false, dedup = true, social = true, storeImpl = null, embedImpl, adjudicateImpl, limit = 0, dryRun = false, nowMs } = {}) {
  // Discovery = trade RSS (confirmed news) + SOCIAL (the speculation lane). Social signals are discovery tips
  // only; categorize scope-filters them and the dedup/content-finder/verify stages establish every fact.
  const rss = discoverImpl ? await discoverImpl() : await discoverGossip();
  const soc = discoverImpl ? [] : (social ? await discoverSocial() : []);
  const candidates = [...rss, ...soc];
  // Shortlist for the categorize LLM (cost control). RESERVE ~40% for SOCIAL so the speculation lane (which RSS
  // can't see) actually reaches categorize instead of being crowded out by the much larger RSS set. The social
  // feed is noisy (Pop Crave posts sports/anniversaries too); categorize's scope filter drops the off-niche ones.
  const SHORT = 26, socN = Math.min(soc.length, Math.round(SHORT * 0.4));
  const shortlist = [...rss.slice(0, SHORT - socN), ...soc.slice(0, socN)];
  const all = categorizeImpl ? await categorizeImpl(candidates) : await categorizeGossip(shortlist);
  let topics = onePerCategory ? onePerCategoryPick(all) : all;
  if (limit) topics = topics.slice(0, limit);
  const now = nowMs ?? Date.now();
  const store = dedup ? (storeImpl || openStore()) : null;
  // STEP 7 — build the internal-link index ONCE over the real published corpus (off by default offline; CLI on).
  let linkIndex = null;
  if (links) { try { linkIndex = await linkIndexImpl(); } catch { linkIndex = null; } }
  const report = { candidates: candidates.length, inScope: all.length, topics: topics.length, published: [], held: [], blocked: [], skipped: [] };

  for (let i = 0; i < topics.length; i++) {
    const t = topics[i];
    const dateISO = new Date(now - i * 60000).toISOString();
    const cat = routeBySubject(t.subjectType).category;
    // STEP 2 — DEDUP at the FRONT, before any content-find/write spend. Never republish a story (even reworded).
    let dd = null;
    if (dedup && store) {
      dd = await dedupCheck(t, store, { embedImpl, adjudicateImpl, now: new Date(now) });
      if (dd.decision === "DUPLICATE" || dd.decision === "HOLD") {
        report.skipped.push({ id: t.id, category: cat, decision: dd.decision, reason: dd.reason, parentKey: dd.parentKey || null });
        continue;
      }
    }
    let r;
    try {
      // The whole single-topic quality loop (write → gates → surgical self-correct → JUDGE backstop → re-judge)
      // lives in runGossip now, so it can hand the judge's findings back to the writer. We just consume its verdict.
      r = await runImpl(t, { verify, judge });
    } catch (e) {
      report.blocked.push({ id: t.id, category: cat, status: "ERROR", reason: String(e?.message || e).slice(0, 140) });
      continue;
    }
    if (r.status === "PUBLISH") {
      const auto = r.auto || null; // judge already ran inside runGossip as the backstop gate
      // STEP 6 — pick a powerful, story-specific, LEGAL hero (TMDB still / receipt embed; never paparazzi).
      // Off by default so offline tests never hit the network; the live CLI sets hero:true. Fail-safe → no hero.
      if (hero) { try { r.article.hero = await heroImpl({ topic: { ...t, gossipType: detectGossipType(t) }, article: r.article, bundle: r.bundle, frame: r.frame }); } catch { r.article.hero = null; } }
      // STEP 7 — internal links to REAL related published articles (shared-entity gate + contradiction firewall).
      if (links && linkIndex) { try { r.article.relatedLinks = await findRelatedImpl({ article: r.article, topic: t, index: linkIndex, selfSlug: t.slug }); } catch { r.article.relatedLinks = []; } }
      const out = writeImpl({ article: r.article, frame: r.frame, provenance: r.provenance, route: r.route, topic: t, dateISO, dryRun });
      // record it in the dedup store so future runs (incl. the wider social net) won't re-publish it.
      if (dedup && store && dd) recordPublished(t, store, { urlHash: dd.urlHash, eventKey: dd.eventKey, embedding: dd.embedding, slug: out.slug, parentKey: dd.parentKey, now: new Date(now) });
      report.published.push({
        id: t.id, category: cat, slug: out.slug, entity: t.primaryEntity, title: r.article.title,
        gossipType: detectGossipType(t), tier: r.frame.tier, severity: r.frame.severity, label: r.frame.uiLabel,
        update: dd?.decision === "UPDATE" || false,
        autoScore: auto?.score ?? null, subscores: auto?.subscores ?? null, autoIssues: auto?.issues ?? [],
        hero: r.article.hero ? { source: r.article.hero.source, kind: r.article.hero.kind, score: r.article.hero.score, embed: r.article.hero.embed?.platform || null } : null,
        corroboration: r.provenance?.corroborationCount ?? null,
        verifyDegraded: !!r.provenance?.verifyDegraded,
        relatedLinks: (r.article.relatedLinks || []).map((l) => l.slug),
        sources: (r.bundle?.sources || []).map((s) => `${s.outlet}/${s.tier}`), written: out.written, path: out.path,
      });
    } else if (r.status === "HELD") {
      report.held.push({ id: t.id, category: cat, reason: r.reason });
    } else {
      const reason = (r.blocks || r.issues || [r.reason]).join ? (r.blocks || r.issues || [r.reason]).join(" | ") : r.reason;
      report.blocked.push({ id: t.id, category: cat, status: r.status, reason, autoScore: r.auto?.score ?? null });
    }
  }
  return report;
}

// CLI
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dryRun = process.argv.includes("--dry-run");
  const onePerCategory = process.argv.includes("--one-per-category");
  const noHero = process.argv.includes("--no-hero"); // hero picker hits TMDB + a cheap vision call; on by default live
  const noLinks = process.argv.includes("--no-links"); // internal links embed the corpus + a cheap firewall call/link
  const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 0;
  const report = await gossipRun({ dryRun, onePerCategory, limit, hero: !noHero, links: !noLinks });
  console.log(`\n${"━".repeat(60)}\n GOSSIP AUTOMATION — RUN REPORT\n${"━".repeat(60)}`);
  console.log(`DISCOVER: ${report.candidates} candidates  →  CATEGORIZE: ${report.inScope} in-scope  →  SELECTED: ${report.topics}`);
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
  if (report.skipped.length) { console.log(`\nSKIPPED — already published / dedup (${report.skipped.length}):`); for (const s of report.skipped) console.log(`  ⊘ [${s.category}] [${s.decision}] ${s.id} — ${s.reason}`); }
  if (report.blocked.length) { console.log(`\nBLOCKED (${report.blocked.length}):`); for (const b of report.blocked) console.log(`  ✗ [${b.category}] [${b.status}] ${b.id} — ${b.reason}`); }
  console.log("");
}
