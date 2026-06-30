// GOSSIP — ORCHESTRATOR (Stages 3→7). Chains the whole flow for ONE topic, fail-closed at every gate:
//   gather receipts → frame (tier × severity) → write → legal-safety gate → assemble (provenance + rumor UI).
// writeImpl/fetchImpl are injectable so the harness runs offline; the defaults do the live work.
//
// Returns one of:
//   { status: "BLOCKED", reason }          — no extractable sources (Stage 3 fail-closed)
//   { status: "HELD", frame }              — frame decided to hold (EXTREME w/o an established outlet)
//   { status: "BLOCKED_LEGAL", blocks }    — the legal-safety gate caught something
//   { status: "PUBLISH", article, frame, provenance }  — ready to assemble + publish
import { gatherBundle } from "./contentFinder.mjs";
import { frameTopic } from "./frame.mjs";
import { writeGossip } from "./writer.mjs";
import { legalGate } from "./legalGate.mjs";
import { qualityCheck } from "./qualityGate.mjs";
import { verifyQuotes } from "./quoteGuard.mjs";
import { GOSSIP_AUTHOR_SLUG, AI_DISCLOSURE, routeBySubject, MONITOR_WINDOW_HOURS } from "./config.gossip.mjs";

export async function runGossip(topic, { writeImpl = writeGossip, fetchImpl, model, corroborate = true } = {}) {
  // Stage 3 — receipts (fail-closed). STEP 4: corroborate=true pulls in MORE outlets' articles about the same
  // rumor so the writer rewrites from a corroborated multi-source bundle, not one thin blurb (fail-safe).
  const bundle = await gatherBundle(topic, { ...(fetchImpl ? { fetchImpl } : {}), corroborate });
  if (!bundle.ok) return { status: "BLOCKED", reason: bundle.reason, stage: "content-finder" };

  // Stage 4 — classify & frame.
  const frame = frameTopic(topic);
  if (frame.decision === "HOLD") return { status: "HELD", frame, stage: "frame", reason: frame.reason };

  // Stage 5+6 — write, then gate. ONE targeted retry on a FIXABLE block (a forgotten attribution / missing
  // disclaimer / too-thin) — feed the writer the exact block so it fixes only that, keeping the facts + voice.
  // NEVER retry a hard-stop (minor/intimate-media/HOLD/fabrication) — those stay blocked.
  let article, gate, quality = { pass: true, issues: [] }, corrections = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    article = await writeImpl({ bundle, frame, topic, model, corrections });
    gate = legalGate(article, frame, topic);
    // deterministic verbatim-quote guard (model-independent): any quoted phrase not in the source is a
    // fabricated/altered quote — the single most common fabrication. Treat as a fixable block → retry.
    if (gate.pass) {
      const qc = verifyQuotes(article, bundle);
      if (!qc.ok) gate = { pass: false, blocks: [`FABRICATED_QUOTE: the quoted phrase(s) ${qc.badQuotes.map((q) => `"${q}"`).join(", ")} are NOT verbatim in the source — use ONLY exact quotes copied from the source, or remove the quotation marks and paraphrase`] };
    }
    quality = gate.pass ? qualityCheck(article) : { pass: false, issues: [] };
    if (gate.pass && quality.pass) break;
    const blocks = [...(gate.blocks || []), ...(!quality.pass ? quality.issues || [] : [])];
    const hardStop = blocks.some((b) => /MINOR_ALLEGATION|INTIMATE_MEDIA|^HOLD|FABRICATION:/i.test(b));
    const fixable = blocks.length > 0 && !hardStop && blocks.every((b) => /MISSING_DISCLAIMER|UNATTRIBUTED_DAMAGING|FABRICATED_QUOTE|< 140|too thin|paragraph|undivided|missing dek|AI-tell/i.test(b));
    if (!fixable || attempt === 2) break;
    corrections = blocks.join("; ");
  }
  if (!gate.pass) return { status: "BLOCKED_LEGAL", blocks: gate.blocks, frame, article, stage: "legal-gate" };
  if (!quality.pass) return { status: "BLOCKED_QUALITY", issues: quality.issues, frame, article, stage: "quality-gate" };

  // Stage 7 — assemble: attach the byline, the rumor-UI fields, and the PROVENANCE the monitor needs.
  article.author = GOSSIP_AUTHOR_SLUG;
  article.aiDisclosure = AI_DISCLOSURE;
  article.rumor = {
    statusLabel: frame.uiLabel,
    whatWeKnow: article.whatWeKnow || [],
    whatWeDont: article.whatWeDont || [],
    denial: article.denial || null,
    developing: frame.monitor,
  };
  const route = routeBySubject(topic.subjectType);
  const provenance = {
    tier: frame.tier,
    severity: frame.severity,
    sensitivity: frame.severity === "NORMAL" ? "normal" : "high",
    attribution: frame.attribution,
    monitor: frame.monitor,
    monitorWindowH: MONITOR_WINDOW_HOURS,
    sources: bundle.sources.map((s) => ({ outlet: s.outlet, url: s.url, tier: s.tier })),
  };
  return { status: "PUBLISH", article, frame, provenance, route, bundle };
}
