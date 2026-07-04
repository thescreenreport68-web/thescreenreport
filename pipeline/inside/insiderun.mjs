// INSIDE-STORIES orchestrator (REV 2 — audience reaction & discourse). One run: discover top stories
// (TMDB trending + Reddit discourse) → angles (which of the 4 forms) → per angle: dedup → HARVEST
// (real anchor posts; verbatim wall) → write (imagination on, facts locked) → gate (fact-locks +
// engagement judge) → cut hard-fact strays → webVerify LAST → polish → BEST-RELEVANCE image
// (mandatory featured image, else HOLD) → assemble → record.
// Run: cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; node site/pipeline/inside/insiderun.mjs [--dry-run] [--limit=N] [--event=<storySlug>] [--no-hero]
import fs from "node:fs";
import path from "node:path";
import { MODELS, ACCEPT_FLOOR, MAX_ATTEMPTS, GATE, DATA_DIR } from "./config.inside.mjs";
import { loadTriggers } from "./trigger.mjs";
import { proposeAngles } from "./angles.mjs";
import { harvestReactions, factBlockText, norm } from "./reactionFinder.mjs";
import { generateInside } from "./writer.mjs";
import { gateInside, classifyInsideBlocks } from "./gate.mjs";
import { writeInsideArticle } from "./assemble.mjs";
import { loadStore, alreadyPublished, recordInsidePublished, parkAngle, parkedTries, clearParked } from "./store.mjs";
import { pickInsideImage } from "./imagePicker.mjs";
import { cutArticle } from "../lib/cutter.mjs";
import { webVerifyArticle } from "../lib/webVerify.mjs";
import { dedupeSentences, trimIncomplete } from "../lib/polish.mjs";
import { measureRemote } from "../stages/image.mjs";
import { costReport } from "../lib/openrouter.mjs";

const WEB_VERIFY = process.env.WEB_VERIFY !== "0";

// WATCHDOG — Node fetch has NO default timeout, so any stray un-timeboxed request (a slow outlet
// page, a stalled syndication call) would freeze an unattended run forever (live-proven: run #3
// hung 38 min on one ESTABLISHED socket). Every stage is raced against a hard deadline; a timeout
// throws, the per-angle catch records it, and the run MOVES ON. Nothing hangs the lane.
const withTimeout = (p, ms, label) => {
  let timer;
  return Promise.race([
    p,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`watchdog: ${label} exceeded ${Math.round(ms / 1000)}s`)), ms); timer.unref?.(); }),
  ]).finally(() => clearTimeout(timer));
};
const T = { triggers: 90e3, angles: 60e3, harvest: 180e3, generate: 240e3, gate: 180e3, webVerify: 120e3, hero: 120e3 };

