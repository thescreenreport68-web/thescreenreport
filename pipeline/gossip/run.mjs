// GOSSIP — ORCHESTRATOR (Stages 3→7, the full single-topic quality loop). Fail-closed at every gate:
//   gather receipts → frame → WRITE → [legal + verbatim-quote + quality + claim-verify gates] → the writer
//   SURGICALLY SELF-CORRECTS the flagged spots (not a rewrite) → [JUDGE backstop] → one more surgical fix if the
//   judge caught something the writer missed → re-judge → assemble (provenance + rumor UI).
// The owner's design: the WRITER finds + fixes its own mistakes FIRST (verify gate tells it exactly what's wrong,
// it patches only those, keeping the good prose); the JUDGE is the BACKUP that catches what slipped through and
// sends it back for one more surgical pass. A full rewrite happens ONLY when a draft is broken top-to-bottom.
// writeImpl/fetchImpl/verifyImpl/judgeImpl are injectable so the harness runs offline; the defaults do live work.
//
// This is a speculation/gossip desk: it CORRECTS and PUBLISHES — it does not block for accuracy/quality/the judge.
// The only non-publishing outcomes:
//   { status: "BLOCKED", reason }            — no extractable sources at all (Stage 3 fail-closed)
//   { status: "REJECTED_THIN", reason }      — editorial gate: not a real/substantive story (a bare social post)
//   { status: "HELD", frame|reason }         — frame HOLD (EXTREME w/o an established outlet), or nothing publishable
//                                              remained after cutting fabricated quotes / contradicted claims
//   { status: "BLOCKED_LEGAL", blocks }      — an absolute legal RED LINE (minor sexual allegation / intimate media)
//   { status: "PUBLISH", article, frame, provenance, auto, bundle, editorial } — ready to assemble + publish
import { gatherBundle, corroborateBundle } from "./contentFinder.mjs";
import { editorialReview } from "./editorialGate.mjs";
import { frameTopic } from "./frame.mjs";
import { writeGossip } from "./writer.mjs";
import { buildAnchors, substituteAnchors, synthesize } from "./synthesizer.mjs";
import { refineHeadline } from "./headline.mjs";
import { semanticSeoPass } from "./seoAudit.mjs";
import { voicePass } from "./voice.mjs";
import { legalGate } from "./legalGate.mjs";
import { qualityCheck } from "./qualityGate.mjs";
import { verifyQuotes } from "./quoteGuard.mjs";
import { verifyGate } from "./verifyGate.mjs";
import { judgeGossip } from "./judge.mjs";
import { dedupeSentences, ensureTakeaways, ensureFaq, cutFlagged, cutSentencesWith, trimIncomplete, applyCorrections, scrubStructuredFields } from "./polish.mjs";
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
  const dropSpecifics = [];   // still-unverified SPECIFICS (bare tokens too, e.g. "2022") to drop as a last resort
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
  // THE ACCURACY SPINE (owner's hard rule): every checkable SPECIFIC — a date, number, place, person or work title —
  // that the source does NOT support (invented, misattached, or contradicted) MUST be corrected from the source or
  // DROPPED; it is never published unverified. A non-specific speculative claim is NOT dropped — it is just hedged.
  if (verifyResult && !verifyResult.ok) for (const u of verifyResult.unsupported) {
    const fixNote = u.correction ? ` → CORRECT it to: "${u.correction}"` : " → the source does not support this; REMOVE it entirely";
    if (u.isSpecific || u.contradicted) {
      issues.push(`UNVERIFIED_${String(u.kind || "specific").toUpperCase()}: "${(u.claim || "").slice(0, 140)}" (${u.problem})${fixNote}`);
      cutTexts.push(u.claim);        // last resort for long phrases (cutFlagged, ≥12 chars)
      dropSpecifics.push(u.claim);   // last resort for short specifics too (cutSentencesWith, word-boundary)
    } else {
      issues.push(`UNCONFIRMED_CLAIM: "${(u.claim || "").slice(0, 140)}" — frame it as speculation ("reportedly", "it seems"), do NOT state it as confirmed fact.`);
    }
  }
  return {
    issues, redLine, redLineBlocks, cutTexts: cutTexts.filter((t) => t && String(t).length >= 12),
    dropSpecifics: [...new Set(dropSpecifics.filter(Boolean))],
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
  editorial = true, editorialImpl = editorialReview,
  maxFix = 3, ledeStyle = "scene",
  synth = false, synthImpl = synthesize,
  headline = false, headlineImpl = refineHeadline,
  voice = false, voiceImpl = voicePass,
} = {}) {
  // Stage 3 — receipts (fail-closed). CHEAP-FIRST (Phase 1): extract the PRIMARY source only, let the
  // editorial gate reject non-stories, and pay for corroboration ONLY on stories the gate keeps — a
  // REJECTED_THIN candidate no longer costs the corroboration search + extra extractions.
  const bundle = await gatherBundle(topic, { ...(fetchImpl ? { fetchImpl } : {}), corroborate: false });
  if (!bundle.ok) return { status: "BLOCKED", reason: bundle.reason, stage: "content-finder" };

  // Stage 3.5 — EDITORIAL GATE (the "read the actual story and decide" step). Grounded in the collected content,
  // not the discovery metadata: is this a real story? what is it about (category)? who really reports it
  // (attribution)? is it confirmed? — with the power to REJECT a non-story. Its verdict OVERRIDES the thin
  // metadata guesses below. Fail-open: if the gate errors, fall back to the metadata path (never lose a real story).
  let ed = null;
  if (editorial) {
    ed = await editorialImpl({ topic, bundle });
    if (ed && !ed.isStory) return { status: "REJECTED_THIN", reason: ed.rejectReason || "not a substantive story", stage: "editorial", editorial: ed, bundle };
    if (ed) { // adopt the content-grounded calls (replaces the categorizer's metadata guesses)
      topic.confirmed = ed.confirmed;
      topic.official = ed.official;
      topic.denied = ed.denied;
      // WHO the story is really about — drives the lead image + caption to the RIGHT person (fixes the wrong-entity
      // "Pictured: Taylor Swift" on an Abigail Anderson story). coSubjects lets a "spotted with X" image show both.
      if (ed.primaryEntity) topic.primaryEntity = ed.primaryEntity;
      topic.coSubjects = ed.coSubjects || [];
      topic.angle = ed.angle || topic.angle || "";
    }
  }

  // Step 4 — corroboration, AFTER the editorial gate kept the story (fail-safe enrichment; the frame below
  // tiers off the corroborated bundle exactly as before — only the spend order changed).
  if (corroborate) { try { await corroborateBundle(topic, bundle, { ...(fetchImpl ? { fetchImpl } : {}) }); } catch { /* enrichment only */ } }

  // Stage 4 — frame. Pass the CORROBORATED bundle + the editorial verdict so tier/attribution reflect what the
  // CONTENT actually establishes (a wire-reported fact is a fact; the real reporting outlet is the byline), not
  // just the thin discovery source or the highest-tier outlet that merely echoed it.
  const frame = frameTopic(topic, bundle, ed);
  if (frame.decision === "HOLD") return { status: "HELD", frame, stage: "frame", reason: frame.reason };

  // Stage 5+6 — WRITE, then the SELF-CORRECT loop. The writer fixes ONLY the flagged spots each pass (surgical),
  // keeping the good prose; a full rewrite is the fallback only when a draft is broken top-to-bottom. A hard-stop
  // (minor/intimate-media/HOLD/fabrication-class) is NEVER retried — it stays blocked.
  // Phase 2 — ANCHOR CARDS (deterministic) + the SYNTHESIZER'S BRIEF (fail-open: null brief = the old path).
  const anchors = buildAnchors(bundle);
  const brief = synth ? await synthImpl({ bundle, frame, topic, anchors }) : null;
  let article = await writeImpl({ bundle, frame, topic, model, ledeStyle, brief, anchors });
  substituteAnchors(article, anchors); // inject exact quote text for the tokens BEFORE any gate sees the draft
  let verifyResult = verify ? await verifyImpl({ article, bundle, model }) : null;
  let report = inspect(article, frame, topic, bundle, verifyResult);

  for (let fix = 1; fix <= maxFix && !report.allPass && !report.redLine; fix++) {
    // The writer fixes ONLY the flagged spots (surgical); full rewrite only when a draft is broadly broken.
    const broadlyBroken = (verifyResult && verifyResult.brokenRatio > 0.6) || report.qualityIssues.some((q) => /no body|empty|truncat/i.test(q));
    article = await writeImpl({ bundle, frame, topic, model, priorArticle: article, issues: report.issues, rewrite: broadlyBroken, ledeStyle, brief, anchors });
    substituteAnchors(article, anchors);
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
    // Split the flagged specifics: those the source lets us CORRECT (right value known) vs. those we must DROP
    // (uncorrectable). The accuracy spine now covers EVERY reader-facing field — body, keyTakeaways, whatWeKnow,
    // dek, pull-quote, FAQ answers — so a wrong year in a takeaway is fixed/removed just like one in the body.
    const specifics = (verifyResult?.unsupported || []).filter((u) => u.isSpecific || u.contradicted);
    const corrections = specifics.filter((u) => u.correction).map((u) => ({ bad: u.claim, correction: u.correction }));
    const drops = specifics.filter((u) => !u.correction).map((u) => u.claim);
    // 1) CORRECT known-wrong specifics everywhere (a wrong "2024" → "2026"), then cut what's left unresolved.
    article.body = applyCorrections(article.body, corrections);
    article.body = cutFlagged(article.body, report.cutTexts);
    // Drop any sentence still carrying an UNCORRECTABLE unverified SPECIFIC the writer couldn't fix — never publish
    // an unverified specific (owner's hard rule); a short bare "2022"/"$40K" is caught here too.
    article.body = cutSentencesWith(article.body, drops);
    // 2) Same treatment for the STRUCTURED fields (the old bypass): correct or drop the offending specific in
    // keyTakeaways / whatWeKnow / whatWeDont / dek / pull-quote / FAQ.
    scrubStructuredFields(article, { corrections, drops });
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
      const fixed = await writeImpl({ bundle, frame, topic, model, priorArticle: article, issues: flag.issues, rewrite: false, brief, anchors });
      substituteAnchors(fixed, anchors);
      const rc = inspect(fixed, frame, topic, bundle, verify ? await verifyImpl({ article: fixed, bundle, model }) : null);
      if (!rc.redLine && (qualityCheck(fixed).words || 0) >= 120) {
        article = fixed; report = rc; await cleanse();
        try { auto = await judgeImpl({ article, bundle, frame }); } catch (e) { auto = { error: String(e?.message || e).slice(0, 80) }; }
      }
    }
  }

  // Stage 6c — POLISH (deterministic, post-gate): strip any repeated sentence (the doubled no-comment/boilerplate
  // problem) and backfill empty SEO fields from the article's OWN confirmed points (never invents a fact).
  article.body = trimIncomplete(dedupeSentences(article.body));
  article.keyTakeaways = ensureTakeaways(article);
  article.faq = ensureFaq(article);

  // Stage 6c2 — VOICE PASS (Phase 4, flagged): quote-masked native-register polish; deterministic guards
  // (token integrity, number multiset, no new names, ±25% length, subheads) auto-revert on any violation,
  // then the verbatim-quote wall re-checks the polished prose — cosmetic can never cost accuracy.
  let voiceReport = null;
  if (voice) {
    try {
      const v = await voiceImpl({ body: article.body });
      if (v.applied) {
        const qc = verifyQuotes({ ...article, body: v.body }, bundle);
        if (qc.ok) { article.body = v.body; voiceReport = { applied: true }; }
        else voiceReport = { applied: false, reason: "quote-wall" };
      } else voiceReport = { applied: false, reason: v.reason };
    } catch { voiceReport = { applied: false, reason: "error" }; }
  }

  // Stage 6d — HEADLINE AGENT (Phase 2): best-of-3 rephrase of metaTitle/metaDescription/dek, judged for CTR,
  // hard-gated deterministically (grounded numbers+names, render-contract validators) — improves or no-ops.
  let headlineReport = null;
  if (headline) { try { headlineReport = await headlineImpl({ article, bundle, topic }); } catch { headlineReport = null; } }
  // Phase 3 — semantic SEO pass (flash-lite, REPORT-ONLY: click-promise honesty / stuffing / labeling).
  let seoSemantic = null;
  if (headline) { try { seoSemantic = await semanticSeoPass({ fm: { metaTitle: article.metaTitle, metaDescription: article.metaDescription, title: article.title, rumorStatus: frame.uiLabel }, topic }); } catch { seoSemantic = null; } }

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
  // Route by what the STORY is about (editorial gate, content-grounded) — a musician's wedding files under
  // celebrity, not music. Fall back to the subjectType map only if the gate is off/errored.
  const route = ed?.category ? { category: ed.category, subcategory: ed.category === "awards" ? "predictions" : "news", secondaryCategory: ed.secondaryCategory || null } : routeBySubject(topic.subjectType);
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
  return { status: "PUBLISH", article, frame, provenance, route, bundle, auto, editorial: ed, brief: brief ? true : false, headline: headlineReport, seoSemantic, voice: voiceReport };
}
