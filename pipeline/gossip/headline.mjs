// GOSSIP — HEADLINE AGENT (Phase 2). Best-of-3 candidate sets for the SEARCH-facing fields — metaTitle,
// metaDescription, dek — judged by a cheap CTR/contract judge, then hard-gated deterministically:
//   • a candidate may only REPHRASE the article's own verified content — any number/year/money it carries
//     must already exist in the article or the bundle (no post-verify inventions can ship);
//   • metaTitle/metaDescription must pass the render-contract validators (45–55 name-first complete clause;
//     140–160 full sentence ≤160) from seo.mjs;
//   • any failure falls back to the writer's original field — this stage can only improve, never break.
// The reader-facing H1 (article.title) is NOT touched here: it already passed the accuracy gates.
// All LLM traffic through agentChat("headline"/"headlineJudge") — metered, cheap, fail-open.
import { agentChat } from "./models.mjs";
import { validMetaTitle, validMetaDesc } from "./seo.mjs";

// Every number-ish specific in `s` must already appear in `corpus` (article + bundle) — else the candidate
// invented one. Years, money, counts; commas/plain both checked.
export function numbersGrounded(s, corpus) {
  const norm = (x) => String(x || "").replace(/,/g, "");
  const c = norm(corpus).toLowerCase();
  const nums = String(s || "").match(/[$€£]?\d[\d,]*(?:\.\d+)?%?/g) || [];
  return nums.every((n) => c.includes(norm(n).toLowerCase()));
}

// Every multi-word capitalized span in `s` must be grounded in the corpus — a rephrase can never introduce a
// person/show the verified article doesn't contain (a wrong name is the worst class of headline error).
// Title-Case headlines legitimately capitalize common words ("Private Malibu Wedding"), so a span passes if the
// FULL span appears, OR every content word of it appears by 5-char stem (private→"priva", married→"marri") —
// a genuinely new name ("Taylor Swift" in a Star A story) still fails because its stems are absent.
export function namesGrounded(s, corpus) {
  const c = String(corpus || "").toLowerCase();
  const spans = String(s || "").match(/[A-ZÀ-Þ][a-zà-ÿA-Z.'’-]+(?:\s+[A-ZÀ-Þ][a-zà-ÿA-Z.'’-]+)+/gu) || [];
  return spans.every((span) => {
    if (c.includes(span.toLowerCase())) return true;
    const words = span.toLowerCase().split(/\s+/).filter((w) => w.replace(/[^a-zà-ÿ]/g, "").length >= 4);
    return words.every((w) => c.includes(w.slice(0, 5)));
  });
}
export const grounded = (s, corpus) => numbersGrounded(s, corpus) && namesGrounded(s, corpus);

const SYS = `You are the headline editor on a celebrity news desk. You get a FINISHED, fact-checked article and write 3 alternative sets of its SEARCH-facing fields. You may ONLY rephrase what the article already says — never add a fact, number, date, or name that is not in the article. No clickbait, no curiosity-gap, no superlatives ("shocking", "slams", "you won't believe"): the Feb-2026 Discover classifier suppresses them. Output STRICT JSON only.`;

function buildGenPrompt(article, topic) {
  return `ARTICLE (finished + verified — rephrase ONLY, add nothing):
TITLE: ${article.title}
DEK: ${article.dek || ""}
BODY:
${String(article.body || "").slice(0, 3500)}

SUBJECT: ${topic?.primaryEntity || ""}

Write 3 candidate SETS. Rules per field:
- metaTitle: 45–55 chars. START with the subject's NAME, then the hook — a COMPLETE clause, phrased the way a person would GOOGLE it. No site name. Never cut mid-thought.
- metaDescription: 140–160 chars. A teaser that EARNS the click: the hook + one concrete fact from the article (a name/number/what happened). One or two complete sentences ending in a period. Must NOT restate the dek.
- dek: ≤170 chars, on-page standfirst with a little wit — ADDS something beyond the headline.

Return STRICT JSON:
{ "candidates": [ { "metaTitle": "...", "metaDescription": "...", "dek": "..." }, { ... }, { ... } ] }`;
}

const JUDGE_SYS = `You are a search-CTR judge for celebrity news. Score each candidate SET 0-100 for: would a real searcher click it (name-first, concrete, specific), does it read as a complete natural phrase (no cut-offs), zero clickbait/superlatives, and metaDescription distinct from the dek. Output STRICT JSON only.`;

function buildJudgePrompt(cands) {
  return `CANDIDATE SETS:
${cands.map((c, i) => `[${i}] metaTitle: ${c.metaTitle}\n    metaDescription: ${c.metaDescription}\n    dek: ${c.dek}`).join("\n")}

Return STRICT JSON: { "best": <index>, "scores": [n, n, n], "why": "one clause" }`;
}

// Refine article.metaTitle / metaDescription / dek in place (field-by-field, each hard-gated; originals kept
// on any failure). Returns { changed: [fields], candidates } for the run report. Fail-open everywhere.
export async function refineHeadline({ article, bundle, topic, chatImpl } = {}) {
  const out = { changed: [], candidates: 0 };
  try {
    const opts = chatImpl ? { chatImpl } : {};
    const { data } = await agentChat("headline", { system: SYS, user: buildGenPrompt(article, topic), json: true }, opts);
    let cands = (Array.isArray(data?.candidates) ? data.candidates : []).filter((c) => c && (c.metaTitle || c.metaDescription || c.dek));
    if (!cands.length) return out;
    out.candidates = cands.length;
    // judge picks the best set (fail-open to candidate 0)
    let bestIdx = 0;
    if (cands.length > 1) {
      try {
        const { data: j } = await agentChat("headlineJudge", { system: JUDGE_SYS, user: buildJudgePrompt(cands), json: true }, opts);
        if (Number.isInteger(j?.best) && j.best >= 0 && j.best < cands.length) bestIdx = j.best;
      } catch { /* keep 0 */ }
    }
    const best = cands[bestIdx];
    // the grounding corpus: the article's own reader-facing text + the bundle sources
    const corpus = [article.title, article.dek, article.body, ...(bundle?.sources || []).map((s) => s.text)].join("\n");
    const names = [topic?.primaryEntity, ...(topic?.coSubjects || [])].filter(Boolean);

    // metaTitle: render contract + grounded numbers → else keep the writer's
    const mt = String(best.metaTitle || "").trim();
    if (mt && validMetaTitle(mt, names) && grounded(mt, corpus) && mt !== article.metaTitle) {
      article.metaTitle = mt; out.changed.push("metaTitle");
    }
    // metaDescription: ≤160 contract + grounded + distinct from dek → else keep
    const md = String(best.metaDescription || "").trim();
    if (md && validMetaDesc(md, article.dek) && grounded(md, corpus) && md !== article.metaDescription) {
      article.metaDescription = md; out.changed.push("metaDescription");
    }
    // dek: bounded + grounded + differs from the headline → else keep
    const dek = String(best.dek || "").trim();
    if (dek && dek.length >= 40 && dek.length <= 170 && grounded(dek, corpus) && dek.toLowerCase() !== String(article.title || "").toLowerCase()) {
      article.dek = dek; out.changed.push("dek");
    }
    return out;
  } catch {
    return out; // fail-open: originals stand
  }
}
