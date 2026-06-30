// GOSSIP — ORCHESTRATOR (Stages 3→7, the full single-topic quality loop). Fail-closed at every gate:
//   gather receipts → frame → WRITE → [legal + verbatim-quote + quality + claim-verify gates] → the writer
//   SURGICALLY SELF-CORRECTS the flagged spots (not a rewrite) → [JUDGE backstop] → one more surgical fix if the
//   judge caught something the writer missed → re-judge → assemble (provenance + rumor UI).
// The owner's design: the WRITER finds + fixes its own mistakes FIRST (verify gate tells it exactly what's wrong,
// it patches only those, keeping the good prose); the JUDGE is the BACKUP that catches what slipped through and
// sends it back for one more surgical pass. A full rewrite happens ONLY when a draft is broken top-to-bottom.
// writeImpl/fetchImpl/verifyImpl/judgeImpl are injectable so the harness runs offline; the defaults do live work.
//
// Returns one of:
//   { status: "BLOCKED", reason }            — no extractable sources (Stage 3 fail-closed)
//   { status: "HELD", frame }                — frame decided to hold (EXTREME w/o an established outlet)
//   { status: "BLOCKED_LEGAL", blocks }      — legal-safety / verbatim-quote gate caught something (after fixes)
//   { status: "BLOCKED_QUALITY", issues }    — quality gate still failing after fixes
//   { status: "BLOCKED_VERIFY", issues }     — unsupported factual claims the writer couldn't fix
//   { status: "BLOCKED_JUDGE", auto }        — judge backstop still flags a safety/fabrication problem
//   { status: "PUBLISH", article, frame, provenance, auto, bundle }  — ready to assemble + publish
import { gatherBundle } from "./contentFinder.mjs";
import { frameTopic } from "./frame.mjs";
import { writeGossip } from "./writer.mjs";
import { legalGate } from "./legalGate.mjs";
import { qualityCheck } from "./qualityGate.mjs";
import { verifyQuotes } from "./quoteGuard.mjs";
import { verifyGate } from "./verifyGate.mjs";
import { judgeGossip } from "./judge.mjs";
import { GOSSIP_AUTHOR_SLUG, AI_DISCLOSURE, routeBySubject, MONITOR_WINDOW_HOURS } from "./config.gossip.mjs";

const HARD_STOP = /MINOR_ALLEGATION|INTIMATE_MEDIA|^HOLD|FABRICATION:/i;

// Run EVERY gate over one draft and collect a single actionable issue list the writer can surgically fix.
function inspect(article, frame, topic, bundle, verifyResult) {
  const legal = legalGate(article, frame, topic);
  const issues = [];
  let hardStop = false;
  for (const b of legal.blocks || []) { issues.push(b); if (HARD_STOP.test(b)) hardStop = true; }
  const qc = verifyQuotes(article, bundle);
  if (!qc.ok) for (const q of qc.badQuotes) issues.push(`FABRICATED_QUOTE: the quoted phrase "${q}" is NOT verbatim in any source — use the exact source words or drop the quotation marks and paraphrase`);
  const quality = qualityCheck(article);
  if (!quality.pass) for (const q of quality.issues || []) issues.push(q);
  if (verifyResult && !verifyResult.ok) for (const u of verifyResult.unsupported) issues.push(`UNSUPPORTED_CLAIM: "${(u.claim || "").slice(0, 160)}" — ${u.why}${u.contradicted ? " (the bundle CONTRADICTS this — cut or correct it)" : ""}`);
  return {
    issues, hardStop,
    legalPass: legal.pass, legalBlocks: legal.blocks || [],
    quoteOk: qc.ok, quoteBlocks: qc.ok ? [] : qc.badQuotes.map((q) => `FABRICATED_QUOTE: "${q}"`),
    qualityPass: quality.pass, qualityIssues: quality.issues || [],
    verifyOk: !verifyResult || verifyResult.ok,
    allPass: legal.pass && qc.ok && quality.pass && (!verifyResult || verifyResult.ok),
  };
}

