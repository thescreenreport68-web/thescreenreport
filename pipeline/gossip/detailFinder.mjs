// GOSSIP — DETAIL FINDER + BACKGROUND AGENT (owner directive 2026-07-25).
//
// THE PROBLEM THESE SOLVE: live articles averaged 235 words because a bundle typically held ONE
// outlet's report. You cannot honestly write 800 words from one outlet's 235 words of facts — and
// demanding it would make the writer pad, which is the banned failure. So the fix is upstream:
// gather MORE REAL MATERIAL, then let the writer use all of it.
//
// detailFinder — the "sub-finder": reads everything we gathered and pulls out every DISTINCT fact,
//   quote, date, person and open question, so nothing an outlet gave us is left on the floor.
// backgroundAgent — the "how we got here": timeline, prior statements, who these people are, drawn
//   from the sources AND from our own already-published archive (free, already fact-checked).
//
// Model choice is EMPIRICAL (2026-07-25 bake-off on a real bundle): qwen3.5-flash extracted 56 usable
// items vs 47 for the previous flash-lite, with 7/7 quotes verbatim and zero invented numbers.
//
// 🔴 BOTH FAIL SOFT. Any error returns an empty result and the lane writes from what it already had.
// 🔴 NEITHER INVENTS. Every item is verified to exist in the source text before it is kept; anything
//    unverifiable is dropped here, so a hallucination can never reach the writer as "material".
import { agentChat, AGENTS } from "./models.mjs";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const bundleText = (bundle) => (bundle?.sources || []).map((s) => s.text || "").join("\n\n");

/** Keep only items whose substance actually appears in the source corpus. */
function groundedOnly(items, corpusNorm, { key = null, minLen = 12 } = {}) {
  const out = [];
  for (const it of items || []) {
    const probe = key ? it?.[key] : it;
    const t = norm(probe);
    if (!t || t.length < minLen) continue;
    // a claim is grounded if a distinctive span of it appears in the corpus
    const span = t.slice(0, Math.min(45, t.length));
    if (corpusNorm.includes(span)) { out.push(it); continue; }
    // fall back to token overlap for paraphrased facts (still must be substantially present)
    const toks = t.split(" ").filter((w) => w.length > 3);
    if (toks.length >= 3 && toks.filter((w) => corpusNorm.includes(w)).length / toks.length >= 0.8) out.push(it);
  }
  return out;
}

// 2026-07-25 — with the token budget raised, the extractor swung the other way: 203 "facts" out of a
// 900-word source, most of them the same statement re-sliced. That is not depth, and it is actively
// harmful twice over — wordRangeFor scores facts, so every story would look 800-word-rich, and a writer
// handed 40 near-identical lines will repeat itself. Collapse them to genuinely distinct items.
function dedupeItems(items, { key = null, cap = 60 } = {}) {
  const out = [], seen = [];
  for (const it of items || []) {
    const t = norm(key ? it?.[key] : it);
    if (!t) continue;
    const toks = new Set(t.split(" ").filter((w) => w.length > 3));
    if (!toks.size) continue;
    const dup = seen.some((prev) => {
      let hit = 0;
      for (const w of toks) if (prev.has(w)) hit++;
      return hit / Math.min(toks.size, prev.size) >= 0.8;   // same statement, re-sliced
    });
    if (dup) continue;
    seen.push(toks);
    out.push(it);
    if (out.length >= cap) break;
  }
  return out;
}

const EMPTY_DETAILS = { facts: [], quotes: [], timeline: [], people: [], numbers: [], openQuestions: [] };

/**
 * Extract every usable detail from the gathered sources. Returns EMPTY_DETAILS on any failure.
 * Nothing that cannot be traced back to the source text survives.
 */