export async function insideRun({
  loadTriggersImpl = loadTriggers,
  proposeAnglesImpl = proposeAngles,
  harvestImpl = harvestReactions,
  generateImpl = generateInside,
  gateImpl = gateInside,
  writeImpl = writeInsideArticle,
  imagePickImpl = pickInsideImage,
  measureImpl = measureRemote,
  webVerifyImpl = webVerifyArticle,
  storeImpl = null,
  hero = true,
  webVerify = WEB_VERIFY,
  dryRun = false,
  limit = 0,
  onlyEvent = null,
  nowMs = null,
  // Inter-harvest pacing (ms). The free keyless discovery/extraction tier is per-minute
  // rate-limited; firing many harvests back-to-back trips it and starves the run. A gap between
  // harvests keeps the automation under the limit — the pacing a cron with a burst of triggers
  // needs too. 0 = off (tests / paid tier); set via INSIDE_PACE_MS for free-tier laptop runs.
  paceMs = Number(process.env.INSIDE_PACE_MS) || 0,
} = {}) {
  const now = nowMs ?? Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = storeImpl || loadStore();
  const report = { triggers: 0, angles: 0, published: [], held: [], rejected: [], skipped: [], blocked: [] };

  let triggers = await withTimeout(loadTriggersImpl({ nowMs: now }), T.triggers, "triggers");
  if (onlyEvent) triggers = triggers.filter((t) => t.parentEventSlug === onlyEvent);
  report.triggers = triggers.length;

  let written = 0;
  for (const trigger of triggers) {
    if (limit && written >= limit) break;
    console.log(`\n■ ${trigger.parentEventSlug} (${trigger.eventType}, ${trigger.via}, priority ${trigger.priority})`);
    let angles = [];
    try { angles = await withTimeout(proposeAnglesImpl(trigger), T.angles, "angles"); } catch (e) {
      report.blocked.push({ event: trigger.parentEventSlug, stage: "angles", reason: String(e?.message || e).slice(0, 140) });
      continue;
    }
    report.angles += angles.length;

    for (let ai = 0; ai < angles.length; ai++) {
      const angle = angles[ai];
      if (limit && written >= limit) break;
      const tag = `${trigger.parentEventSlug}×${angle.form}`;
      try {
        // Cross-run dedup: one article per event×form, forever (the never-repost rule).
        if (alreadyPublished(store, trigger.parentEventSlug, angle.form)) {
          report.skipped.push({ tag, reason: "already published" }); continue;
        }
        if (parkedTries(store, trigger.parentEventSlug, angle.form) === Infinity) {
          report.skipped.push({ tag, reason: "parked dead (ripple never materialized)" }); continue;
        }

        // HARVEST — the grounding gate. Pace before it so the free tier's per-minute budget
        // refills between harvests (skip the very first).
        if (paceMs && (report.published.length || report.rejected.length || report.held.length || report.blocked.length)) await sleep(paceMs);
        console.log(`  ▸ ${angle.form}: harvesting…`);
        const h = await withTimeout(harvestImpl(trigger, angle), T.harvest, `harvest ${tag}`);
        if (!h.ok) {
          // Only a GENUINE thin harvest (real sources fetched, too few voices) counts toward
          // parking the angle dead. "no material" = the finder returned nothing, which on the free
          // tier is usually a transient rate-limit, NOT proof the ripple doesn't exist — parking on
          // it would permanently kill real events after a throttle blip. Those just retry next run.
          const genuineThin = /^under floor/.test(h.reason || "");
          const tries = (dryRun || !genuineThin) ? 0 : parkAngle(store, trigger.parentEventSlug, angle.form, h.reason);
          report.rejected.push({ tag, stage: "harvest", reason: `${h.reason}${genuineThin ? ` (try ${tries})` : " (transient — not parked)"}` });
          console.log(`    ✗ ${h.reason}`);
          continue;
        }
        console.log(`    ✓ ${h.factBlock.stats.namedVoices} named quotes, ${h.factBlock.stats.fanPosts} audience posts, ${h.factBlock.tweetIds.length} embeds`);
        const factText = factBlockText(h.factBlock, trigger);

        // WRITE → GATE loop (news semantics: clean pass ≥80-equivalent = publishMin+no blocks;
        // final-attempt terminal accept at ACCEPT_FLOOR when only cut-type blocks remain).
        let article = null, scored = null, pass = false, acceptReason = null;
        let corrections = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          console.log(`    attempt ${attempt}: writing…`);
          ({ article } = await withTimeout(generateImpl({ trigger, angle, factBlock: h.factBlock, factText, corrections, previousArticle: attempt > 1 ? article : null }), T.generate, `generate ${tag}`));
          if (!article?.body) { corrections = "- Return the COMPLETE JSON article."; continue; }
          scored = await withTimeout(gateImpl({ article, trigger, angle, factBlock: h.factBlock }), T.gate, `gate ${tag}`);
          console.log(`    gate: score ${scored.score}, blocks ${scored.hardBlocks.length}, cuts ${scored.cutClaims.length}`);
          if (scored.pass) { pass = true; break; }
          if (scored.cutClaims.length && !dryRun) {
            cutArticle(article, scored.cutClaims);
            scored = await withTimeout(gateImpl({ article, trigger, angle, factBlock: h.factBlock }), T.gate, `re-gate ${tag}`);
            if (scored.pass) { pass = true; break; }
          }
          // Terminal accept decides on the CURRENT (post-cut) blocks — a stale pre-cut list here
          // would let a hard stop slip through as "cut-only" — and never publishes with claims
          // the verify chain flagged and hasn't cut yet.
          let { block, fixable } = classifyInsideBlocks(scored.hardBlocks);
          if (attempt === MAX_ATTEMPTS && block.length === 0 && (scored.score || 0) >= ACCEPT_FLOOR) {
            if (scored.cutClaims.length && !dryRun) {
              cutArticle(article, scored.cutClaims);
              scored = await gateImpl({ article, trigger, angle, factBlock: h.factBlock });
              ({ block, fixable } = classifyInsideBlocks(scored.hardBlocks));
            }
            if (block.length === 0 && scored.cutClaims.length === 0 && (scored.score || 0) >= ACCEPT_FLOOR) {
              pass = true; acceptReason = `terminal-accept: verified accurate, score ${scored.score} >= ${ACCEPT_FLOOR}`;
              break;
            }
          }
          corrections = [...block, ...fixable, ...(scored.weaknesses || [])].slice(0, 6).map((b) => `- ${b}`).join("\n");
        }
        if (!pass) {
          report.held.push({ tag, reason: scored?.hardBlocks?.join(" | ") || `score ${scored?.score} < ${GATE.publishMin}`, score: scored?.score });
          continue;
        }

        // webVerify — ALWAYS the last content gate on every publish path. After a web-cut the
        // article must re-clear the gate FULLY (residual hard blocks or uncut flagged claims =
        // hold), mirroring the news lane's re-gate guard.
        if (webVerify && !dryRun) {
          console.log(`    web-verify…`);
          const wv = await withTimeout(webVerifyImpl({ article, topic: { primaryEntity: trigger.primaryEntity, title: trigger.parentTitle, eventType: trigger.eventType } }), T.webVerify, `webVerify ${tag}`).catch(() => ({ ran: false, ok: true, contradictions: [] }));
          if (wv.contradictions?.length) {
            cutArticle(article, wv.contradictions.map((c) => c.claim));
            let rescore = await withTimeout(gateImpl({ article, trigger, angle, factBlock: h.factBlock }), T.gate, `web-re-gate ${tag}`);
            if (rescore.cutClaims.length) {
              cutArticle(article, rescore.cutClaims);
              rescore = await withTimeout(gateImpl({ article, trigger, angle, factBlock: h.factBlock }), T.gate, `web-re-gate-2 ${tag}`);
            }
            const reBlock = classifyInsideBlocks(rescore.hardBlocks || []).block;
            if (reBlock.length || rescore.cutClaims.length || (rescore.score || 0) < ACCEPT_FLOOR) {
              report.held.push({ tag, reason: reBlock.length ? `re-gate after web-cut: ${reBlock.slice(0, 2).join("; ")}` : `web-verify cut gutted the article (${wv.contradictions.length} contradictions)`, score: rescore.score });
              continue;
            }
            scored = rescore;
          }
        }

        article.body = trimIncomplete(dedupeSentences(article.body));

        // FEATURED IMAGE — mandatory (owner). Best-relevance picker; no ≥1200px match = HOLD.
        let image = null;
        if (hero && !dryRun) {
          console.log(`    featured image…`);
          image = await withTimeout(imagePickImpl({ trigger, angle, article, bundle: h.bundle, measureImpl }), T.hero, `image ${tag}`).catch(() => null);
          if (!image) { report.held.push({ tag, reason: "no >=1200px relevant featured image found" }); continue; }
        }

        const dateISO = new Date(now - written * 60000).toISOString(); // 1-min stagger (news pattern)
        const out = writeImpl({ article, trigger, angle, factBlock: h.factBlock, image, dateISO, dryRun });
        written++;
        if (!dryRun) {
          clearParked(store, trigger.parentEventSlug, angle.form);
          recordInsidePublished(store, {
            parentEventSlug: trigger.parentEventSlug, form: angle.form, slug: out.slug,
            title: article.title, primaryEntity: trigger.primaryEntity, eventType: trigger.eventType,
            // Full harvest fingerprint (not just the curated cards) — the monitor's top-up dedups
            // against this so already-seen voices never re-append as fake "new" updates.
            harvestQuoteKeys: [...h.factBlock.reactions, ...h.factBlock.aggregateFans].map((r) => norm(r.quote).slice(0, 90)),
            angle: { form: angle.form, angle: angle.angle, workingTitle: angle.workingTitle, focusEntity: angle.focusEntity, searchQueries: angle.searchQueries },
            trigger: { parentEventSlug: trigger.parentEventSlug, parentSlug: trigger.parentSlug, parentTitle: trigger.parentTitle, primaryEntity: trigger.primaryEntity, eventType: trigger.eventType, tmdbType: trigger.tmdbType, subjectKind: trigger.subjectKind, priority: trigger.priority, work: trigger.work || null, sources: trigger.sources || [], redditPosts: trigger.redditPosts || [] },
          });
        }
        report.published.push({ tag, slug: out.slug, score: scored.score, ...(acceptReason ? { acceptReason } : {}), voices: h.factBlock.stats.namedVoices, fans: h.factBlock.stats.fanPosts });
      } catch (e) {
        console.log(`    ⛔ ${String(e?.message || e).slice(0, 110)}`);
        report.blocked.push({ tag, reason: String(e?.message || e).slice(0, 140) });
      }
    }
  }
  return report;
}