// GUARD CALIBRATION (owner directive, starting-point phase). The judge must STILL catch false claims / fabrications
// — that's non-negotiable — but it must NOT block a publishable gossip piece for CRAFT (a bit formal / dry voice /
// structure). So the judge blocks ONLY on:
//   (a) fabFlag — it flagged a fabricated/unsupported claim (the accuracy guard; ALWAYS blocks), or
//   (b) a GENUINELY low safety score (< JUDGE_SAFETY_FLOOR) — a real accuracy/safety problem, not a borderline
//       craft dock (the old floor of 8 was blocking accurate-but-plain articles at safety 6-7).
//   (c) a degraded verify (L2 errored) AND no judge safety read — no accuracy backstop at all ⇒ block.
// The deterministic legal + verbatim-quote + claim-verify gates still run UPSTREAM; this is only the judge's
// numeric backstop. We raise this floor again once we have an audience (owner: "upgrade the guard later").
const JUDGE_SAFETY_FLOOR = 5;
function judgeFlags(auto, { verifyDegraded = false } = {}) {
  const safety = auto?.subscores?.safety;
  const issuesText = (auto?.issues || []).join(" ");
  // Catch the judge's FALSE-CLAIM / accuracy notes in any phrasing it uses (it reliably DESCRIBES the error even
  // when it scores safety generously) — fabrication, "not in the bundle", a wrong/invented date or outlet, a
  // misattribution, a factual discrepancy/inaccuracy, "does not mention/attribute". Any of these ⇒ surgical fix → re-judge.
  const fabFlag = /not (in|supported|present|found|directly|backed).{0,30}(bundle|source|snippet|provided|text|report)|fabricat|invented|\bmade up\b|not supported by|unsubstantiated|not directly supported|quote is not|false claim|made-up|factual (discrepanc|inaccurac|error)|\bmisattribut|does not (mention|contain|attribute|name|state|match)|not (mentioned|named|attributed) in|wrong (outlet|year|date|source|attribution)|incorrect(ly)? (attribut|state|date|year)/i.test(issuesText);
  const unsafe = fabFlag || (Number.isFinite(safety) && safety < JUDGE_SAFETY_FLOOR) || (verifyDegraded && !Number.isFinite(safety));
  return { unsafe, safety, fabFlag, issues: auto?.issues || [] };
}

