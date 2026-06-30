// STEP 2 — DEDUP GATE test. Real embeddings (semantic separation), mocked adjudicator + store, covering every
// decision path: exact dup, reworded dup, distinct, update, fail-closed HOLD, and the end-to-end skip.
// Run: node pipeline/gossip/test/dedup-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { embed } from "../embed.mjs";
import { openStore } from "../vecStore.mjs";
import { dedupCheck, recordPublished, urlHash, eventKey } from "../dedup.mjs";
import { gossipRun } from "../gossiprun.mjs";

let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== STEP 2 DEDUP GATE TEST ===\n");

const A = { primaryEntity: "Selena Gomez", subjectType: "celebrity", title: "Selena Gomez sparks engagement rumors with a new ring", claim: "Selena Gomez is engaged", slug: "selena-engaged-1", sources: [{ outlet: "People", url: "https://people.com/selena-engaged" }] };
const Areworded = { primaryEntity: "Selena Gomez", subjectType: "celebrity", title: "Selena Gomez spotted with an engagement ring, fueling wedding talk", claim: "Selena Gomez engagement ring sighting", slug: "selena-engaged-2", sources: [{ outlet: "Page Six", url: "https://pagesix.com/selena-ring" }] };
const Bdifferent = { primaryEntity: "Selena Gomez", subjectType: "celebrity", title: "Selena Gomez announces a brand new studio album", claim: "Selena Gomez new album", slug: "selena-album", sources: [{ outlet: "Billboard", url: "https://billboard.com/selena-album" }] };
for (const t of [A, Areworded, Bdifferent]) t.id = t.slug;

const dupAdj = async () => ({ verdict: "DUPLICATE", newFact: "" });
const updateAdj = async () => ({ verdict: "UPDATE", newFact: "the engagement is now confirmed" });
const NOW = new Date("2026-06-30T12:00:00Z");

// seed: publish A
{
  const store = openStore(path.join(os.tmpdir(), "dd-" + Date.now() + "-seed.json"));
  const d0 = await dedupCheck(A, store, { adjudicateImpl: dupAdj, now: NOW });
  check("first sighting of A → NEW", d0.decision === "NEW", d0.decision);
  recordPublished(A, store, { urlHash: d0.urlHash, eventKey: d0.eventKey, embedding: d0.embedding, slug: A.slug, now: NOW });

  // L1 exact dup
  const d1 = await dedupCheck(A, store, { adjudicateImpl: dupAdj, now: NOW });
  check("exact same article → DUPLICATE (L1)", d1.decision === "DUPLICATE" && /exact/.test(d1.reason), JSON.stringify(d1));

  // reworded same story → DUPLICATE (semantic soft-band + adjudicator says DUPLICATE)
  const d2 = await dedupCheck(Areworded, store, { adjudicateImpl: dupAdj, now: NOW });
  check("reworded same story → DUPLICATE (semantic)", d2.decision === "DUPLICATE", JSON.stringify({ d: d2.decision, r: d2.reason }));

  // genuinely different story about the same entity → NEW
  const d3 = await dedupCheck(Bdifferent, store, { adjudicateImpl: dupAdj, now: NOW });
  check("different story, same entity → NEW", d3.decision === "NEW", JSON.stringify({ d: d3.decision, r: d3.reason }));

  // a genuine new development → UPDATE (publishes, linked)
  const d4 = await dedupCheck(Areworded, store, { adjudicateImpl: updateAdj, now: NOW });
  check("new development on a known story → UPDATE", d4.decision === "UPDATE" && d4.parentKey === A.slug, JSON.stringify({ d: d4.decision, p: d4.parentKey }));
}

// fail-closed: any embed error → HOLD (never risk a reworded republish)
{
  const store = openStore(path.join(os.tmpdir(), "dd-" + Date.now() + "-fc.json"));
  const broken = async () => { throw new Error("embed down"); };
  const d = await dedupCheck(Bdifferent, store, { embedImpl: broken, now: NOW });
  check("embed failure → HOLD (fail-closed)", d.decision === "HOLD", JSON.stringify(d));
}

// end-to-end: orchestrator skips the reworded duplicate within one run
{
  const store = openStore(path.join(os.tmpdir(), "dd-" + Date.now() + "-e2e.json"));
  const runImpl = async (t) => ({ status: "PUBLISH", article: { title: t.title }, frame: { uiLabel: "Reported by People", tier: "REPORTED_BY_MAJOR", severity: "NORMAL", monitor: false }, provenance: { sensitivity: "normal", sources: t.sources }, route: { category: "celebrity", subcategory: "news" }, bundle: { sources: t.sources } });
  let wrote = 0;
  const writeImpl = ({ topic }) => { wrote++; return { slug: topic.slug, written: false }; };
  const report = await gossipRun({ discoverImpl: async () => [], categorizeImpl: async () => [A, Areworded], runImpl, writeImpl, judge: false, dedup: true, storeImpl: store, adjudicateImpl: dupAdj, nowMs: NOW.getTime() });
  check("orchestrator publishes A only (the non-duplicate)", report.published.length === 1 && report.published[0].id === A.id, `published=${report.published.length}`);
  check("orchestrator SKIPS the reworded duplicate", report.skipped.length === 1 && report.skipped[0].decision === "DUPLICATE", JSON.stringify(report.skipped));
  check("only the non-duplicate was written", wrote === 1, `wrote=${wrote}`);
}

// deterministic keys are stable
check("urlHash is stable + deterministic", urlHash(A) === urlHash(A) && urlHash(A) !== urlHash(Bdifferent));
check("eventKey is deterministic + well-formed (entity|type|month)", eventKey(A, NOW) === eventKey(A, NOW) && eventKey(A, NOW).startsWith("selena-gomez|") && eventKey(A, NOW).endsWith("|2026-06"));

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) process.exit(1);
console.log("Step 2 dedup gate green. ✅\n");
