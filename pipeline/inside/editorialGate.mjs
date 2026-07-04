// EDITORIAL GATE (inside) — a flash editor-in-chief over the HARVESTED material, before any
// writing money is spent. Catches what floors can't count: six "voices" that are really one wire
// quote re-worded, a ripple that's actually about a different event, a wrong form. Reject power;
// fail-SAFE on LLM error (the deterministic floors already passed — an editor outage shouldn't
// zero the lane).
import { chat } from "../lib/openrouter.mjs";
import { MODELS, toneFor } from "./config.inside.mjs";
import { norm } from "./reactionFinder.mjs";

// Cheap deterministic pre-check: if most quotes are near-identical token sets, the "many voices"
// are one statement echoing through syndication — reject before the LLM.
export function distinctQuoteRatio(factBlock) {
  const qs = [...factBlock.reactions, ...factBlock.aggregateFans].map((r) => new Set(norm(r.quote).split(" ")));
  if (qs.length < 2) return 1;
  let dup = 0, pairs = 0;
  for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) {
    pairs++;
    const inter = [...qs[i]].filter((w) => qs[j].has(w)).length;
    const uni = new Set([...qs[i], ...qs[j]]).size;
    if (uni && inter / uni > 0.8) dup++;
  }
  return pairs ? 1 - dup / pairs : 1;
}

const SYS = `You are the editor-in-chief of an inside-stories desk (confirmed reaction/ripple coverage).
You are shown the harvested on-record material for ONE proposed article. Decide if it is a REAL story.
REJECT when: the reactions are substantially one statement echoed across outlets; the material is about a
DIFFERENT event than stated; the material is thin PR with no genuine voices.
RETARGET instead of rejecting when the material IS a real story about THIS event but the proposed focus
names the wrong person: set retarget.focusEntity to the strongest harvested voice (their EXACT name as it
appears in the material) and retarget.angle to a corrected one-line angle. The story follows the material,
not the pitch. Do NOT reject for tone or writing concerns — that is a later gate. Output STRICT JSON only.`;

export async function insideEditorialGate({ trigger, angle, factBlock, factText, model = MODELS.judge, chatImpl = chat } = {}) {
  const ratio = distinctQuoteRatio(factBlock);
  if (factBlock.reactions.length >= 2 && ratio < 0.35)
    return { ran: true, reject: true, reason: `voices not distinct (echo ratio ${(1 - ratio).toFixed(2)})`, distinctVoices: false };

  const user = `PROPOSED ARTICLE — form: ${angle.form}; angle: ${angle.angle}; tone: ${toneFor(trigger)}
EVENT: ${trigger.parentTitle} (${trigger.eventType}; subject: ${trigger.primaryEntity})

HARVESTED MATERIAL:
${(factText || "").slice(0, 7000)}

JSON: {"isStory":true|false,"reject":true|false,"reason":"","distinctVoices":true|false,
"eventMatch":true|false,"formFits":true|false,
"retarget":{"focusEntity":"","angle":""} or null,
"eventSummary":"<=300 chars: the event + the ripple's shape, from THIS material only"}`;
  try {
    const { data } = await chatImpl({ model, system: SYS, user, json: true, maxTokens: 800, temperature: 0 });
    if (!data) return { ran: false, reject: false, reason: "no data" };
    const reject = !!data.reject || data.isStory === false || data.eventMatch === false;
    // Retarget is only honored when the new focus IS a harvested voice (deterministic check —
    // the editor may redirect the story, never invent a subject).
    let retarget = null;
    const rt = data.retarget;
    if (!reject && rt?.focusEntity) {
      const speakers = new Set(factBlock.reactions.map((r) => norm(r.speaker)).filter(Boolean));
      if (speakers.has(norm(rt.focusEntity))) retarget = { focusEntity: rt.focusEntity, angle: (rt.angle || "").slice(0, 200) };
    }
    return {
      ran: true,
      reject,
      reason: data.reason || (reject ? "editor rejected" : ""),
      distinctVoices: data.distinctVoices !== false,
      retarget,
      eventSummary: (data.eventSummary || "").slice(0, 400),
    };
  } catch (e) {
    return { ran: false, reject: false, reason: `editorial error: ${String(e?.message || e).slice(0, 80)}` };
  }
}