export async function runGossip(topic, {
  writeImpl = writeGossip, fetchImpl, model, corroborate = true,
  verify = false, verifyImpl = verifyGate,
  judge = false, judgeImpl = judgeGossip,
  maxFix = 2,
} = {}) {
  // Stage 3 — receipts (fail-closed). Step 4: corroborate pulls in more outlets so the writer rewrites from a
  // corroborated multi-source bundle, not one thin blurb (fail-safe).
  const bundle = await gatherBundle(topic, { ...(fetchImpl ? { fetchImpl } : {}), corroborate });
  if (!bundle.ok) return { status: "BLOCKED", reason: bundle.reason, stage: "content-finder" };

  // Stage 4 — classify & frame.
  const frame = frameTopic(topic);
  if (frame.decision === "HOLD") return { status: "HELD", frame, stage: "frame", reason: frame.reason };

  // Stage 5+6 — WRITE, then the SELF-CORRECT loop. The writer fixes ONLY the flagged spots each pass (surgical),
  // keeping the good prose; a full rewrite is the fallback only when a draft is broken top-to-bottom. A hard-stop
  // (minor/intimate-media/HOLD/fabrication-class) is NEVER retried — it stays blocked.
  let article = await writeImpl({ bundle, frame, topic, model });
  let verifyResult = verify ? await verifyImpl({ article, bundle, model }) : null;
  let report = inspect(article, frame, topic, bundle, verifyResult);

  for (let fix = 1; fix <= maxFix && !report.allPass && !report.hardStop; fix++) {
    // Decide SURGICAL vs full REWRITE for THIS draft: rewrite only when it's broadly broken (most claims
    // unsupported, or so thin/structureless there's nothing worth preserving). Otherwise patch the flaws in place.
    const broadlyBroken = (verifyResult && verifyResult.brokenRatio > 0.6) || report.qualityIssues.some((q) => /too thin|< 140|no body|empty/i.test(q));
    article = await writeImpl({ bundle, frame, topic, model, priorArticle: article, issues: report.issues, rewrite: broadlyBroken });
    verifyResult = verify ? await verifyImpl({ article, bundle, model }) : null; // re-verify the CORRECTED draft
    report = inspect(article, frame, topic, bundle, verifyResult);
  }

  if (report.hardStop || !report.legalPass) return { status: "BLOCKED_LEGAL", blocks: report.legalBlocks.length ? report.legalBlocks : report.issues, frame, article, stage: "legal-gate" };
  if (!report.quoteOk) return { status: "BLOCKED_LEGAL", blocks: report.quoteBlocks, frame, article, stage: "quote-guard" };
  if (!report.qualityPass) return { status: "BLOCKED_QUALITY", issues: report.qualityIssues, frame, article, stage: "quality-gate" };
  if (!report.verifyOk) return { status: "BLOCKED_VERIFY", issues: report.issues.filter((i) => /UNSUPPORTED_CLAIM/.test(i)), frame, article, stage: "verify-gate" };

  // Stage 6b — JUDGE BACKSTOP. The writer already self-corrected; the judge is the second pair of eyes that
  // catches the SMALL mistakes the writer missed. If it flags a real safety/fabrication problem, hand those exact
  // issues back for ONE more surgical pass, re-run the cheap gates (so the fix didn't reintroduce a problem), and
  // re-judge once. Still flagged ⇒ block. (Disabled in offline tests unless a judgeImpl is wired.)
  // SAFETY INVARIANT: if verify ran but DEGRADED to L1-only (its L2 LLM check errored), the design relies on the
  // judge as the backstop — so force the judge ON for this piece even if it was disabled.
  const verifyDegraded = verify && !!verifyResult?.degraded;
  let auto = null;
  if (judge || verifyDegraded) {
    try { auto = await judgeImpl({ article, bundle, frame }); } catch (e) { auto = { error: String(e?.message || e).slice(0, 80) }; }
    let flag = judgeFlags(auto, { verifyDegraded });
    if (flag.unsafe && flag.issues.length) {
      const fixed = await writeImpl({ bundle, frame, topic, model, priorArticle: article, issues: flag.issues, rewrite: false });
      const recheck = inspect(fixed, frame, topic, bundle, verify ? await verifyImpl({ article: fixed, bundle, model }) : null);
      if (recheck.allPass) {
        article = fixed;
        try { auto = await judgeImpl({ article, bundle, frame }); } catch (e) { auto = { error: String(e?.message || e).slice(0, 80) }; }
        flag = judgeFlags(auto, { verifyDegraded });
      }
    }
    if (flag.unsafe) return { status: "BLOCKED_JUDGE", auto, frame, article, stage: "judge", reason: `safety ${flag.safety ?? "?"}${flag.fabFlag ? " + fabrication flagged" : ""} — ${(flag.issues || []).slice(0, 2).join("; ") || auto?.error || "unsafe"}` };
  }

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
    corroborationCount: bundle.corroborationCount ?? new Set(bundle.sources.map((s) => s.outlet)).size,
    verifyDegraded, // true ⇒ the claim-verify ran at L1-only this run (L2 errored); surfaced for the monitor/owner
    sources: bundle.sources.map((s) => ({ outlet: s.outlet, url: s.url, tier: s.tier })),
  };
  return { status: "PUBLISH", article, frame, provenance, route, bundle, auto };
}
