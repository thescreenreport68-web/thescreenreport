// AGENT 7 — QA. Its one job: verify EVERYTHING before publish.
//  (1) THE FACT-LOCKS (deterministic, free): every quote verbatim from the anchors, every named
//      speaker real, no invented attribution, audience always aggregate, honest "divided" claims,
//      no quote-dumps — a broken lock is fatal, never publishable.
//  (2) quoteGuard + specificsGuard (shared libs): quoted phrases + stated numbers must trace.
//  (3) The ENGAGEMENT JUDGE (gemini-2.5-flash, temp 0): readability/engagement/humanVoice scores —
//      the owner's KPI — with floors; returns correction flags the Writer can act on.
//  (4) webCheck(): webVerify as the ALWAYS-LAST content gate (dates/names/titles vs the live web).
// This file absorbed the REV 2 gate walls — gate.mjs is retired so exactly one copy exists.
import { verifyQuotes } from "../../lib/quoteGuard.mjs";
import { specificsGuard } from "../../lib/specificsGuard.mjs";
import { webVerifyArticle } from "../../lib/webVerify.mjs";
import { GATE, FORMS } from "../config.inside.mjs";
import { norm, quoteIsVerbatim, buildVBundle } from "../reactionFinder.mjs";
import { findTemplateHeadings } from "./voice.mjs";
import { agentChat, AGENTS } from "../models.mjs";

