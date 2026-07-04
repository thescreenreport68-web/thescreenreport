// ANGLES (REV 2) — given a discovered discourse story, propose which of the 4 forms to write and the
// specific framing. Candidates only: nothing is written until the harvest gathers real anchor posts.
import { chat } from "../lib/openrouter.mjs";
import { MODELS, FORMS, MAX_ANGLES_PER_STORY } from "./config.inside.mjs";

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

const FORM_BRIEF = {
  "audience-reaction": "how fans/viewers are reacting to it — loving it, slamming it, or divided (needs real audience posts)",
  "the-debate": "the ONE specific thing people are arguing about (a plot choice, casting, ending, controversy) — both sides",
  "creator-answers-critics": "a director/actor's REAL on-record response to the criticism/backlash (needs a real creator quote)",
  "breakout-buzz": "who this suddenly-everywhere person is, told through what people are saying about them",
};

// Which forms are even eligible for a story kind (keeps the LLM honest + saves calls).
const ALLOWED = {
  work: ["audience-reaction", "the-debate", "creator-answers-critics"],
  person: ["breakout-buzz", "the-debate"],
  discourse: ["the-debate", "audience-reaction"],
};

const SYS = `You are the editor of an AUDIENCE-REACTION & DISCOURSE desk. Given a top story and the real
discussion around it, choose the best article FORM(s) and a specific angle. We cover how NORMAL PEOPLE
react to and argue about movies/TV/music — plus how creators answer critics. Not gossip, not death.
RULES: pick only from the allowed forms; each angle must be about REAL, findable discussion (never
invent a debate that isn't happening); order by how strong the discourse is. Output STRICT JSON only.`;

export async function proposeAngles(story, { model = MODELS.classifier, max = MAX_ANGLES_PER_STORY, chatImpl = chat } = {}) {
  const allowed = ALLOWED[story.kind] || ALLOWED.work;
  const posts = (story.redditPosts || []).slice(0, 8).map((p) => `- "${p.title}" (${p.numComments} comments)`).join("\n") || "(no specific threads captured; use general search)";
  const user = `TOP STORY: ${story.primaryEntity}${story.work ? ` — the ${story.work.type} "${story.work.title}"${story.work.year ? ` (${story.work.year})` : ""}` : ""}
CATEGORY: ${story.category} | discourse heat: ${story.discourseHeat}
WHAT PEOPLE ARE DISCUSSING (real threads):
${posts}
${story.overview ? `CONTEXT: ${story.overview.slice(0, 300)}` : ""}

ALLOWED FORMS (choose only these):
${allowed.map((f) => `- ${f}: ${FORM_BRIEF[f]}`).join("\n")}

Propose up to ${max} angles. JSON:
{"angles":[{"form":"one allowed form","angle":"short angle name","workingTitle":"a working headline (honest, curiosity not clickbait)","focusEntity":"the person/work this centers on","searchQueries":["2-4 plain words to find the discussion","another"],"note":"one line: the specific discourse it covers"}]}
Order by discourse strength.`;

  let data;
  try {
    ({ data } = await chatImpl({ model, system: SYS, user, json: true, maxTokens: 1200, temperature: 0.4 }));
  } catch {
    return [];
  }

  const out = [];
  const seen = new Set();
  for (const a of (data?.angles || []).slice(0, max * 2)) {
    if (!a?.form || !FORMS[a.form] || !allowed.includes(a.form)) continue; // form clamp
    if (!a.angle || !a.workingTitle) continue;
    if (seen.has(a.form)) continue; // one angle per form per story
    seen.add(a.form);
    out.push({
      form: a.form,
      angle: a.angle,
      workingTitle: a.workingTitle,
      focusEntity: a.focusEntity || story.primaryEntity,
      searchQueries: (Array.isArray(a.searchQueries) ? a.searchQueries : []).filter(Boolean).slice(0, 4),
      note: a.note || a.angle,
      key: a.form,
    });
    if (out.length >= max) break;
  }
  // Flagship (audience-reaction) leads when present.
  out.sort((a, b) => (FORMS[b.form].flagship ? 1 : 0) - (FORMS[a.form].flagship ? 1 : 0));
  return out;
}
