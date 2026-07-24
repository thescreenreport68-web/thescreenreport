// ENGAGEMENT DIRECTOR v2 (owner fix 2026-07-10: the ask must be PART of the story's
// flow, never bolted on). Runs BEFORE the writer: picks the ONE goal that fits the
// story — comments (debate/opinions) · saves (dates/guides) · sends (shocks/nostalgia/
// fandom) — and hands the WRITER the guidance to craft the ending himself as one
// flowing beat: a story-specific audience question, then the natural ask.
// Caption CTA + pinned firstComment align to the same goal downstream.
import { llm } from "../models.mjs";

// vetted ask families — the writer's final sentence must match its goal's family.
// CTA ROTATION (owner audit 2026-07-16): the identical "Let us know in the comments below." on every
// reel is a mass-produced-content fingerprint under YouTube's 2025 inauthentic-content policy
// (channel-level demonetization risk) — per-video variation is a survival requirement. Each goal now
// carries several vetted variants (all matching its lint pattern); the writer sees a slug-rotated
// pair, and the deterministic ending-repair appends a slug-rotated canonical — so no two consecutive
// reels ship the same closing line.
export const ASK_FAMILIES = {
  comments: {
    patterns: [/(let us know|tell us|drop (your|it)|sound off).{0,25}comments?( below)?[.!]?$/i],
    examples: [
      '"Let us know in the comments below."',
      '"Tell us in the comments."',
      '"Drop your take in the comments."',
      '"Sound off in the comments below."',
      '"Tell us what you think in the comments."',
      '"Drop it in the comments."',
    ],
    writerGuidance:
      "end with a TWO-SIDED debate question about THIS story — one a reasonable fan could argue either way (was she right? too far? who wins?) — then invite them to answer in the comments as ONE flowing beat. Never a yes/no pleasantry, never generic",
  },
  saves: {
    patterns: [/\b(save|bookmark) this\b.{0,52}[.!]?$/i],
    examples: [
      '"Save this for release day."',
      '"Save this one so you don\'t miss it."',
      '"Bookmark this for the weekend."',
      '"Save this before it slips your feed."',
    ],
    writerGuidance:
      "end with the date/detail people will want to come back to, then tell them to save this for when they need it — as ONE flowing beat",
  },
  sends: {
    patterns: [/\b(send|show) this to (a|an|the|your)\b.{2,44}[.!]?$/i],
    examples: [
      '"Send this to a Swiftie."',
      '"Send this to your group chat."',
      '"Send this to the fan who needs it."',
      '"Show this to your movie-night crew."',
    ],
    writerGuidance:
      "end with a question or beat aimed at the exact friend who NEEDS this news, then tell viewers to send it to that person — as ONE flowing beat",
  },
};

// deterministic per-slug rotation over a family's examples — the writer sees a rotated PAIR (variety
// without losing the pattern), and the ending-repair uses rotation index 0 of the pair as canonical
export function rotatedExamples(goal, slug = "") {
  const fam = ASK_FAMILIES[goal];
  if (!fam) return [];
  let h = 0;
  for (const c of String(slug)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const i = h % fam.examples.length;
  return [fam.examples[i], fam.examples[(i + 1) % fam.examples.length]];
}

const HEURISTIC = { debate: "comments", reveal: "comments", "record-number": "sends", "casting-shock": "sends", "return-nostalgia": "sends", "first-look": "saves" };

// STORY-SIGNAL SENDS DETECTOR (owner audit 2026-07-16): goal was 'comments' on 14/14 posted reels —
// the llm defaulted to comments every time and the HEURISTIC above was dead code. Sends-per-reach is
// Meta's top non-follower reach signal, so stories with a genuine send-trigger (records, shocks,
// nostalgia/returns, fandom-identity moments) get a deterministic override, and a run-level quota
// (≥1/3 sends when signals allow) is enforced by the orchestrator via `preferSends`.
const SENDS_SIGNAL_RE = /\b(record|biggest|highest|first[- ]ever|milestone|shatter|smash|return(s|ing)?|reunion|reunit\w*|comeback|revival|nostalgi\w*|anniversary|casting|recast|replace[sd]?|shock\w*|stun\w*|unrecognizable|transform\w*|iconic|legend\w*)\b/i;
export function sendsSignal(facts, segment = "") {
  const text = `${facts?.storyOneLine || ""} ${(facts?.facts || []).slice(0, 5).map((f) => f.claim).join(" ")} ${segment}`;
  return SENDS_SIGNAL_RE.test(text);
}

const SYS = `You direct audience engagement for an Instagram news reel — BEFORE it is written. Pick the ONE ask that fits THIS story best.
GOALS: "comments" (the story invites opinions/debate/a question people genuinely want to answer — the default for gossip and one-off news) · "saves" (ONLY content people will RETURN to: release dates, watch guides, schedules, lists — never one-off news or gossip) · "sends" (shocks, records, nostalgia, fandom-identity moments people DM to a specific friend).
Return STRICT JSON {"goal":"comments"|"saves"|"sends","why":string,"cta":string,"firstComment":string}
cta: the written caption CTA line for that goal. firstComment: a HOT TAKE that PICKS A SIDE of the story\u2019s debate (one confident, defensible sentence a fan would argue with — this seeds the comment thread; never a neutral question, never bait).
Never use banned phrasing: "tag a friend", "like if", "share if", "comment YES", "you won't believe".`;

export async function pickGoal({ facts, segment, preferSends = false }) {
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
  let goal = ["comments", "saves", "sends"].includes(out?.goal) ? out.goal : "comments";
  let why = String(out?.why || "").slice(0, 120);
  // HARD OVERRIDE (owner audit 2026-07-16): the llm chose comments 14/14 — when the recent mix is
  // comments-heavy (preferSends, set by the orchestrator's ≥1/3 quota) AND the story carries a real
  // send-trigger, force sends. Never forced on a story without a signal (a bad-fit ask reads worse
  // than a common one).
  if (preferSends && goal === "comments" && sendsSignal(facts, segment)) {
    goal = "sends";
    why = "sends quota: story has a send-trigger (record/shock/nostalgia) and recent posts were comments-heavy";
  }
  return {
    goal,
    why,
    cta: goal === (out?.goal || "comments") ? String(out?.cta || "").trim() : "", // llm cta was written for ITS goal — drop on override (caption agent rebuilds)
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