export function factLocks(article, factBlock, angle) {
  const hardBlocks = [];
  const proseCuts = []; // unanchored PROSE quotes — cut the sentence, don't hold (owner: publish-everything)
  const body = article?.body || "";
  const words = body.split(/\s+/).filter(Boolean).length;
  const form = FORMS[angle.form] || { words: [400, 900] };

  const knownSpeakers = new Set(factBlock.reactions.map((r) => norm(r.speaker)).filter(Boolean));
  const bySpeaker = new Map();
  for (const r of factBlock.reactions) {
    const k = norm(r.speaker);
    if (!k || !r.quote) continue;
    if (!bySpeaker.has(k)) bySpeaker.set(k, []);
    bySpeaker.get(k).push({ text: r.quote });
  }
  const fanPool = factBlock.aggregateFans.map((r) => ({ text: r.quote }));
  const anyPool = [...factBlock.reactions, ...factBlock.aggregateFans].map((r) => ({ text: r.quote }));

  // Aggregate = an anonymous audience label; a real name survives the generic-word strip.
  // Connector prepositions included (2026-07-10 fix): the anchor block itself instructs "fans on
  // Reddit" / "one X user said" — without "on/in/of/..." those lane-mandated aggregate labels
  // mis-classified as NAMED speakers (false-positive invented-speaker). No real personal name is
  // composed solely of prepositions + generic audience nouns, so this cannot weaken the wall.
  const GENERIC_AUD = /\b(a|an|one|another|some|several|many|most|the|on|in|of|at|from|fan|fans|viewer|viewers|user|users|redditor|redditors|commenter|commenters|audience|member|moviegoer|moviegoers|watcher|watchers|online|reddit|twitter|x|internet|poster)\b/gi;
  const isAggregate = (sp) => norm(sp).replace(GENERIC_AUD, " ").replace(/[^a-z]/g, "").trim().length === 0;

  for (const r of article?.reactionsRender || []) {
    if (!r?.quote) continue;
    const agg = isAggregate(r.speaker || "");
    if (!agg && !knownSpeakers.has(norm(r.speaker)))
      hardBlocks.push(`invented-speaker: "${r.speaker}" not in anchors`);
    else if (!quoteIsVerbatim(r.quote, agg ? fanPool : bySpeaker.get(norm(r.speaker)) || []))
      hardBlocks.push(`${agg ? "unverbatim-audience-quote" : "misattributed-or-unverbatim-quote"}: "${String(r.quote).slice(0, 60)}…" (${r.speaker || "audience"})`);
  }
  const anchor = article?.anchorStatement;
  if (anchor?.speaker && !knownSpeakers.has(norm(anchor.speaker)))
    hardBlocks.push(`invented-speaker: anchor "${anchor.speaker}" not in anchors`);
  else if (anchor?.quote && !quoteIsVerbatim(anchor.quote, bySpeaker.get(norm(anchor.speaker)) || []))
    hardBlocks.push(`unverbatim-anchor-quote`);

  // Body-prose quote wall (spans never cross a line break; trailing punctuation is orthography).
  const outletish = new Set((factBlock.sources || []).flatMap((s) => [norm(s.owner), norm(s.domain), norm((s.domain || "").split(".")[0])]).filter(Boolean));
  const prose = [article?.title, article?.dek, body].filter(Boolean).join("\n");
  for (const m of prose.matchAll(/["“]([^"”\n]{12,400})["”]/g)) {
    // A span starting with whitespace is an odd-quote PAIRING ARTIFACT (the regex latched onto a
    // closing mark), not a quote — real quoted content never begins with a space. Skip, don't block.
    if (/^\s/.test(m[1])) continue;
    const core = m[1].replace(/[\s.,!?;:…]+$/, "");
    if (core.length < 12) continue;
    // An unanchored span in BODY PROSE routes to the CUTTER (sentence removed, article publishes
    // clean) per the owner's cut-don't-hold policy — cloud run 5: the writer keeps re-wording its
    // own analysis inside quote marks instead of deleting them; the deterministic cut IS the fix.
    // Card-level and named-speaker violations above stay hard blocks.
    if (!quoteIsVerbatim(core, anyPool)) { proseCuts.push(m[1]); continue; }
    // TRUNCATION GUARD: a cut can leave a dangling fragment ("often-thrilling mixtu") that still
    // passes the substring wall. A span that ends MID-WORD relative to its anchor (the anchor
    // continues with a letter right after the match) is a scar, not a quote.
    const nc = norm(core);
    for (const a of anyPool) {
      const na = norm(a.text || "");
      const at = na.indexOf(nc);
      if (at === -1) continue;
      const next = na[at + nc.length];
      if (next && /[a-z0-9]/.test(next)) hardBlocks.push(`truncated-quote: "${core.slice(0, 50)}…" ends mid-word vs its anchor`);
      break;
    }
  }
  // PROSE ATTRIBUTION BINDING: a quote directly attached to a name ('Name said, "…"' or
  // '"…," Name said') must be verbatim from THAT speaker's own anchors — the pooled wall above
  // can't catch giving speaker A's words to speaker B in prose. Resolve partial names by the same
  // containment rule as the attribution scan; aggregate/outlet labels are exempt (fan pool).
  const VERBS = "said|says|wrote|writes|posted|shared|told|added|continued|captioned|commented|responded|replied|recalled|admitted|announced";
  const speakerPool = (rawName) => {
    const name = norm(rawName);
    if (!name || outletish.has(name)) return null; // outlets aren't speakers
    if (bySpeaker.has(name)) return bySpeaker.get(name);
    const partials = [...bySpeaker.keys()].filter((k) => k.includes(name) || name.includes(k));
    if (partials.length) return partials.flatMap((k) => bySpeaker.get(k));
    return undefined; // unknown name — the attribution scan below reports it
  };
  const bindChecks = [
    // Name said[,:] "quote"
    new RegExp(`\\b([A-Z][a-zA-Z'’.-]+(?: [A-Z][a-zA-Z'’.-]+){0,2})\\s+(?:also\\s+|later\\s+|then\\s+)?(?:${VERBS})[,:]?\\s*["“]([^"”\\n]{12,400})["”]`, "g"),
    // "quote," Name said
    new RegExp(`["“]([^"”\\n]{12,400})[,.]?["”]\\s*,?\\s+([A-Z][a-zA-Z'’.-]+(?: [A-Z][a-zA-Z'’.-]+){0,2})\\s+(?:${VERBS})\\b`, "g"),
  ];
  for (let ci = 0; ci < bindChecks.length; ci++) {
    for (const m of prose.matchAll(bindChecks[ci])) {
      const rawName = ci === 0 ? m[1] : m[2];
      const quote = (ci === 0 ? m[2] : m[1]).replace(/[\s.,!?;:…]+$/, "");
      if (quote.length < 12) continue;
      const pool = speakerPool(rawName);
      if (pool === null || pool === undefined) continue; // outlet or unknown (handled elsewhere)
      if (!quoteIsVerbatim(quote, pool))
        hardBlocks.push(`misattributed-prose-quote: "${quote.slice(0, 50)}…" attributed to ${rawName}`);
    }
  }
  for (const m of prose.matchAll(/\b([A-Z][a-zA-Z'’.-]+(?: [A-Z][a-zA-Z'’.-]+){1,2})\s+(?:also\s+|later\s+|then\s+)?(said|says|wrote|writes|posted|shared|told|added|continued|captioned|commented|responded|replied|recalled|admitted|announced)\b/g)) {
    const name = norm(m[1]);
    if (knownSpeakers.has(name) || outletish.has(name)) continue;
    if ([...knownSpeakers].some((k) => k.includes(name) || name.includes(k))) continue;
    hardBlocks.push(`unknown-attribution: "${m[1]} ${m[2]}" — not a real quoted voice`);
  }

  // Quote-dump cap (the writer should WRITE, not stack quotes).
  const quotedChars = (body.match(/"[^"\n]{8,400}"|“[^”\n]{8,400}”/g) || []).filter((q) => !/^["“]\s/.test(q)).join("").length;
  const ratio = body.length ? quotedChars / body.length : 0;
  // 45% cap (2026-07-10 calibration): the audience-reaction format is quote-forward by design —
  // real posts ARE the content. The engagement judge still punishes lazy quote-stacking.
  if (ratio > 0.45) hardBlocks.push(`quote-ratio ${(ratio * 100).toFixed(0)}% > 45%`);

  // "divided" honesty.
  if (angle.form === "the-debate" || angle.form === "audience-reaction") {
    const claimsDivided = /divided|split|torn|at odds/i.test((article?.fanConsensus || "") + " " + (article?.title || ""));
    if (claimsDivided && !factBlock.stats.divided) hardBlocks.push("divided-claim-without-both-sides");
  }
  if (/@[A-Za-z0-9_]{3,15}\b/.test(body)) hardBlocks.push("audience-handle-in-prose");
  // Template/meta headings telegraph the format (owner REV 3) — FIXABLE: the correction loop and
  // the voice pass rewrite them; stripTemplateHeadings is the deterministic last resort.
  for (const h of findTemplateHeadings(body)) hardBlocks.push(`template-heading: "${h.slice(0, 60)}" — rewrite story-specific`);
  // Average-SEO floor (owner: basic, never stuffed): 2+ real FAQs. Metadata lengths are fixed
  // deterministically at assemble; this is the one item only the writer can supply.
  if ((article?.faq || []).filter((f) => f?.q && f?.a).length < 2) hardBlocks.push("seo-faq: fewer than 2 FAQs — add 1-2 REAL reader questions with 40-60 word answers");

  const h2s = (body.match(/^##\s/gm) || []).length;
  const anchors = (factBlock.stats?.namedVoices || 0) + (factBlock.stats?.fanPosts || 0);
  const floorWords = anchors <= 3 ? 300 : Math.min(form.words[0], 400); // tight+punchy beats padded
  if (words < floorWords) hardBlocks.push(`words ${words} < ${floorWords}`);

  return { words, h2s, quoteRatio: ratio, hardBlocks, proseCuts };
}

const RUBRIC = `Score this AUDIENCE-REACTION / DISCOURSE article 0-100 with subscores 0-10:
readability (short, scannable, clear), engagement (does the HOOK grab and the structure PULL you down the
page), humanVoice (lively human, zero corporate filler), curiosity (honest, promise paid off), structure
(the form's skeleton), infoGain (does the reader learn what people think / what the debate is), seo (honest
title, ONE natural keyword, NOT over-optimized — over-optimization is a DEFECT), faqQuality, completeness
(uses the real posts, no padding), accuracy (characterizations anchored, not overstated). Reward a strong
hook, real posts as beats, lively voice; punish dull summary ledes, keyword-stuffing, filler, quote-dumps.
Score only — never rewrite. STRICT JSON: {"score":0,"subscores":{"readability":0,"engagement":0,
"humanVoice":0,"curiosity":0,"structure":0,"infoGain":0,"seo":0,"faqQuality":0,"completeness":0,
"accuracy":0},"strengths":[""],"weaknesses":[""]}`;

// review(job) → job.qa = { score, pass, hardBlocks, cutClaims, subscores, weaknesses }
export async function review(job, { chatImpl = null } = {}) {
  const { article, factBlock, angle, story } = job;
  const det = factLocks(article, factBlock, angle);
  const hardBlocks = [...det.hardBlocks];
  let cutClaims = [];

  const vbundle = buildVBundle(factBlock, story);
  const extendedBody = [
    article.body,
    ...(article.keyTakeaways || []),
    ...(article.faq || []).flatMap((f) => [f?.q, f?.a]),
    article.fanConsensus,
    ...(article.reactionsRender || []).map((r) => r?.connection),
    article.anchorStatement?.connection,
  ].filter(Boolean).join("\n");
  const qg = verifyQuotes({ ...article, body: extendedBody }, vbundle);
  // Unanchored prose quotes (walls + shared quoteGuard) become CUT claims: the cutter removes the
  // sentence and the article ships without it — never with it. A draft SATURATED with them (>4)
  // is not salvageable-by-cutting and still holds.
  const proseCuts = [...(det.proseCuts || []), ...(qg.ok ? [] : qg.badQuotes.map((q) => String(q)))];
  if (proseCuts.length > 4) hardBlocks.push(`fabricated-quotes x${proseCuts.length} — draft-level failure (cut cap exceeded)`);
  else cutClaims.push(...proseCuts);

  const sg = specificsGuard(article, vbundle.sources, { facts: [], sources: [], verification: { attribution: null } });
  if (!sg.ok) cutClaims.push(...sg.bad.map((b) => b.text));

  let j = { score: 0, subscores: {}, strengths: [], weaknesses: [] };
  const fatal = hardBlocks.some((b) => /invented-speaker|unverbatim|fabricated-quote|unknown-attribution/.test(b));
  if (!fatal) {
    try {
      const { data } = await agentChat("qa", {
        system: RUBRIC,
        user: `ARTICLE JSON:\n${JSON.stringify({ title: article.title, dek: article.dek, body: article.body, keyTakeaways: article.keyTakeaways, faq: article.faq, fanConsensus: article.fanConsensus }, null, 1).slice(0, 16000)}\n\nTHE REAL POSTS IT WAS BUILT FROM:\n${vbundle.sources.at(-1).text.slice(0, 6000)}`,
      }, chatImpl ? { chatImpl } : {});
      if (data?.score != null) j = data;
    } catch { /* judge outage → score 0 → held, never auto-published */ }
    const s = j.subscores || {};
    for (const k of ["readability", "engagement", "humanVoice"]) {
      if (s[k] != null && s[k] < 5) hardBlocks.push(`soft-floor ${k} ${s[k]} < 5`);
    }
  }

  cutClaims = [...new Set(cutClaims.filter((c) => (c || "").length > 8))];
  job.qa = {
    score: j.score || 0,
    // cutClaims must be EMPTY to pass — an unsupported specific may never ride out on a passing
    // score (the orchestrator cuts + re-reviews; publish only when the re-review is clean).
    pass: (j.score || 0) >= GATE.publishMin && hardBlocks.length === 0 && cutClaims.length === 0,
    subscores: j.subscores || {},
    deterministic: det,
    hardBlocks,
    cutClaims,
    strengths: j.strengths || [],
    weaknesses: j.weaknesses || [],
  };
  return job;
}

// webCheck(job) → { ran, ok, contradictions[] } — the always-last gate (QA judge model).
// FAIL-CLOSED: an error is NEVER reported as ok — the orchestrator holds when ran is false
// (webVerify's own documented contract; the Thor ran:false-then-published regression guard).
export async function webCheck(job, { webVerifyImpl = webVerifyArticle } = {}) {
  return webVerifyImpl({
    article: job.article,
    topic: { primaryEntity: job.story.primaryEntity, title: job.story.parentTitle, eventType: job.story.eventType },
    model: AGENTS.qa.model,
  }).catch((e) => ({ ran: false, ok: false, contradictions: [], error: String(e?.message || e).slice(0, 120) }));
}

// Fixable = engagement soft-floors; everything else (a broken fact-lock) is a hard stop.
export function classifyBlocks(blocks) {
  const fixable = blocks.filter((b) => /^soft-floor|^template-heading|^seo-faq/.test(b));
  const block = blocks.filter((b) => !fixable.includes(b));
  return { block, fixable };
}
