// ANGLES — propose the maximal ripple-angle set for one trigger. Successor to find/expand.mjs:
// same tone-safety DNA, but proposals are CANDIDATES ONLY — nothing is written until
// reactionFinder actually harvests real on-record reactions for the angle (the grounding gate
// that makes "go maximal" safe). Cheap classifier model; strict JSON.
import { chat } from "../lib/openrouter.mjs";
import { MODELS, FORMS, MAX_ANGLES_PER_EVENT, toneFor } from "./config.inside.mjs";

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

const FORM_BRIEF = {
  "peer-tributes": "many NAMED famous peers reacting on the record (posts/statements) — the roundup",
  "fan-pulse": "real fan sentiment (aggregate, from quotable public posts) — loving it / hating it / divided",
  "cast-crew-voices": "the people who MADE the work speaking out (cast, director, crew) via real statements/interviews",
  "breakout-spotlight": "who is this suddenly-everywhere person — told through what named peers/outlets say about them",
  "single-voice": "ONE person's substantive on-record response (a statement, a podcast answer, an interview moment)",
  "ripple-effects": "confirmed ANNOUNCED consequences (paused projects, dedications, recasts, schedule moves) — zero forecasting",
};

const SYS = `You are the inside-stories editor of The Screen Report planning ripple coverage around ONE confirmed event.
Propose distinct angles. Each angle = one article in a given FORM about how the people around the event reacted.
RULES:
- CONFIRMED RIPPLE ONLY: every angle must be findable in real on-the-record reactions (public posts by named
  figures, official statements, published interviews, quotable fan posts). NEVER propose angles that need
  unnamed insiders, "sources say", private feelings, or invented hometown/family color. Speculation = a
  different desk, not yours.
- TONE: somber events (death/health/legal) → respectful angles only (tributes, career-partner voices, what
  colleagues said) — never frivolous (no net-worth, no drama-mining). Celebrations → warm. A flop → honest
  about the work, respectful to the people who made it.
- Each angle genuinely DIFFERENT (different voices/lens), each searchable: give 2 SIMPLE Google-News-style
  queries — 2-5 plain words (the subject's name + one ripple word like tributes/reacts/responds/cast), NEVER
  a long quoted phrase (over-specific queries return zero articles) — plus the names you expect to be reacting.
Output STRICT JSON only.`;

export async function proposeAngles(trigger, { model = MODELS.classifier, max = MAX_ANGLES_PER_EVENT, chatImpl = chat } = {}) {
  const allowed = trigger.allowedForms || Object.keys(FORMS);
  const user = `EVENT (confirmed, from our news desk): ${trigger.parentTitle}
EVENT TYPE: ${trigger.eventType} | SENSITIVITY: ${trigger.sensitivity} | TONE: ${toneFor(trigger)}
CENTRAL SUBJECT: ${trigger.primaryEntity}${trigger.entities?.length ? ` | ALSO INVOLVED: ${trigger.entities.join(", ")}` : ""}

ALLOWED FORMS for this event type (use ONLY these):
${allowed.map((f) => `- ${f}: ${FORM_BRIEF[f]}`).join("\n")}

Propose up to ${max} angles. JSON:
{"angles":[{"form":"one of the allowed forms","angle":"short angle name","workingTitle":"a working headline",
"focusEntity":"who/what this angle centers on","searchQueries":["query 1","query 2"],
"voiceHints":["named people likely to have reacted"],"note":"one line: what it covers + why it's findable"}]}
Order by audience demand.`;

  let data;
  try {
    ({ data } = await chatImpl({ model, system: SYS, user, json: true, maxTokens: 1600, temperature: 0.4 }));
  } catch {
    return [];
  }

  const out = [];
  const seen = new Set();
  for (const a of (data?.angles || []).slice(0, max * 2)) {
    if (!a?.form || !FORMS[a.form] || !allowed.includes(a.form)) continue; // form clamp — never trust the LLM's enum
    if (!a.angle || !a.workingTitle) continue;
    // ONE angle per form per event: the publish dedup is eventSlug×form anyway, and two same-form
    // candidates in one run just double-burn the harvest budget + the parked-retry counter.
    const key = a.form;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      form: a.form,
      angle: a.angle,
      workingTitle: a.workingTitle,
      focusEntity: a.focusEntity || trigger.primaryEntity,
      searchQueries: (Array.isArray(a.searchQueries) ? a.searchQueries : []).filter(Boolean).slice(0, 3),
      voiceHints: (Array.isArray(a.voiceHints) ? a.voiceHints : []).filter(Boolean).slice(0, 8),
      note: a.note || a.angle,
      key,
    });
    if (out.length >= max) break;
  }
  // ONE flagship per event leads the run (peer-tributes/fan-pulse first when proposed) — the rest
  // follow in proposal order. Keeps the homepage from being carpet-bombed by one event's siblings.
  out.sort((a, b) => (FORMS[b.form].flagship ? 1 : 0) - (FORMS[a.form].flagship ? 1 : 0));
  return out;
}
