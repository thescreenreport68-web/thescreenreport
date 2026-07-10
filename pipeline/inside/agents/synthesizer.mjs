// AGENT 4 — SYNTHESIZER. Its one job: read EVERYTHING the gatherer collected, understand it, and
// distill the best of it into a tight brief the writer works from: the hook, the sides, the standout
// voices (by anchor ref), the honest mood, what must be included. It quotes nothing itself — it
// points at anchors by their R#/A# ids so nothing can drift. deepseek-v4-flash @ temp 0.3: the only
// agent that reasons over the whole pile, on the cheapest capable reasoning model.
import { agentChat } from "../models.mjs";

const SYS = `You are the senior editor distilling raw gathered material into a WRITER'S BRIEF for an
audience-reaction/discourse article. You are given the full anchor block: numbered NAMED quotes (R1, R2…)
and numbered AUDIENCE posts (A1, A2…), plus a sentiment picture.
Your brief must:
- Find the genuinely interesting story in the material (the hook a reader can't skip).
- Lay out the sides of the reaction/argument honestly — never overstate; if the material skews one way, say so.
- Pick the STANDOUT anchors by their ids (the quotes that carry the piece; best saved for last).
- Note what MUST be included (the facts/points the article is incomplete without).
- Refer to anchors ONLY by id (R2, A5) — never re-quote or paraphrase quote text (the writer copies
  verbatim from the block; your job is selection and structure).
Output STRICT JSON only.`;

// run(job) → job.brief
export async function run(job, { chatImpl = null } = {}) {
  const { data } = await agentChat("synthesizer", {
    system: SYS,
    user: `FORM: ${job.angle.form}
STORY: ${job.story.parentTitle}${job.story.work ? ` (the ${job.story.work.type} "${job.story.work.title}"${job.story.work.year ? `, ${job.story.work.year}` : ""})` : ""}
ANGLE: ${job.angle.angle}

THE GATHERED MATERIAL:
${job.factText}

JSON:
{"hook":"1-2 sentences: the irresistible way in","mood":"honest one-line sentiment read",
"sides":[{"stance":"","summary":"2-3 sentences in your words","anchorRefs":["R1","A2"]}],
"standoutRefs":["the 3-6 anchor ids that carry the piece, strongest last"],
"mustInclude":["hard points the article needs"],
"suggestedTitle":"honest + curiosity, no clickbait","seoKeyword":"one natural keyword phrase"}`,
  }, chatImpl ? { chatImpl } : {});

  if (!data || !Array.isArray(data.sides) || !data.sides.length) {
    job.synthFail = "synthesizer returned no usable brief";
    return job;
  }
  job.brief = {
    hook: (data.hook || "").slice(0, 400),
    mood: (data.mood || "").slice(0, 200),
    sides: data.sides.slice(0, 4).map((s) => ({
      stance: (s.stance || "").slice(0, 80),
      summary: (s.summary || "").slice(0, 500),
      anchorRefs: (Array.isArray(s.anchorRefs) ? s.anchorRefs : []).slice(0, 8),
    })),
    standoutRefs: (Array.isArray(data.standoutRefs) ? data.standoutRefs : []).slice(0, 6),
    mustInclude: (Array.isArray(data.mustInclude) ? data.mustInclude : []).slice(0, 6),
    suggestedTitle: (data.suggestedTitle || job.angle.workingTitle).slice(0, 140),
    seoKeyword: (data.seoKeyword || job.story.primaryEntity).slice(0, 80),
  };
  return job;
}
