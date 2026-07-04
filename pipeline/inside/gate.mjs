// GATE (REV 2) — enforces the ACCURACY LINE (quotes/names locked) + measures ENGAGEMENT.
// KEPT: the deterministic quote/speaker/attribution wall (a quote must be verbatim from a real anchor,
// a named person must exist, no invented attribution) + quoteGuard + specificsGuard (hard-fact numbers).
// REMOVED vs REV 1: verifyGate narrative-cutting (the writer may now craft the narrative freely).
// The judge is now a READABILITY + ENGAGEMENT scorer, not a source-entailment checker.
import { chat } from "../lib/openrouter.mjs";
import { verifyQuotes } from "../lib/quoteGuard.mjs";
import { specificsGuard } from "../lib/specificsGuard.mjs";
import { MODELS, GATE, FORMS } from "./config.inside.mjs";
import { norm, quoteIsVerbatim, buildVBundle } from "./reactionFinder.mjs";

export function deterministicInside(article, factBlock, angle) {
  const hardBlocks = [];
  const body = article?.body || "";
  const words = body.split(/\s+/).filter(Boolean).length;
  const form = FORMS[angle.form] || { words: [400, 900] };

  // Speaker guard: every rendered voice must exist in the anchors, and every quote must be a substring
  // of a SINGLE anchor quote BY THAT SPEAKER (merging two quotes can't pass; an audience quote can't be
  // re-attributed to a named creator). Invented/misattributed = fatal.
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
  const AGGREGATE = /^(a fan|one fan|one viewer|a viewer|fans?( on [a-z]+)?|one [a-z]+ user|)$/i;
  for (const r of article?.reactionsRender || []) {
    if (!r?.quote) continue;
    const isAggregate = AGGREGATE.test(r.speaker || "");
    if (!isAggregate && !knownSpeakers.has(norm(r.speaker)))
      hardBlocks.push(`invented-speaker: "${r.speaker}" not in anchors`);
    else if (!quoteIsVerbatim(r.quote, isAggregate ? fanPool : bySpeaker.get(norm(r.speaker)) || []))
      hardBlocks.push(`${isAggregate ? "unverbatim-audience-quote" : "misattributed-or-unverbatim-quote"}: "${String(r.quote).slice(0, 60)}…" (${r.speaker || "audience"})`);
  }
  const anchor = article?.anchorStatement;
  if (anchor?.speaker && !knownSpeakers.has(norm(anchor.speaker)))
    hardBlocks.push(`invented-speaker: anchor "${anchor.speaker}" not in anchors`);
  else if (anchor?.quote && !quoteIsVerbatim(anchor.quote, bySpeaker.get(norm(anchor.speaker)) || []))
    hardBlocks.push(`unverbatim-anchor-quote`);

  // Body-prose quote wall: every quoted span in title/dek/body must be verbatim from a single anchor
  // quote (spans never cross a line break; trailing house-style punctuation stripped before the check).
  const prose = [article?.title, article?.dek, body].filter(Boolean).join("\n");
  for (const m of prose.matchAll(/["“]([^"”\n]{12,400})["”]/g)) {
    const core = m[1].replace(/[\s.,!?;:…]+$/, "");
    if (core.length < 12) continue;
    if (!quoteIsVerbatim(core, anyPool)) hardBlocks.push(`unverbatim-prose-quote: "${m[1].slice(0, 60)}…"`);
  }
  // Attribution scan: "<Name> said/wrote/…" where <Name> is nobody in the anchors = an invented voice.
  const outletish = new Set((factBlock.sources || []).flatMap((s) => [norm(s.owner), norm(s.domain), norm((s.domain || "").split(".")[0])]).filter(Boolean));
  for (const m of prose.matchAll(/\b([A-Z][a-zA-Z'’.-]+(?: [A-Z][a-zA-Z'’.-]+){1,2})\s+(?:also\s+|later\s+|then\s+)?(said|says|wrote|writes|posted|shared|told|added|continued|captioned|commented|responded|replied|recalled|admitted|announced)\b/g)) {
    const name = norm(m[1]);
    if (knownSpeakers.has(name) || outletish.has(name)) continue;
    if ([...knownSpeakers].some((k) => k.includes(name) || name.includes(k))) continue;
    hardBlocks.push(`unknown-attribution: "${m[1]} ${m[2]}" — not a real quoted voice`);
  }

  // Quote-dump cap: quoted characters ≤35% of body (REV 2 wants MORE crafted prose, so a high ratio =
  // the writer leaned on quotes instead of writing).
  const quotedChars = (body.match(/"[^"\n]{8,400}"|“[^”\n]{8,400}”/g) || []).join("").length;
  const ratio = body.length ? quotedChars / body.length : 0;
  if (ratio > 0.35) hardBlocks.push(`quote-ratio ${(ratio * 100).toFixed(0)}% > 35%`);

  // "divided/split" framing must have both stances in the anchors (the-debate honesty).
  if (angle.form === "the-debate" || angle.form === "audience-reaction") {
    const claimsDivided = /divided|split|torn|at odds/i.test((article?.fanConsensus || "") + " " + (article?.title || ""));
    if (claimsDivided && !factBlock.stats.divided) hardBlocks.push("divided-claim-without-both-sides");
  }

  // No real name/handle for an ordinary audience member.
  if (/@[A-Za-z0-9_]{3,15}\b/.test(body)) hardBlocks.push("audience-handle-in-prose");

  const h2s = (body.match(/^##\s/gm) || []).length;
  const anchors = (factBlock.stats?.namedVoices || 0) + (factBlock.stats?.fanPosts || 0);
  const floorWords = anchors <= 3 ? 300 : Math.min(form.words[0], 450);
  if (words < floorWords) hardBlocks.push(`words ${words} < ${floorWords}`);

  return { words, h2s, quoteRatio: ratio, hardBlocks };
}

const RUBRIC = `Score this AUDIENCE-REACTION / DISCOURSE article 0-100 with subscores 0-10:
readability (short, scannable, clear), engagement (does the HOOK grab you and the structure PULL you down
the page), humanVoice (a lively human wrote this, zero corporate filler), curiosity (honest curiosity, the
promise paid off), structure (the form's skeleton followed), infoGain (does the reader actually learn what
people think / what the debate is), seo (honest title, one natural keyword, NOT over-optimized), faqQuality,
completeness (uses the real posts; doesn't feel padded), accuracy (characterizations are anchored, not
overstated). Reward a strong hook, real audience posts used as beats, and a lively voice; punish a dull
summary lede, keyword-stuffing, generic filler, and quote-dumps. Score only — never rewrite. STRICT JSON:
{"score":0,"subscores":{"readability":0,"engagement":0,"humanVoice":0,"curiosity":0,"structure":0,"infoGain":0,
"seo":0,"faqQuality":0,"completeness":0,"accuracy":0},"strengths":[""],"weaknesses":[""]}`;

export async function gateInside({ article, trigger, angle, factBlock, judgeModel = MODELS.judge, chatImpl = chat } = {}) {
  const det = deterministicInside(article, factBlock, angle);
  const hardBlocks = [...det.hardBlocks];
  let cutClaims = [];

  const vbundle = buildVBundle(factBlock, trigger);

  // quoteGuard — every quoted phrase (incl. in takeaways/faq/fanConsensus/connections) must be real.
  const extendedBody = [
    article.body,
    ...(article.keyTakeaways || []),
    ...(article.faq || []).flatMap((f) => [f?.q, f?.a]),
    article.fanConsensus,
    ...(article.reactionsRender || []).map((r) => r?.connection),
    article.anchorStatement?.connection,
  ].filter(Boolean).join("\n");
  const qg = verifyQuotes({ ...article, body: extendedBody }, vbundle);
  if (!qg.ok) hardBlocks.push(...qg.badQuotes.map((q) => `fabricated-quote: "${String(q).slice(0, 60)}…"`));

  // specificsGuard — hard-fact lock: a number/box-office/record the writer stated that isn't in the
  // anchors gets cut (crafted narrative has no numbers, so this only catches invented specifics).
  const sg = specificsGuard(article, vbundle.sources, { facts: [], sources: [], verification: { attribution: null } });
  if (!sg.ok) cutClaims.push(...sg.bad.map((b) => b.text));

  // Judge = readability + engagement (the KPI). Skipped when a fatal fact-lock block already exists.
  let j = { score: 0, subscores: {}, strengths: [], weaknesses: [] };
  const fatal = hardBlocks.some((b) => /invented-speaker|unverbatim|fabricated-quote|unknown-attribution/.test(b));
  if (!fatal) {
    try {
      const { data } = await chatImpl({
        model: judgeModel,
        system: RUBRIC,
        user: `ARTICLE JSON:\n${JSON.stringify({ title: article.title, dek: article.dek, body: article.body, keyTakeaways: article.keyTakeaways, faq: article.faq, fanConsensus: article.fanConsensus }, null, 1).slice(0, 16000)}\n\nTHE REAL POSTS IT WAS BUILT FROM:\n${vbundle.sources.at(-1).text.slice(0, 6000)}`,
        json: true, maxTokens: 900, temperature: 0,
      });
      if (data?.score != null) j = data;
    } catch { /* judge outage → score stays 0 → held, never auto-published */ }
    // ENGAGEMENT floors — this is how "readability + engagement first" is enforced.
    const s = j.subscores || {};
    for (const k of ["readability", "engagement", "humanVoice"]) {
      if (s[k] != null && s[k] < 5) hardBlocks.push(`soft-floor ${k} ${s[k]} < 5`);
    }
  }

  cutClaims = [...new Set(cutClaims.filter((c) => (c || "").length > 8))];
  return {
    score: j.score || 0,
    pass: (j.score || 0) >= GATE.publishMin && hardBlocks.length === 0,
    subscores: j.subscores || {},
    deterministic: det,
    hardBlocks,
    cutClaims,
    strengths: j.strengths || [],
    weaknesses: j.weaknesses || [],
  };
}

// Fixable = engagement soft-floors (a rewrite may lift them); everything else (a broken fact-lock) is a
// hard stop.
export function classifyInsideBlocks(blocks) {
  const fixable = blocks.filter((b) => /^soft-floor/.test(b));
  const block = blocks.filter((b) => !fixable.includes(b));
  return { block, fixable };
}