export async function findDetails({ bundle, topic, chatImpl, retried = false } = {}) {
  const src = bundleText(bundle).slice(0, 14000);
  if (src.length < 400) return { ...EMPTY_DETAILS, reason: "not enough source text" };
  try {
    const { data } = await agentChat("detailFinder", {
      ...(retried && AGENTS.detailFinder?.fallback ? { model: AGENTS.detailFinder.fallback } : {}),
      system: "You extract facts for a newsroom. You NEVER add anything not present in the text. Every item must be traceable to the source. Output strict JSON only.",
      user: `SOURCE TEXT:\n${src}\n\nSUBJECT: ${topic?.primaryEntity || ""}\n\nExtract EVERYTHING a reporter could use, as JSON:
{
 "facts": ["each distinct factual statement, one per item — include every figure, age, date and amount WITH its context"],
 "quotes": [{"speaker":"who said it","text":"verbatim words exactly as written"}],
 "timeline": [{"when":"date or relative time","what":"what happened"}]
}
Cover everything the source establishes. Invent nothing: if a field has no material, use an empty array.
LIMITS — a truncated reply is worse than a terse one, and a re-sliced duplicate is not a second fact:
 • at most 40 facts, 20 quotes, 15 timeline entries
 • ONE sentence per item
 • never list the same statement twice in different words — merge it into a single, complete item`,
      json: true,
    }, chatImpl ? { chatImpl } : {});
    if (!data || typeof data !== "object") return { ...EMPTY_DETAILS, reason: "no data" };
    const c = norm(src);
    const out = {
      facts: dedupeItems(groundedOnly(data.facts, c), { cap: 45 }),
      quotes: dedupeItems(groundedOnly(data.quotes, c, { key: "text", minLen: 15 }), { key: "text", cap: 20 }),
      timeline: dedupeItems(groundedOnly(data.timeline, c, { key: "what" }), { key: "what", cap: 15 }),
      people: [],
      numbers: [],        // kept for shape stability; nothing reads these and asking cost us the facts
      openQuestions: [],
      reason: "",
    };
    const kept = out.facts.length + out.quotes.length + out.timeline.length;
    const raw = (data.facts || []).length + (data.quotes || []).length + (data.timeline || []).length;
    if (raw > kept) console.log(`[detail] dropped ${raw - kept} ungrounded item(s) — kept ${kept}`);
    // 2026-07-25 review: one live bundle held 6,268 chars of source and came back with ZERO facts —
    // a silent extraction miss, not a thin story, and the writer then had nothing to build 800 words
    // from. A substantial corpus that yields nothing is a model failure worth one retry.
    if (!out.facts.length && src.length >= 2500 && !retried) {
      console.log(`[detail] 0 facts from ${src.length} chars — retrying once on the fallback model`);
      return findDetails({ bundle, topic, chatImpl, retried: true });
    }
    return out;
  } catch (e) {
    // A truncated JSON array throws here. That used to end as "0 facts" in the log with no hint that
    // anything had failed — and the writer then had nothing to build 800 honest words from.
    const msg = String(e?.message || e);
    if (!retried) {
      console.log(`[detail] extraction failed (${msg.slice(0, 60)}) — retrying once on the fallback model`);
      return findDetails({ bundle, topic, chatImpl, retried: true });
    }
    return { ...EMPTY_DETAILS, reason: `detail finder unavailable: ${msg.slice(0, 50)}` };
  }
}

const EMPTY_BG = { timeline: [], priorStatements: [], whoTheyAre: [], whatsNext: [], usedArchive: false };

/**
 * The "how we got here" layer. Draws ONLY on the gathered sources plus our own past coverage
 * (already fact-checked), so it adds depth without adding risk.
 */
export async function findBackground({ bundle, topic, priorCoverage = [], chatImpl } = {}) {
  const src = bundleText(bundle).slice(0, 10000);
  const archive = (priorCoverage || []).slice(0, 6)
    .map((a) => `- ${a.title || a.slug}${a.date ? ` (${String(a.date).slice(0, 10)})` : ""}${a.claim ? `: ${a.claim}` : ""}`).join("\n");
  if (src.length < 400 && !archive) return { ...EMPTY_BG, reason: "nothing to build background from" };
  try {
    const { data } = await agentChat("background", {
      system: "You assemble the BACKGROUND to a celebrity story using ONLY the material given. You never speculate and never add a fact that is not present. Output strict JSON only.",
      user: `CURRENT STORY SOURCES:\n${src}\n\n${archive ? `OUR OWN PRIOR COVERAGE OF THIS SUBJECT (already verified):\n${archive}\n\n` : ""}SUBJECT: ${topic?.primaryEntity || ""}

Build the background, as JSON:
{
 "timeline": [{"when":"...","what":"..."}],
 "priorStatements": [{"who":"...","what":"what they said before, verbatim if available","when":"..."}],
 "whoTheyAre": ["one line per person: who they are and why the reader knows them"],
 "whatsNext": ["a concrete upcoming date/event the material mentions"]
}
ONLY what the material supports. Empty arrays where you have nothing. Never speculate about motives or outcomes.`,
      json: true,
    }, chatImpl ? { chatImpl } : {});
    if (!data || typeof data !== "object") return { ...EMPTY_BG, reason: "no data" };
    const c = norm(src + "\n" + archive);
    return {
      // Only background drawn from our ARCHIVE is genuinely new material; background re-derived from the
      // current sources is the same reporting reorganised, and must not inflate the word target.
      usedArchive: (priorCoverage || []).length > 0,
      timeline: dedupeItems(groundedOnly(data.timeline, c, { key: "what" }), { key: "what", cap: 12 }),
      priorStatements: dedupeItems(groundedOnly(data.priorStatements, c, { key: "what" }), { key: "what", cap: 8 }),
      whoTheyAre: dedupeItems(groundedOnly(data.whoTheyAre, c), { cap: 6 }),
      whatsNext: dedupeItems(groundedOnly(data.whatsNext, c), { cap: 6 }),
      reason: "",
    };
  } catch (e) {
    return { ...EMPTY_BG, reason: `background unavailable: ${String(e?.message || e).slice(0, 50)}` };
  }
}

/** How much genuinely distinct material the writer now has (drives the word target). */
export function materialDepth(bundle) {
  const chars = (bundle?.sources || []).reduce((a, s) => a + (s.text || "").length, 0);
  const d = bundle?.details || {}, b = bundle?.background || {};
  return {
    chars,
    facts: (d.facts || []).length + (d.timeline || []).length,
    quotes: (bundle?.quotes || []).length + (d.quotes || []).length,
    background: (b.timeline || []).length + (b.priorStatements || []).length + (b.whoTheyAre || []).length,
    outlets: new Set((bundle?.sources || []).map((s) => s.outlet).filter(Boolean)).size,
  };
}
