// ENGAGEMENT DIRECTOR v2 (owner fix 2026-07-10: the ask must be PART of the story's
// flow, never bolted on). Runs BEFORE the writer: picks the ONE goal that fits the
// story — comments (debate/opinions) · saves (dates/guides) · sends (shocks/nostalgia/
// fandom) — and hands the WRITER the guidance to craft the ending himself as one
// flowing beat: a story-specific audience question, then the natural ask.
// Caption CTA + pinned firstComment align to the same goal downstream.
import { llm } from "../models.mjs";

// vetted ask families — the writer's final sentence must match its goal's family
export const ASK_FAMILIES = {
  comments: {
    patterns: [/(let us know|tell us|drop (your|it)|sound off).{0,25}comments?( below)?[.!]?$/i],
    examples: ['"Let us know in the comments below."', '"Tell us in the comments."'],
    writerGuidance:
      "end with a story-specific question the audience is dying to answer, then invite them to answer it in the comments — as ONE flowing beat",
  },
  saves: {
    patterns: [/\b(save|bookmark) this\b.{0,52}[.!]?$/i],
    examples: ['"Save this for release day."', '"Save this one so you don\'t miss it."'],
    writerGuidance:
      "end with the date/detail people will want to come back to, then tell them to save this for when they need it — as ONE flowing beat",
  },
  sends: {
    patterns: [/\b(send|show) this to (a|an|the|your)\b.{2,44}[.!]?$/i],
    examples: ['"Send this to a Swiftie."', '"Send this to your group chat."'],
    writerGuidance:
      "end with a question or beat aimed at the exact friend who NEEDS this news, then tell viewers to send it to that person — as ONE flowing beat",
  },
};

const HEURISTIC = { debate: "comments", reveal: "comments", "record-number": "sends", "casting-shock": "sends", "return-nostalgia": "sends", "first-look": "saves" };

const SYS = `You direct audience engagement for an Instagram news reel — BEFORE it is written. Pick the ONE ask that fits THIS story best.
GOALS: "comments" (the story invites opinions/debate/a question people genuinely want to answer — the default for gossip and one-off news) · "saves" (ONLY content people will RETURN to: release dates, watch guides, schedules, lists — never one-off news or gossip) · "sends" (shocks, records, nostalgia, fandom-identity moments people DM to a specific friend).
Return STRICT JSON {"goal":"comments"|"saves"|"sends","why":string,"cta":string,"firstComment":string}
cta: the written caption CTA line for that goal. firstComment: a warm pinned comment seeding the goal (for comments: ask the question invitingly; for saves/sends: one bonus detail).
Never use banned phrasing: "tag a friend", "like if", "share if", "comment YES", "you won't believe".`;

export async function pickGoal({ facts, segment }) {
  let out = null;
  try {
    out = await llm({
      role: "classify",
      system: SYS,
      user: `STORY: ${facts.storyOneLine}\nSEGMENT: ${segment}\nMOOD: ${facts.mood}\nENTITIES: ${facts.entities.map((e) => `${e.name} (${e.kind})`).join(", ")}\nTOP FACTS:\n${facts.facts.slice(0, 5).map((f) => `- ${f.claim}`).join("\n")}`,
      temp: 0.3,
      maxTokens: 250,
      json: true,
    });
  } catch {}
  const goal = ["comments", "saves", "sends"].includes(out?.goal) ? out.goal : "comments";
  return {
    goal,
    why: String(out?.why || "").slice(0, 120),
    cta: String(out?.cta || "").trim(),
    firstComment: String(out?.firstComment || "").trim(),
    family: ASK_FAMILIES[goal],
  };
}

// deterministic gate: does the script's ending deliver (question → matching ask)?
export function lintEnding(sentences, goal) {
  const fam = ASK_FAMILIES[goal];
  if (!fam || sentences.length < 2) return [{ rule: "ending", detail: "too short to carry an ending" }];
  const last = sentences[sentences.length - 1].trim();
  const beforeLast = sentences[sentences.length - 2].trim();
  const v = [];
  if (!fam.patterns.some((re) => re.test(last)))
    v.push({ rule: "ending-ask", detail: `final sentence must be the ${goal} ask (like ${fam.examples[0]}), got: "${last.slice(0, 60)}"` });
  if (!/\?$/.test(beforeLast) && goal === "comments")
    v.push({ rule: "ending-question", detail: `the sentence before the ask must be the audience question (ends with ?), got: "${beforeLast.slice(0, 60)}"` });
  return v;
}
