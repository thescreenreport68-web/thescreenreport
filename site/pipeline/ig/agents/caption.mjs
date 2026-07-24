// AGENT 8 — CAPTION & SEO WRITER (plan §2.2 #8, §5.3): the caption is simultaneously
// Instagram search copy AND a Google snippet (public professional reels are indexed).
// Deterministic lint (agent 9) drives the retry loop.
import { llm } from "../models.mjs";
import { lintCaption } from "../lib/lint.mjs";
import { stripOutletAttribution, isOutletTag } from "../lib/util.mjs";

const CTAS = [
  "Send this to a {fandom} fan.",
  "Save this for release day.",
  "Follow @thescreenreport for daily movie news.",
];

// Light AI-assisted disclosure (VIDEO_PUBLISHING_PLAYBOOK.md §1 Meta + to-do #7): Meta best practice
// for a news brand — the API-level isAiGenerated flag is set too, but "undisclosed-then-caught is worse".
// Kept to ONE subtle line, placed above the hashtags, never inside line1 (the clean Google snippet).
const AI_NOTE = "AI-assisted recap by The Screen Report.";

// SINGLE SOURCE OF TRUTH for the posted caption body. Both this agent AND igrun (which re-assembles
// `full` after applying engage-agent cta/firstComment overrides) MUST use this — otherwise igrun's
// rebuild silently drops the AI_NOTE (which is exactly what happened on the first live test). (2026-07-13)
export function assembleFull(cap) {
  return [cap.line1, "", cap.body, "", cap.cta, "", AI_NOTE, "", (cap.hashtags || []).join(" ")].join("\n").trim();
}

const SYS = `You write Instagram Reel captions for a Hollywood news brand. Goal: search reach + sends.
Return STRICT JSON: {"line1":string,"body":string,"hashtags":[string],"cta":string,"firstComment":string}

RULES:
- line1: ≤55 characters, MUST contain the #1 entity name literally, states the hook fact plainly (it doubles as the Google snippet — factual, no emoji, no clickbait).
- body: 2-3 short factual sentences from the provided facts ONLY; natural keywords (full title, person names, event words like "box office", "casting", "trailer"). NEVER name, cite, or attribute to a news outlet or source — no "according to <outlet>", no "per <outlet>", no "reports say", no publication names anywhere. State the facts directly, as our own reporting.
- hashtags: exactly 4, ONLY in the hashtags array (never inside line1/body/cta) — 1-2 evergreen niche (#MovieNews #BoxOffice #Hollywood #CelebrityNews pick relevant) + 2-3 story entities (#Superman #JamesGunn). No generic tags ever (#fyp #viral #reels).
- cta: ONE of the provided CTA patterns, adapted to this story's fandom.
- firstComment: one warm, factual line that invites replies (a real question about the story, no bait phrasing).
- No links. No ALL-CAPS words. No markdown. No emoji in line1 (elsewhere max 1).`;

