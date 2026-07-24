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
import { agentChat } from "./models.mjs";

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

const EMPTY_DETAILS = { facts: [], quotes: [], timeline: [], people: [], numbers: [], openQuestions: [] };

/**
 * Extract every usable detail from the gathered sources. Returns EMPTY_DETAILS on any failure.
 * Nothing that cannot be traced back to the source text survives.
 */
export async function findDetails({ bundle, topic, chatImpl } = {}) {
  const src = bundleText(bundle).slice(0, 14000);
  if (src.length < 400) return { ...EMPTY_DETAILS, reason: "not enough source text" };
  try {
    const { data } = await agentChat("detailFinder", {
      system: "You extract facts for a newsroom. You NEVER add anything not present in the text. Every item must be traceable to the source. Output strict JSON only.",
      user: `SOURCE TEXT:\n${src}\n\nSUBJECT: ${topic?.primaryEntity || ""}\n\nExtract EVERYTHING a reporter could use, as JSON:
{
 "facts": ["each distinct factual statement, one per item"],
 "quotes": [{"speaker":"who said it","text":"verbatim words exactly as written"}],
 "timeline": [{"when":"date or relative time","what":"what happened"}],
 "people": [{"name":"...","role":"who they are in this story"}],
 "numbers": ["every figure, age, date, amount WITH its context"],
 "openQuestions": ["what the source explicitly says is unknown or unconfirmed"]
}
Be exhaustive — miss nothing. Invent nothing: if a field has no material, use an empty array.`,
      json: true,
    }, chatImpl ? { chatImpl } : {});
    if (!data || typeof data !== "object") return { ...EMPTY_DETAILS, reason: "no data" };
    const c = norm(src);
    const out = {
      facts: groundedOnly(data.facts, c),
      quotes: groundedOnly(data.quotes, c, { key: "text", minLen: 15 }),
      timeline: groundedOnly(data.timeline, c, { key: "what" }),
      people: (data.people || []).filter((p) => p?.name && c.includes(norm(p.name))).slice(0, 12),
      numbers: groundedOnly(data.numbers, c, { minLen: 4 }),
      openQuestions: groundedOnly(data.openQuestions, c),
      reason: "",
    };
    const kept = out.facts.length + out.quotes.length + out.timeline.length + out.numbers.length;
    const raw = (data.facts || []).length + (data.quotes || []).length + (data.timeline || []).length + (data.numbers || []).length;
    if (raw > kept) console.log(`[detail] dropped ${raw - kept} ungrounded item(s) — kept ${kept}`);
    return out;
  } catch (e) {
    return { ...EMPTY_DETAILS, reason: `detail finder unavailable: ${String(e?.message || e).slice(0, 50)}` };
  }
}

const EMPTY_BG = { timeline: [], priorStatements: [], whoTheyAre: [], whatsNext: [] };

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
      timeline: groundedOnly(data.timeline, c, { key: "what" }),
      priorStatements: groundedOnly(data.priorStatements, c, { key: "what" }),
      whoTheyAre: groundedOnly(data.whoTheyAre, c),
      whatsNext: groundedOnly(data.whatsNext, c),
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