// CLI
if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];
  const dryRun = process.argv.includes("--dry-run");
  const report = await insideRun({
    dryRun,
    hero: !process.argv.includes("--no-hero"),
    limit: Number(arg("limit")) || 0,
    onlyEvent: arg("event") || null,
  });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "last-run.json"), JSON.stringify(report, null, 1));
  const line = (x) => `  ${x.tag || x.event || ""} — ${x.reason || x.slug || ""}${x.score != null ? ` (score ${x.score})` : ""}`;
  console.log(`\n━━ INSIDE RUN ━━ triggers ${report.triggers} · angles ${report.angles}${dryRun ? " · DRY" : ""}`);
  console.log(`PUBLISHED ${report.published.length}`); report.published.forEach((p) => console.log(line(p)));
  console.log(`HELD ${report.held.length}`); report.held.forEach((p) => console.log(line(p)));
  console.log(`REJECTED ${report.rejected.length}`); report.rejected.forEach((p) => console.log(line(p)));
  console.log(`SKIPPED ${report.skipped.length}`); report.skipped.forEach((p) => console.log(line(p)));
  console.log(`BLOCKED ${report.blocked.length}`); report.blocked.forEach((p) => console.log(line(p)));
  const c = costReport();
  console.log(`cost: $${c.total.toFixed(4)} over ${c.calls} calls`);
}