// Deterministic auto-repair BEFORE lint: cheaper and more reliable than retry loops.
export function repairCaption(cap, entities = []) {
  const strip = (s) => String(s || "").replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();
  const out = { ...cap };
  const foundTags = [];
  for (const field of ["line1", "body", "cta", "firstComment"]) {
    let text = strip(out[field]);
    // only letter-initial tags — "#1 movie in America" must keep its rank token
    text = text.replace(/#([A-Za-z]\w*)/g, (_, t) => { foundTags.push(`#${t}`); return ""; }).replace(/\s{2,}/g, " ").trim();
    // HARD source-attribution strip (owner 2026-07-12): an IG reel/caption must NEVER cite a source.
    // The prompt used to append "according to Variety" and the model did so on EVERY caption
    // regardless of the real outlet — remove any attribution clause deterministically so none ships.
    text = text
      // unambiguous attribution clauses only (NOT bare "per"/"via" — those hit "$5M per screen",
      // "shared via Instagram"); the prompt already forbids all attribution, this is the net.
      .replace(/[\s,;:—-]*\b(?:according to|as reported by|reported by|as per|sourced from)\b[^.?!]*(?=[.?!]|$)/gi, "")
      .replace(/[\s,;:—-]*\b(?:per|via)\s+[A-Z][A-Za-z.&'’-]+(?:\s+[A-Z][A-Za-z.&'’-]+){0,2}/g, "") // "per Variety", "via TMZ", "per Rolling Stone" — capitalized outlet only
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.?!,;:])/g, "$1")
      .trim();
    // OUTLET NET (owner audit 2026-07-16): "Described by E! News as…" shipped — the attribution regexes
    // above miss described-by/told/reports framings. The shared outlet strip catches them all.
    out[field] = stripOutletAttribution(text);
  }
  let tags = [...(out.hashtags || []).map((t) => (String(t).startsWith("#") ? String(t) : `#${t}`)), ...foundTags];
  tags = [...new Map(tags.map((t) => [t.toLowerCase(), t])).values()].filter((t) => t.length > 2 && !isOutletTag(t));
  // top up from entities / evergreen if short; trim if long
  const evergreen = ["#MovieNews", "#Hollywood"];
  const entityTags = entities.map((e) => "#" + String(e.name).replace(/[^A-Za-z0-9]/g, ""));
  for (const t of [...entityTags, ...evergreen]) {
    if (tags.length >= 4) break;
    if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
  }
  out.hashtags = tags.slice(0, 5);
  // line1 over hard cap: prefer a clause boundary, else the last full word before 70
  if (out.line1.length > 70) {
    const window = out.line1.slice(0, 70);
    const clause = Math.max(window.lastIndexOf(","), window.lastIndexOf(" — "), window.lastIndexOf(";"));
    const space = window.lastIndexOf(" ");
    const at = clause > 30 ? clause : space > 30 ? space : 70;
    const cut = window.slice(0, at).replace(/[,;:\s—-]+$/, "").trim();
    if (cut.length >= 25) out.line1 = /[.!?]$/.test(cut) ? cut : cut + ".";
  }
  return out;
}

export async function writeCaption({ facts, segment, ctaIndex = 0, engage = null }) {
  const ctaGuide = engage?.goal
    ? `ENGAGEMENT GOAL: ${engage.goal} — the cta must serve this goal (${engage.goal === "comments" ? "invite answers in the comments" : engage.goal === "saves" ? "give a reason to save this post" : "tell them who to send this to"}).`
    : `CTA PATTERN TO ADAPT: ${CTAS[ctaIndex % CTAS.length]}`;
  const user = `STORY: ${facts.storyOneLine}\nENTITIES: ${facts.entities.map((e) => `${e.name} (${e.kind})`).join(", ")}\nFACTS:\n${facts.facts.map((f) => `- ${f.claim}`).join("\n")}\nSEGMENT: ${segment}\n${ctaGuide}`;
  let violations = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await llm({
      role: "caption",
      system: SYS,
      user: attempt === 0 ? user : `${user}\n\nPREVIOUS ATTEMPT FAILED: ${violations.map((v) => `${v.rule}(${v.detail})`).join("; ")} — fix these exactly.`,
      temp: attempt === 0 ? 0.4 : 0.1,
      maxTokens: 500,
      json: true,
    });
    const cap = repairCaption(
      {
        line1: String(res.line1 || "").trim(),
        body: String(res.body || "").trim(),
        hashtags: res.hashtags || [],
        cta: String(res.cta || "").trim(),
        firstComment: String(res.firstComment || "").trim(),
      },
      facts.entities,
    );
    violations = lintCaption(cap, facts.entities);
    if (!violations.length) {
      cap.full = assembleFull(cap);
      return { caption: cap, attempts: attempt + 1 };
    }
  }
  return { caption: null, attempts: 3, hold: `caption failed lint: ${violations.map((v) => v.rule).join(", ")}` };
}
