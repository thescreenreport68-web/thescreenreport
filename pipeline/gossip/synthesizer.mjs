// GOSSIP — SYNTHESIZER (Phase 2 of GOSSIP_MULTI_AGENT_UPGRADE_PLAN.md). Reads the WHOLE gathered bundle and
// hands the writer a digested BRIEF — hook, mood, the beat outline, the must-include specifics, the angle —
// plus QUOTE ANCHOR CARDS the writer references BY ID ONLY (inside-lane proven: "a card the writer never
// types cannot mutate"). The brief itself quotes nothing, so nothing can drift.
//
// FAIL-OPEN: any synthesizer fault ⇒ brief null and the writer works from the raw bundle exactly as before —
// Phase 2 must never reduce yield. All LLM traffic through agentChat("synthesizer") (v4-flash, metered).
import { agentChat } from "./models.mjs";

// ── ANCHOR CARDS (deterministic — code, not LLM) ─────────────────────────────────────────────────────────
// The bundle's quotable corpus (seed sources only; corroborators contribute NO quotes) becomes numbered cards:
// [{ id: "Q1", text, outlet }]. The writer includes a quote by writing the TOKEN (⟦Q1⟧); substituteAnchors()
// injects the exact text — the writer never types quote words, so verbatim-ness is structural, not prompted.
export function buildAnchors(bundle, { max = 8 } = {}) {
  const anchors = [];
  const seen = new Set();
  for (const s of bundle?.sources || []) {
    if (s.corroborating) continue;
    for (const q of s.quotes || []) {
      const t = String(q || "").trim();
      if (!t || t.length < 8 || seen.has(t)) continue;
      seen.add(t);
      anchors.push({ id: `Q${anchors.length + 1}`, text: t, outlet: s.outlet || "" });
      if (anchors.length >= max) return anchors;
    }
  }
  return anchors;
}

// Replace anchor TOKENS with the exact quoted text everywhere reader-facing. Tolerant of the token variants a
// cheap model actually produces (⟦Q1⟧, [Q1], [[Q1]], {{Q1}}, (Q1) when clearly a token), avoids double-quoting
// when the writer wrapped the token in its own quotation marks, and STRIPS any unreplaced token so a stray
// "as ⟦Q9⟧ said" can never ship. Returns the article (mutated).
export function substituteAnchors(article, anchors = []) {
  if (!article || !anchors.length) { stripTokens(article); return article; }
  const fields = ["body", "pullQuote", "dek"];
  for (const f of fields) {
    if (!article[f]) continue;
    let s = String(article[f]);
    for (const a of anchors) {
      const tok = `(?:⟦|\\[\\[|\\{\\{|\\[|\\()\\s*${a.id}\\s*(?:⟧|\\]\\]|\\}\\}|\\]|\\))`;
      // 1) token already inside the writer's own quotation marks → inject bare text
      s = s.replace(new RegExp(`(["“])\\s*${tok}\\s*(["”])`, "g"), `"${a.text}"`);
      // 2) bare token → inject the quote WITH quotation marks
      s = s.replace(new RegExp(tok, "g"), `"${a.text}"`);
    }
    article[f] = s;
  }
  stripTokens(article);
  return article;
}
function stripTokens(article) {
  if (!article) return;
  const TOK = /(?:⟦|\[\[|\{\{)\s*Q\d+\s*(?:⟧|\]\]|\}\})|(?<![\w"])\[Q\d+\](?![\w"])/g;
  for (const f of ["body", "pullQuote", "dek"]) {
    if (!article[f]) continue;
    article[f] = String(article[f]).replace(TOK, "").replace(/[ \t]{2,}/g, " ").replace(/ ([,.;!?])/g, "$1");
  }
}

// ── THE BRIEF (v4-flash, analytical not creative) ────────────────────────────────────────────────────────
const SYS = `You are the research editor on a celebrity-gossip desk. You read the gathered source material and hand the WRITER a tight brief. You NEVER quote source text verbatim — you reference the numbered QUOTE CARDS by id only (the writer inserts them by id; the system injects the exact text). Facts in the brief must come from the sources; invent nothing. Output STRICT JSON only.`;

export function buildBriefPrompt(bundle, frame, topic, anchors) {
  const srcBlock = (bundle.sources || [])
    .map((s, i) => `[S${i + 1}] ${s.outlet}${s.corroborating ? " (corroborating)" : ""} — ${(s.text || "").slice(0, 1800)}`)
    .join("\n\n");
  const cardBlock = anchors.length
    ? anchors.map((a) => `${a.id} (${a.outlet}): "${a.text.slice(0, 160)}"`).join("\n")
    : "(no verbatim quotes available)";
  const user = `STORY: ${topic.angle || topic.claim || topic.title || ""}
ABOUT: ${topic.primaryEntity || bundle.entity || ""}${(topic.coSubjects || []).length ? ` (with ${topic.coSubjects.join(", ")})` : ""}
STATUS: ${frame?.uiLabel || ""}

SOURCES:
${srcBlock || "(none)"}

QUOTE CARDS (reference by id only):
${cardBlock}

Return STRICT JSON:
{ "hook": "the single most arresting TRUE detail to open on (one sentence, no quotes)",
  "mood": "playful|neutral|serious — match the story's severity",
  "beats": ["4-6 one-line beats in the strongest telling order: trigger → specifics → context/timeline → reaction → what's unconfirmed/next"],
  "useAnchors": ["ids of the 1-3 STRONGEST quote cards worth featuring, e.g. \\"Q1\\" — [] if none are strong"],
  "mustInclude": ["3-6 concrete specifics the piece MUST carry (names/dates/numbers/places exactly as sourced)"],
  "angle": "one sentence: the take that makes this piece worth reading vs a bare rewrite",
  "seoKeyword": "the one phrase a searcher would type for this story" }`;
  return { system: SYS, user };
}

export async function synthesize({ bundle, frame, topic, anchors, chatImpl } = {}) {
  try {
    const { system, user } = buildBriefPrompt(bundle, frame, topic, anchors || []);
    const { data } = await agentChat("synthesizer", { system, user, json: true }, chatImpl ? { chatImpl } : {});
    if (!data || !Array.isArray(data.beats) || !data.beats.length) return null;
    // clamp anchor ids against the real card list — never trust model output for routing
    const valid = new Set((anchors || []).map((a) => a.id));
    data.useAnchors = (Array.isArray(data.useAnchors) ? data.useAnchors : []).filter((id) => valid.has(id));
    return data;
  } catch {
    return null; // fail-open: no brief → the writer works from the raw bundle as before
  }
}
