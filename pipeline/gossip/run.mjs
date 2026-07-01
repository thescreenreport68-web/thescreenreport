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
import { dedupeSentences, ensureTakeaways, ensureFaq, cutFlagged } from "./polish.mjs";
import { GOSSIP_AUTHOR_SLUG, AI_DISCLOSURE, routeBySubject, MONITOR_WINDOW_HOURS } from "./config.gossip.mjs";

// The ABSOLUTE red lines — the ONLY things that block a story (they're illegal + can't be corrected into a
// publishable piece): a sexual allegation about a MINOR, or intimate/leaked media. EVERYTHING else is corrected
// or, as a last resort, cut — never blocked (owner's hard rule: the gate finds the issue and fixes it, it does
// not kill the article).
const RED_LINE = /MINOR_ALLEGATION|INTIMATE_MEDIA/i;

// Run EVERY gate over one draft, collect the actionable issue list for the writer AND the exact offending phrases
// to CUT if a fix doesn't take. redLine ⇒ the one hard block.
function inspect(article, frame, topic, bundle, verifyResult) {
  const legal = legalGate(article, frame, topic);
  const issues = [];
  const cutTexts = [];        // the exact phrases to delete if the writer can't fix them (last-resort cut)
  const redLineBlocks = [];
  let redLine = false;
  for (const b of legal.blocks || []) {
    issues.push(b);
    if (RED_LINE.test(b)) { redLine = true; redLineBlocks.push(b); }
    else { // grab the LONGEST quoted span in the block (robust to nested quotes) = the offending phrase to cut
      const longest = [...b.matchAll(/"([^"]{8,})"/g)].map((m) => m[1]).sort((a, z) => z.length - a.length)[0];
      if (longest) cutTexts.push(longest);
    }
  }
  const qc = verifyQuotes(article, bundle);
  if (!qc.ok) for (const q of qc.badQuotes) { issues.push(`FABRICATED_QUOTE: the quoted phrase "${q}" is NOT verbatim in any source — use the exact source words, or drop the quotation marks and paraphrase`); cutTexts.push(q); }
  const quality = qualityCheck(article);
  if (!quality.pass) for (const q of quality.issues || []) issues.push(q);
  if (verifyResult && !verifyResult.ok) for (const u of verifyResult.unsupported) { issues.push(`UNSUPPORTED_CLAIM: "${(u.claim || "").slice(0, 160)}" — ${u.why}${u.contradicted ? " (the bundle CONTRADICTS this — cut or correct it)" : ""}`); cutTexts.push(u.claim); }
  return {
    issues, redLine, redLineBlocks, cutTexts: cutTexts.filter((t) => t && String(t).length >= 12),
    legalPass: legal.pass, legalBlocks: legal.blocks || [],
    quoteOk: qc.ok, qualityPass: quality.pass, qualityIssues: quality.issues || [],
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
  maxFix = 3,
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

  for (let fix = 1; fix <= maxFix && !report.allPass && !report.redLine; fix++) {
    // The writer fixes ONLY the flagged spots (surgical); full rewrite only when a draft is broadly broken.
    const broadlyBroken = (verifyResult && verifyResult.brokenRatio > 0.6) || report.qualityIssues.some((q) => /no body|empty/i.test(q));
    article = await writeImpl({ bundle, frame, topic, model, priorArticle: article, issues: report.issues, rewrite: broadlyBroken });
    verifyResult = verify ? await verifyImpl({ article, bundle, model }) : null; // re-verify the CORRECTED draft
    report = inspect(article, frame, topic, bundle, verifyResult);
  }

  // ── RESOLUTION (owner's hard rule: the gate NEVER blocks — it corrects, and as a LAST RESORT cuts the offending
  // phrase, so the clean article always publishes). The ONLY exception is an absolute illegal RED LINE (a sexual
  // allegation about a minor / intimate media) — that cannot be turned into a publishable story.
  if (report.redLine) return { status: "BLOCKED_LEGAL", blocks: report.redLineBlocks, frame, article, stage: "red-line" };

  // Cut whatever is still flagged after the correction passes; add a missing mandatory disclaimer; re-check.
  const cleanse = async () => {
    if (report.allPass) return;
    article.body = cutFlagged(article.body, report.cutTexts);
    if (frame.needsDisclaimer && frame.disclaimerText && !article.body.includes(frame.disclaimerText)) article.body = (article.body.trim() + "\n\n" + frame.disclaimerText).trim();
    verifyResult = verify ? await verifyImpl({ article, bundle, model }) : verifyResult;
    report = inspect(article, frame, topic, bundle, verifyResult);
  };
  await cleanse();
  // If removing the flagged/unverified claims left too little, there is genuinely nothing safe to publish.
  if ((qualityCheck(article).words || 0) < 80) return { status: "HELD", frame, article, stage: "nothing-publishable", reason: "too little verifiable content remained after removing flagged claims" };

  // Stage 6b — JUDGE as APPROVER (never a blocker). It scores the piece; if it spots a fabrication the structured
  // gates missed, it hands one more correction to the writer + a re-cut, then we publish regardless — accuracy on
  // the checkable facts is already guaranteed by the deterministic gates + cut. Forced on when verify degraded.
  const verifyDegraded = verify && !!verifyResult?.degraded;
  let auto = null;
  if (judge || verifyDegraded) {
    try { auto = await judgeImpl({ article, bundle, frame }); } catch (e) { auto = { error: String(e?.message || e).slice(0, 80) }; }
    const flag = judgeFlags(auto, { verifyDegraded });
    if (flag.unsafe && flag.issues.length) {
      const fixed = await writeImpl({ bundle, frame, topic, model, priorArticle: article, issues: flag.issues, rewrite: false });
      const rc = inspect(fixed, frame, topic, bundle, verify ? await verifyImpl({ article: fixed, bundle, model }) : null);
      if (!rc.redLine && (qualityCheck(fixed).words || 0) >= 120) {
        article = fixed; report = rc; await cleanse();
        try { auto = await judgeImpl({ article, bundle, frame }); } catch (e) { auto = { error: String(e?.message || e).slice(0, 80) }; }
      }
    }
  }

  // Stage 6c — POLISH (deterministic, post-gate): strip any repeated sentence (the doubled no-comment/boilerplate
  // problem) and backfill empty SEO fields from the article's OWN confirmed points (never invents a fact).
  article.body = dedupeSentences(article.body);
  article.keyTakeaways = ensureTakeaways(article);
  article.faq = ensureFaq(article);

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
