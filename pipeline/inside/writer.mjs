// WRITER (REV 2) — deepseek. Writes an ORIGINAL, engaging discourse story in our own voice. The
// ACCURACY LINE: the writer may craft the narrative and characterize the overall mood — but every
// QUOTE is reproduced verbatim from the anchor block, every NAMED person must exist in it, and no
// specific quote/name/date/title is ever invented. Real audience posts are embedded as examples.
// Readability + engagement are the #1 goal; SEO stays basic.
import { chat } from "../lib/openrouter.mjs";
import { MODELS, FORMS, SEO } from "./config.inside.mjs";

const FORM_GUIDE = {
  "audience-reaction": `SKELETON — how people are reacting:
1. HOOK lede: name the work + the shape of the reaction (loving it / slamming it / sharply divided) in a
   sentence that makes the reader want the details. State the honest overall mood up front.
2. Characterize the reaction in YOUR words (anchored by the posts), then show it: real audience posts as
   examples, grouped by sentiment. If divided, both sides get real posts — positive and negative.
3. One "why it's landing this way" beat (your analysis).
4. Close on where the conversation is heading — no filler.
Headline: "[Work] Has Fans [Divided / Losing It / …] Over [specific thing]" — honest, not clickbait.`,
  "the-debate": `SKELETON — the argument:
1. HOOK: state the ONE specific thing people are arguing about.
2. Side A with real posts → Side B with real posts (paraphrase-then-quote; your framing between).
3. A short "why this hit a nerve" beat.
4. Close without forcing a winner.
Headline: "[Work] Fans Can't Agree on [specific thing]" / "The [thing] Debate, Explained."`,
  "creator-answers-critics": `SKELETON — a creator answers back:
1. HOOK: the criticism/backlash + that [named creator] has now responded.
2. The audience criticism it answers (real audience posts, aggregate).
3. The creator's REAL response — verbatim quote, attributed by name ("[Name] told [outlet]…").
4. Close on how it landed / whether it settles anything.
Headline: '[Name] Responds to [Work] Backlash: "[short real quote fragment]"' (fragment MUST be verbatim).`,
  "breakout-buzz": `SKELETON — who everyone's talking about:
1. HOOK: the moment that made them the talk of the internet.
2. Who they are (real facts) + what people are saying (real posts + any named praise, verbatim).
3. A "why they're breaking out now" beat.
4. Close on what's next.
Headline: "Who Is [Name]? The [role] Everyone Can't Stop Talking About."`,
};

const SYS = `You are a sharp, engaging writer for The Screen Report's AUDIENCE-REACTION & DISCOURSE desk —
you cover how NORMAL PEOPLE are reacting to and arguing about movies/TV/music, and how creators answer
their critics. You write ORIGINAL, lively articles people actually want to read.

THE ACCURACY LINE (violations are auto-detected and kill the article):
- You MAY craft the narrative, framing, and characterize the overall mood/discourse in your own words —
  ANCHORED by the real posts you're given.
- You may NEVER invent a specific quote, a name, a date, a time, or a title. Every QUOTE must be copied
  EXACTLY from the ANCHOR block. Every NAMED person you quote must appear in it.
- Audience posts are attributed in AGGREGATE only ("one viewer wrote," "fans on Reddit," "one X user
  said") — never a real name/handle for an ordinary person. Named quotes (creators/known figures) are
  attributed by name.
- Don't state a rumor as fact. Don't claim a specific number/box-office/record unless it's in the facts.

ENGAGEMENT (the #1 goal): open with a hook, not a summary. Keep it lively and scannable — short
paragraphs, a strong voice, the real posts as beats. Curiosity in structure, never in a dishonest
headline. At most ${SEO.maxQuestionH2s} question-style H2s. SEO is BASIC — one natural keyword, no
stuffing, no FAQ-farm feel. Readability first.

Return STRICT JSON only.`;

export async function generateInside({
  trigger, angle, factBlock, factText,
  model = MODELS.generator, chatImpl = chat, maxTokens = 6000,
  corrections = null, previousArticle = null,
} = {}) {
  const form = FORMS[angle.form];
  const [lo, hi] = form.words;
  const anchors = (factBlock.stats.namedVoices || 0) + (factBlock.stats.fanPosts || 0);
  const budget = Math.min(hi, Math.max(lo, lo + anchors * 40));

  const schema = `{"title":"","metaTitle":"<=60 chars","dek":"1-2 engaging sentences","metaDescription":"<=155 chars",
"keyTakeaways":["3-4 items"],"body":"markdown with ## H2s","faq":[{"q":"","a":"40-60 word answer"}],
"about":[{"name":"","type":"Person|Movie|TVSeries|Organization"}],"tags":["4-8"],"imageQuery":"best image search phrase for the featured image",
"reactionsRender":[{"speaker":"","connection":"","platform":"","date":"","quote":"EXACT quote from anchors","tweetId":""}],
"anchorStatement":{"speaker":"","connection":"","quote":"","platform":""},
"fanConsensus":"1-2 sentence honest read of the overall sentiment (or empty)",
"claims":[{"text":"each hard fact used (date/name/title/number)","sourceQuote":"the anchor line it traces to"}]}`;

  const user = `Write the article.

FORM: ${angle.form} — ${form.label}
${FORM_GUIDE[angle.form]}

STORY: ${trigger.parentTitle}${trigger.work ? ` (the ${trigger.work.type} "${trigger.work.title}"${trigger.work.year ? `, ${trigger.work.year}` : ""})` : ""}
ANGLE: ${angle.angle}${angle.note ? ` — ${angle.note}` : ""}
WORKING TITLE (improve on it): ${angle.workingTitle}
WORD BUDGET: ~${budget} words.

ANCHORS — the ONLY quotes, names and posts that exist:
${factText}

reactionsRender = the audience/quote cards to display (6-12 best, ordered to build). quote fields EXACTLY
as in the anchors. tweetId only for an X post you're told has one (available: ${factBlock.tweetIds.join(", ") || "none"}).
anchorStatement ONLY for creator-answers-critics (the creator's verbatim response) — else null.
fanConsensus = your honest one-line read of the overall sentiment.
${corrections ? `\n⚠⚠ MANDATORY CORRECTIONS — fix ONLY these, change nothing else:\n${corrections}` : ""}

Return JSON with EXACTLY these fields: ${schema}`;

  // Surgical mode — low temp, merge over the previous draft (same contract as the news generator).
  if (previousArticle && corrections) {
    const { data, usage } = await chatImpl({ model, system: SYS, user, json: true, maxTokens, temperature: 0.2 });
    return { article: { ...previousArticle, ...(data || {}) }, usage };
  }

  let article = null, usage = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = attempt ? "\n\n⚠ Your previous output was INCOMPLETE. Return the FULL JSON." : "";
    const res = await chatImpl({ model, system: SYS, user: user + suffix, json: true, maxTokens, temperature: 0.7 });
    article = res.data; usage = res.usage;
    const words = (article?.body || "").split(/\s+/).filter(Boolean).length;
    if (article && words >= Math.min(lo, 300) && (article.keyTakeaways || []).length >= 3 && (article.faq || []).length >= 2) break;
  }
  return { article, usage };
}
