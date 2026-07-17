// CAPTION WRITER — the research §6 playbook, enforced in code after the LLM writes:
// IG: fact in the first 125 chars, ≤5 inline entity hashtags, NO URLs, link goes to the
// first comment. FB: DIFFERENT plain-English text, NO links, one genuine question
// (never engagement bait), link pinned as first comment. Somber mode turns every
// engagement lever OFF (no emoji, no question, no hashtag pile).
import { CARDS } from "../config.mjs";
import { llm } from "../models.mjs";

const SYS = `You write captions for ONE news image card, for Instagram and Facebook separately. Return STRICT JSON:
{"ig":string,"fb":string}
INSTAGRAM rules: the fact lands in the FIRST 125 characters; <30 words total; hashtag 2-4 entity names INLINE in the sentence (#Zendaya style — never a tag block); NO URLs; may end with "Full story at the link in bio." Optional 1 emoji.
FACEBOOK rules: plain English (no hashtags, no stan phrasing), 1-2 short sentences (40-120 chars ideal), then ONE genuine open question that invites real opinions. NEVER instructed engagement ("comment YES", "tag a friend", "share if") — a real question only. NO URLs.
BOTH: 100% supported by the FACTS; state the fact cleanly — the surprising fact IS the hook; no clickbait withholding.
SOMBER stories: respectful plain tone, NO emoji, NO question, NO hashtags beyond one name tag on IG; FB is a plain respectful sentence.`;

const URL_RE = /https?:\/\/|www\./i;
const BAIT_RE = /\b(tag a friend|comment (yes|below if)|share (this|if)|like if|double.tap)\b/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

export function validateCaptions({ ig, fb }, somber) {
  const igTags = (ig.match(/#[A-Za-z0-9_]+/g) || []).length;
  if (URL_RE.test(ig) || URL_RE.test(fb)) return "url-in-caption";
  if (BAIT_RE.test(ig) || BAIT_RE.test(fb)) return "engagement-bait";
  if (igTags > CARDS.caption.igMaxHashtags) return "too-many-hashtags";
  if (ig.length > 700 || fb.length > 500) return "too-long";
  if (somber) {
    if (EMOJI_RE.test(ig) || EMOJI_RE.test(fb)) return "emoji-on-somber";
    if (/\?/.test(fb) || /\?/.test(ig)) return "question-on-somber";
    if (igTags > 1) return "hashtags-on-somber";
  }
  return null;
}

export async function writeCaptions(story, pack, cls, card) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await llm({
      role: "writer", system: SYS, temperature: 0.5, maxTokens: 500,
      user: `CARD HEADLINE: ${card.headline}\nCARD SUB: ${card.sub}\nCATEGORY: ${cls.category}${cls.somber ? " (SOMBER)" : ""}\nFACTS:\n${pack.facts.map((f) => `- ${f.claim}`).join("\n")}${attempt ? "\nPREVIOUS ATTEMPT WAS REJECTED — follow the rules exactly." : ""}`,
    });
    const ig = String(out?.ig || "").trim();
    const fb = String(out?.fb || "").trim();
    if (!ig || !fb) continue;
    if (validateCaptions({ ig, fb }, cls.somber)) continue;
    // NO first comments — owner directive 2026-07-17: the automation must never comment
    // links (or anything else) on its own posts. IG traffic rides the bio link only.
    return { ig, fb };
  }
  return null; // two strikes → orchestrator drops the story (never ship a rule-breaking caption)
}
