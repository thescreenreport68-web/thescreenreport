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
import { GOSSIP_AUTHOR_SLUG, AI_DISCLOSURE, routeBySubject, MONITOR_WINDOW_HOURS } from "./config.gossip.mjs";

export async function runGossip(topic, { writeImpl = writeGossip, fetchImpl, model } = {}) {
  // Stage 3 — receipts (fail-closed).
  const bundle = await gatherBundle(topic, fetchImpl ? { fetchImpl } : {});
  if (!bundle.ok) return { status: "BLOCKED", reason: bundle.reason, stage: "content-finder" };

  // Stage 4 — classify & frame.
  const frame = frameTopic(topic);
  if (frame.decision === "HOLD") return { status: "HELD", frame, stage: "frame", reason: frame.reason };

  // Stage 5 — write from the verified bundle.
  const article = await writeImpl({ bundle, frame, topic, model });

  // Stage 6 — legal-safety gate (fail-closed). (The quality/readability gate is wired separately at integration.)
  const gate = legalGate(article, frame, topic);
  if (!gate.pass) return { status: "BLOCKED_LEGAL", blocks: gate.blocks, frame, article, stage: "legal-gate" };

  // Stage 6b — quality gate (lean; keeps the piece a real, tight article — runs only after it's legally safe).
  const quality = qualityCheck(article);
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
  return { status: "PUBLISH", article, frame, provenance, route };
}
