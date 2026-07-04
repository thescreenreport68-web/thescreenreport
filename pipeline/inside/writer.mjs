// WRITER (inside) — deepseek, locked to the reaction fact block. The lane's voice: warm, human,
// specific — the QUOTES carry the emotion, our prose is the frame. Curiosity is engineered in the
// STRUCTURE (numbered promise, best-saved-for-last with an honest signpost, question H2s answered
// immediately) — never in headline dishonesty. House rails inherited from the playbook.
import { chat } from "../lib/openrouter.mjs";
import { MODELS, FORMS, toneFor } from "./config.inside.mjs";

const FORM_GUIDE = {
  "peer-tributes": `SKELETON (THR/Variety tribute-roundup model):
1. News lede: the event in one settled sentence + one sentence of who the subject is (their iconography, 2-4 titles).
2. Pivot sentence ("Within hours, co-stars and collaborators began sharing tributes…").
3. Reaction entries ordered by PROMINENCE + RELATIONSHIP CLUSTERS (closest/biggest first… but SIGNPOST early that
   the most moving one is coming, and place it LAST). Each entry: connection-first setup sentence, then the quote.
4. Close open-ended: reactions are still coming in.
Headline formula: "[Name] Dead at [age]: [Peer] and [Peer] Lead Tributes" or "[Event]: Stars React". H1 must state the event plainly.`,
  "fan-pulse": `SKELETON (fans-react model):
1. Context lede: the work + the trigger moment, one settled sentence. 2. VERDICT UP FRONT: the honest sentiment
(loving it / not / divided) — must match the harvest sentiment exactly; say if the sample skews one way.
3. Themed question-H2 groups; under each, 1 framing sentence + fan quotes (aggregate attribution ONLY: "one fan
wrote", "fans on X" — NEVER a fan's name/handle in prose). If DIVIDED: both sides get real quotes, positive first.
4. Two-part tail: "What the reactions tell us" + a forward-looking kicker.
Headline: "[Work] Fans Divided Over [Specific Thing]" / "Fans React to [Thing] — [honest tease]".`,
  "cast-crew-voices": `SKELETON (cast/crew speak out):
1. Event lede (what ended/happened, when, where it stood). 2. 3-8 voices, roughly chronological, each
connection-first ("who they are on the project") then the quote; interleave 1-2 lines of grounded context.
3. The most authoritative voice (creator/showrunner/director) SAVED FOR LAST — signpost it.
4. Close: legacy line + what's next (only announced facts).
Headline: '[Name] Speaks Out on [Event]: "[short real quote fragment]"' (fragment MUST be verbatim from the facts).`,
  "breakout-spotlight": `SKELETON (who-is-X through what people say):
1. Buzz-proof lede: the moment that made everyone talk + ONE named-peer quote about them high up.
2. 3-5 question H2s a fan would type ("How did X get cast?", "What are co-stars saying?"), each answered
   immediately in the first 40-60 words, quotes woven in (outlet-attributed).
3. Close on what's next for them (announced only).
Headline: "Who Is [Name]? The [Work] Breakout Everyone's Talking About".`,
  "single-voice": `SKELETON (one on-record response):
1. BLUF lede: who responded, to what, where (platform/outlet) — the substance teased, the stance stated.
2. Paraphrase-then-quote through their response: one-sentence paraphrase setup, then the verbatim line, repeat.
3. One graf of grounded context (their connection to the event). 4. Kicker: their final line or what's next.
Headline: '[Name] Responds to [Event]: "[real fragment]"'.`,
  "ripple-effects": `SKELETON (confirmed downstream effects):
1. Lede: the event + the one-sentence shape of its aftermath. 2. Each CONFIRMED effect gets a short section:
what changed, who announced it, their words if quotable. ANNOUNCED FACTS ONLY — zero forecasting, zero "likely/could".
3. Close: what's officially next (dates only if in the facts).
Headline: "After [Event]: What Happens to [Project/People] Now" (answers must be IN the article, not withheld).`,
};

