// GATE (inside) — deterministic anti-fabrication wall first, then the reused news verify chain
// (verifyGate entailment + quoteGuard + specificsGuard), then a SCORE-ONLY judge with the inside
// rubric. This lane is ~all quotes, so quote fidelity is checked THREE independent ways:
// (1) reactionsRender vs fact block (deterministic, here), (2) quoteGuard on the whole article,
// (3) verifyGate entailment per claim. A single invented speaker or altered quote = hard block.
import { chat } from "../lib/openrouter.mjs";
import { verifyGate } from "../lib/verifyGate.mjs";
import { verifyQuotes } from "../lib/quoteGuard.mjs";
import { specificsGuard } from "../lib/specificsGuard.mjs";
import { MODELS, GATE, FORMS, toneFor } from "./config.inside.mjs";
import { norm, quoteIsVerbatim } from "./reactionFinder.mjs";
import { buildVBundle } from "./reactionFinder.mjs";

export function deterministicInside(article, factBlock, angle) {
  const hardBlocks = [];
  const body = article?.body || "";
  const words = body.split(/\s+/).filter(Boolean).length;
  const form = FORMS[angle.form];

  // Speaker guard: every rendered voice must exist in the harvest, and every quote must be a
  // substring of a SINGLE harvested quote BY THAT SPEAKER (a per-quote haystack: merging two
  // adjacent quotes can never pass; a fan quote can never be re-attributed to a celebrity).
  // An invented or misattributed voice is the lane's cardinal sin — fatal, not fixable.
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
  const AGGREGATE = /^(a fan|one fan|fans?( on [a-z]+)?|)$/i;
  for (const r of article?.reactionsRender || []) {
    if (!r?.quote) continue;
    const isAggregate = AGGREGATE.test(r.speaker || "");
    if (!isAggregate && !knownSpeakers.has(norm(r.speaker)))
      hardBlocks.push(`invented-speaker: "${r.speaker}" not in harvest`);
    else if (!quoteIsVerbatim(r.quote, isAggregate ? fanPool : bySpeaker.get(norm(r.speaker)) || []))
      hardBlocks.push(`${isAggregate ? "unverbatim-fan-quote" : "misattributed-or-unverbatim-quote"}: "${String(r.quote).slice(0, 60)}…" (${r.speaker || "fan"})`);
  }
  const anchor = article?.anchorStatement;
  if (anchor?.speaker && !knownSpeakers.has(norm(anchor.speaker)))
    hardBlocks.push(`invented-speaker: anchor "${anchor.speaker}" not in harvest`);
  else if (anchor?.quote && !quoteIsVerbatim(anchor.quote, bySpeaker.get(norm(anchor.speaker)) || []))
    hardBlocks.push(`unverbatim-anchor-quote`);

  // Body-prose quote wall: every quoted span in title/dek/body must be verbatim from a SINGLE
  // harvest quote — prose can't smuggle what the card list can't. (quoteGuard's 85% token bag
  // still runs later; this is the strict lane-specific wall.)
  // Quote spans never cross a line break — cuts can orphan a quote mark, and letting the regex
  // pair it with one in a LATER paragraph turns headings/prose into phantom "quotes" (live-hit).
  const prose = [article?.title, article?.dek, body].filter(Boolean).join("\n");
  for (const m of prose.matchAll(/["“]([^"”\n]{12,400})["”]/g)) {
    // House style puts terminal punctuation INSIDE the closing quote ("…with me always.") while
    // harvest quotes are stored without it — that punctuation is orthography, not quote content.
    // Strip it before the check so the wall blocks altered WORDS, never a house-style period.
    const core = m[1].replace(/[\s.,!?;:…]+$/, "");
    if (core.length < 12) continue;
    if (!quoteIsVerbatim(core, anyPool))
      hardBlocks.push(`unverbatim-prose-quote: "${m[1].slice(0, 60)}…"`);
  }
  // Attribution scan: "<Name> said/wrote/…" in prose where <Name> is nobody from the harvest —
  // an invented voice living only in the body. Aggregate fan phrasing and source outlets are fine.
  const outletish = new Set((factBlock.sources || []).flatMap((s) => [norm(s.owner), norm(s.domain), norm((s.domain || "").split(".")[0])]).filter(Boolean));
  for (const m of prose.matchAll(/\b([A-Z][a-zA-Z'’.-]+(?: [A-Z][a-zA-Z'’.-]+){1,2})\s+(?:also\s+|later\s+|then\s+)?(said|says|wrote|writes|posted|shared|told|added|continued|captioned|commented|responded|replied|recalled|admitted|announced)\b/g)) {
    const name = norm(m[1]);
    if (knownSpeakers.has(name) || outletish.has(name)) continue;
    // partial-name mentions of a known speaker ("Streep recalled…") are fine
    if ([...knownSpeakers].some((k) => k.includes(name) || name.includes(k))) continue;
    hardBlocks.push(`unknown-attribution: "${m[1]} ${m[2]}" — not a harvested voice`);
  }

  // Verbatim-ratio cap: quoted characters ≤25% of body (target ≤15%; >25% = quote-dump, fatal).
  const quotedChars = (body.match(/"[^"\n]{8,400}"|“[^”\n]{8,400}”/g) || []).join("").length;
  const ratio = body.length ? quotedChars / body.length : 0;
  if (ratio > 0.25) hardBlocks.push(`quote-ratio ${(ratio * 100).toFixed(0)}% > 25%`);

  // Back-to-back quotes: a closing quote followed (within 3 chars) by an opening one.
  if (/["”]\s{0,3}["“]/.test(body.replace(/\n/g, " "))) hardBlocks.push("back-to-back-quotes");

  // Sentiment honesty (fan-pulse): a "divided" claim requires both stances in the HARVEST.
  if (angle.form === "fan-pulse") {
    const claimsDivided = /divided|split|torn/i.test((article?.fanConsensus || "") + (article?.title || ""));
    if (claimsDivided && !factBlock.stats.divided) hardBlocks.push("divided-claim-without-both-sides");
  }

  // Named-fan guard: no fan handle/name may appear — fan quotes are aggregate-attributed only.
  // (Named voices are fine; this catches "@user123 wrote" / "fan Jane Doe said".)
  if (/@[A-Za-z0-9_]{3,15}\b/.test(body)) hardBlocks.push("fan-handle-in-prose");

  const h2s = (body.match(/^##\s/gm) || []).length;
  // Grounding-matched word floor (the news lane's proven pattern): a 1-2 voice harvest honestly
  // fills ~250 words — forcing 300+ would fight the "never pad past the material" writer rule
  // and manufacture filler. Rich harvests keep the full form floor.
  // single-voice is inherently a brief (one statement) — the news lane's brief floor applies
  // regardless of how many voices the wider harvest happened to catch.
  const voices = (factBlock.stats?.namedVoices || 0) + (factBlock.stats?.fanPosts || 0);
  const floorWords = voices <= 2 || angle.form === "single-voice" ? 220 : Math.min(form.words[0], 300);
  if (words < floorWords) hardBlocks.push(`words ${words} < ${floorWords}`);

  return { words, h2s, quoteRatio: ratio, hardBlocks };
}

const RUBRIC = `Score this INSIDE-STORIES article (a confirmed reaction/ripple piece) 0-100 with subscores 0-10:
accuracy (claims match the facts), readability, humanVoice (warm, human, zero corporate filler),
phrasing, curiosity (does the structure PULL you down the page: signposted best-for-last, question H2s answered
immediately, teases resolved), structure (the form's skeleton followed), infoGain (would a fan learn the ripple
here vs anywhere else), seo (honest title, one clear keyword, PAA-shaped FAQ), faqQuality, completeness
(uses the material; doesn't pad past it).
The QUOTES carry the piece: reward connection-first setups and paraphrase-then-quote rhythm; punish quote-dumps,
adjective-soup, generic PR quotes featured as payoffs, chronology-as-structure, and any tease that never resolves.
TONE must match: {TONE}. Score only — never rewrite. STRICT JSON: {"score":0,"subscores":{"accuracy":0,
"readability":0,"humanVoice":0,"phrasing":0,"curiosity":0,"structure":0,"infoGain":0,"seo":0,"faqQuality":0,
"completeness":0},"strengths":[""],"weaknesses":[""]}`;

export async function gateInside({ article, trigger, angle, factBlock, judgeModel = MODELS.judge, chatImpl = chat } = {}) {
  const det = deterministicInside(article, factBlock, angle);
  const hardBlocks = [...det.hardBlocks];
  let cutClaims = [];

  // Reused news verify chain over the harvest-grounded bundle.
  const vbundle = buildVBundle(factBlock, trigger);
  let vg = null;
  try {
    vg = await verifyGate({ article, bundle: vbundle, model: MODELS.verify });
    if (vg.verdict === "BLOCK") hardBlocks.push(`verify-gate BLOCK: ${(vg.unsupported || []).slice(0, 2).map((r) => r.claim).join(" | ") || "fabrication/contradiction"}`);
    if (vg.verdict === "CUT") {
      hardBlocks.push(`verify-gate CUT: ${(vg.unsupported || []).length} unsupported`);
      cutClaims.push(...(vg.unsupported || []).map((r) => r.claim));
    }
  } catch (e) {
    hardBlocks.push(`verify-gate error: ${String(e?.message || e).slice(0, 80)}`);
  }

  // quoteGuard scans title/dek/body — widen its surface so quotes hiding in keyTakeaways, FAQ,
  // fanConsensus, or writer-authored connection lines face the same check.
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

  const topicShim = { facts: [], sources: [], verification: { attribution: null } };
  const sg = specificsGuard(article, vbundle.sources, topicShim);
  if (!sg.ok) cutClaims.push(...sg.bad.map((b) => b.text));

  // Judge — score-only, skipped when a fatal block already exists (no money on a dead draft).
  let j = { score: 0, subscores: {}, strengths: [], weaknesses: [] };
  const fatal = hardBlocks.some((b) => /invented-speaker|unverbatim|fabricated-quote|verify-gate BLOCK/.test(b));
  if (!fatal) {
    try {
      const { data } = await chatImpl({
        model: judgeModel,
        system: RUBRIC.replace("{TONE}", toneFor(trigger)),
        user: `ARTICLE JSON:\n${JSON.stringify({ title: article.title, dek: article.dek, body: article.body, keyTakeaways: article.keyTakeaways, faq: article.faq, fanConsensus: article.fanConsensus }, null, 1).slice(0, 16000)}\n\nFACTS IT WAS LIMITED TO:\n${vbundle.sources.at(-1).text.slice(0, 6000)}`,
        json: true, maxTokens: 900, temperature: 0,
      });
      if (data?.score != null) j = data;
    } catch { /* judge outage → score stays 0 → held, never auto-published */ }
    const s = j.subscores || {};
    for (const k of ["readability", "humanVoice", "phrasing", "curiosity"]) {
      if (s[k] != null && s[k] < 5) hardBlocks.push(`soft-floor ${k} ${s[k]} < 5`);
    }
    if (s.infoGain != null && s.infoGain < GATE.infoGainMin) hardBlocks.push(`soft-floor infoGain ${s.infoGain} < ${GATE.infoGainMin}`);
  }

  cutClaims = [...new Set(cutClaims.filter((c) => (c || "").length > 8))];
  return {
    score: j.score || 0,
    pass: (j.score || 0) >= GATE.publishMin && hardBlocks.length === 0,
    subscores: j.subscores || {},
    deterministic: det,
    hardBlocks,
    cutClaims,
    vgVerdict: vg?.verdict || null,
    strengths: j.strengths || [],
    weaknesses: j.weaknesses || [],
  };
}

// Same block taxonomy as news run.mjs: verify-gate CUTs are fixable-by-cutting; everything
// fatal (invented voice, unverbatim quote, contradiction) is a hard stop.
export function classifyInsideBlocks(blocks) {
  const fixable = blocks.filter((b) => /^verify-gate CUT:|^soft-floor/.test(b));
  const block = blocks.filter((b) => !fixable.includes(b));
  return { block, fixable };
}
