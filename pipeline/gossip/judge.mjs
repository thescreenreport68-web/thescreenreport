// GOSSIP — JUDGE (scoring). A cheap LLM scores each PUBLISHED gossip article so the automation reports a quality
// score to compare against an independent human/AI score. SCORE-ONLY — the legal + quality gates already decide
// publish/block; this adds a 0-100 craft+safety read. NEVER Opus (owner hard rule); flash-lite is PROMPTED to do
// the gossip-craft + safety judging an expensive model would.
import { agentChat } from "./models.mjs";

const RUBRIC = `You are a sharp entertainment editor scoring a CELEBRITY GOSSIP article for The Screen Report. Score by GOSSIP standards (Page Six / TMZ energy), NOT dry-news standards. Judge each 0-10:
- VOICE/ENGAGEMENT: punchy, fun, a real curiosity hook, makes you want to read on; NOT stiff, NOT generic-AI.
- READABILITY: tight, skimmable, short paragraphs, plain words.
- SAFETY/ACCURACY (most important, scored ONLY on accuracy — NOT on craft): EVERY claim about a person is attributed ("per [Outlet]", "a source says", "fans noticed") or framed as opinion/speculation — NEVER stated as the writer's own fact; NO fact, quote, number, or name that is not supported by the SOURCE BUNDLE; the non-confirmation note is present when the story is unconfirmed; no damaging assertion stated as fact.
  SCORING RULE for the safety subscore: a clean, well-attributed piece scores 8-10 EVEN IF the writing is plain, formal, or a little dry — do NOT lower the safety score for voice/structure/readability (those are their OWN subscores). Reserve a safety score BELOW 5 for a REAL accuracy problem ONLY: a fabricated/misquoted quote, an unattributed damaging claim, or a specific fact NOT in the bundle. If you see a false claim or fabrication, say so explicitly in "issues" (e.g. "X is not supported by the bundle").
- ATTRIBUTION/HEDGING: sources named; for shade/feuds, hedges ("appears to", "seemingly", "thinly veiled") used.
- STRUCTURE: hook -> trigger -> what we know vs unconfirmed -> context; a pull-quote.`;

export async function judgeGossip({ article, bundle, frame, model = null }) {
  const sources = (bundle?.sources || []).map((s, i) => `[S${i + 1}] ${s.outlet}: ${(s.text || "").slice(0, 1500)}`).join("\n\n");
  const user = `${RUBRIC}

SOURCE BUNDLE (the ONLY facts the writer was allowed to use — check the article against it):
${sources || "(none provided)"}

ARTICLE:
${JSON.stringify({ title: article.title, dek: article.dek, body: article.body, pullQuote: article.pullQuote || article.gossipPull, whatWeKnow: article.whatWeKnow, whatWeDont: article.whatWeDont }).slice(0, 9000)}

Tier: ${frame?.tier} | needs-disclaimer: ${frame?.needsDisclaimer}

Return STRICT JSON:
{ "score": 0-100 (gossip quality + safety; a stiff/generic OR unsafe piece scores LOW),
  "subscores": {"voice":0-10,"readability":0-10,"safety":0-10,"attribution":0-10,"structure":0-10},
  "issues": ["any problem: unattributed claim, a fact not in the bundle, missing disclaimer, stiff/AI voice, etc."],
  "strengths": ["..."] }`;
  const { data } = await agentChat("judge", {
    model: model || undefined,
    system: "You are a demanding gossip editor. Score craft AND safety, be specific about issues. Output strict JSON only.",
    user,
    json: true,
  });
  return data;
}