const SYS = `You are the inside-stories writer for The Screen Report — the desk that covers how the PEOPLE around a
confirmed event reacted, strictly through their real on-the-record words.

THE IRON RULES (violations are auto-detected and kill the article):
- Write ONLY from the REACTION FACTS block. Every quote must be COPIED EXACTLY from it (never trimmed mid-thought,
  merged, extended, or "tidied"). Every speaker you mention must exist in it. No other voices exist.
- ≤15% of the article may be verbatim quotation. No quote longer than ~25 words. NEVER two quotes back-to-back —
  always your framing sentence between. Paraphrase-then-quote: one-sentence paraphrase setup ("X admitted that…"),
  THEN the short verbatim payoff.
- Fans are ALWAYS aggregate ("one fan wrote", "fans on X") — never a name or handle for a private person.
- You were NOT in the room: no invented scene-setting, moods, gestures, reactions you cannot quote.
- Attribute on first quote and on every source change ("wrote on Instagram", "told Variety", "said on the podcast").
- ONE STORY ONLY: this event's ripple. No background from other cases/years, no career filler beyond the lede line.

THE VOICE: warm, human, precise. The quotes carry the emotion; your prose is the frame — restrained, specific,
connection-first ("her co-star of 20 years" beats "actress Y"). Generic PR quotes get paraphrased in passing, never
featured. CURIOSITY lives in structure: state the core fact in sentence 1 (never withhold WHO/WHAT), tease only the
COLOR ("the most emotional words came from…"), resolve every tease within a screen. 2-3 question-style H2s max,
each answered immediately.

TONE LADDER: somber (death/health/legal) = strictly neutral verbs, zero playfulness, respectful throughout.
celebratory = light warmth. respectful-honest (a flop) = honest about the work's performance, kind to the people.
Return STRICT JSON only.`;

export async function generateInside({
  trigger, angle, factBlock, factText,
  model = MODELS.generator, chatImpl = chat, maxTokens = 6000,
  corrections = null, previousArticle = null,
} = {}) {
  const form = FORMS[angle.form];
  const [lo, hi] = form.words;
  const voices = factBlock.stats.namedVoices + factBlock.stats.fanPosts;
  // Word budget scales with harvested material — a 4-voice tribute can't honestly fill 1500 words.
  const budget = Math.min(hi, Math.max(lo, lo + voices * 60));

  const schema = `{"title":"","metaTitle":"<=60 chars, = title or tighter","dek":"1-2 sentences","metaDescription":"<=155 chars",
"keyTakeaways":["3-5 items"],"body":"markdown with ## H2s","faq":[{"q":"","a":"40-60 word direct answer"}],
"about":[{"name":"","type":"Person|Movie|TVSeries|Organization"}],"tags":["4-8"],"imageQuery":"best image search phrase",
"reactionsRender":[{"speaker":"","connection":"","platform":"","date":"","quote":"EXACT quote from facts","tweetId":""}],
"anchorStatement":{"speaker":"","connection":"","quote":"","platform":""},
"fanConsensus":"fan-pulse only: 1-2 sentence honest verdict, else empty string",
"claims":[{"text":"each load-bearing factual claim","sourceQuote":"the fact-block line supporting it"}]}`;

  const user = `Write the article.

FORM: ${angle.form} — ${form.label}
${FORM_GUIDE[angle.form]}

ANGLE: ${angle.angle}${angle.note ? ` — ${angle.note}` : ""}
WORKING TITLE (improve on it): ${angle.workingTitle}
TONE: ${toneFor(trigger)} | SENSITIVITY: ${trigger.sensitivity}
${trigger.eventSummary ? `EVENT SUMMARY (editor-verified): ${trigger.eventSummary}` : ""}
WORD BUDGET: ~${budget} words (never pad past the material).

REACTION FACTS — the ONLY quotes, voices and facts that exist:
${factText}

reactionsRender = the display card list (8-14 best entries for tributes/fan-pulse, all voices for smaller forms),
ordered for reading (build to the strongest). quote fields EXACTLY as in the facts. tweetId only if you are told one
exists for that post (available ids: ${factBlock.tweetIds.join(", ") || "none"} — leave "" if unsure which matches).
anchorStatement ONLY if an official family/rep/company/creator statement exists in the facts — else null.
${corrections ? `\n⚠⚠ MANDATORY CORRECTIONS — fix ONLY these, change nothing else:\n${corrections}` : ""}

Return JSON with EXACTLY these fields: ${schema}`;

  // Surgical mode (same contract as news generate.mjs): low temp, merge over the previous draft.
  if (previousArticle && corrections) {
    const { data, usage } = await chatImpl({ model, system: SYS, user, json: true, maxTokens, temperature: 0.2 });
    return { article: { ...previousArticle, ...(data || {}) }, usage };
  }

  let article = null, usage = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = attempt ? "\n\n⚠ Your previous output was INCOMPLETE (missing fields or under the word floor). Return the FULL JSON." : "";
    const res = await chatImpl({ model, system: SYS, user: user + suffix, json: true, maxTokens, temperature: 0.6 });
    article = res.data; usage = res.usage;
    const words = (article?.body || "").split(/\s+/).filter(Boolean).length;
    if (article && words >= Math.min(lo, 300) && (article.keyTakeaways || []).length >= 3 && (article.faq || []).length >= 2) break;
  }
  return { article, usage };
}
