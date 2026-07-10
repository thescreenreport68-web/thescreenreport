// AGENT 5 — WRITER. Its one job: turn the brief into an original, engaging, readable article.
// Creativity ON (temp 0.7 fresh / 0.2 surgical corrections) — but the ACCURACY LINE is absolute:
// every quote copied EXACTLY from the anchor block, every named person must exist in it, no invented
// names/dates/times/titles, audience posts attributed in aggregate only. Readability + engagement
// are the goal; SEO stays basic (one natural keyword, no stuffing).
import { agentChat } from "../models.mjs";
import { FORMS, SEO } from "../config.inside.mjs";

const FORM_GUIDE = {
  "audience-reaction": `SKELETON — how people are reacting:
1. HOOK lede (from the brief): the work + the honest shape of the reaction, written to pull the reader in.
2. THE SPINE = the AUDIENCE posts (A1, A2…): characterize the mood in YOUR words, then SHOW the real posts
   as beats, grouped by sentiment, ALWAYS naming the platform ("one X user wrote…", "a fan on Reddit said…");
   if divided, both sides get real posts.
3. Critics/named voices: AT MOST one short "critics, meanwhile…" paragraph — never the spine.
4. One "why it's landing this way" beat (your analysis). 5. Close on where the conversation is heading.`,
  "the-debate": `SKELETON — the argument:
1. HOOK: the ONE specific thing people are arguing about.
2. Side A (framing + real AUDIENCE posts, platform named) → Side B (same); your voice between the quotes;
   named/critic quotes at most one beat.
3. "Why this hit a nerve" beat. 4. Close without forcing a winner.`,
  "creator-answers-critics": `SKELETON — a creator answers back:
1. HOOK: the criticism + that [named creator] has now responded.
2. The audience criticism (real posts, aggregate). 3. The creator's REAL response — verbatim, attributed
   by name. 4. Close on how it landed.`,
  "breakout-buzz": `SKELETON — who everyone's talking about:
1. HOOK: the moment that made them the talk of the internet. 2. Who they are + what people are saying
   (real posts; named praise verbatim). 3. "Why now" beat. 4. What's next.`,
};

const SYS = `You are the writer for The Screen Report's audience-reaction & discourse desk. You write
ORIGINAL, lively, scannable articles people finish.

THE ACCURACY LINE (machine-enforced; violations kill the article):
- Craft the narrative freely, anchored by the brief — but NEVER invent a quote, name, date, time, or title.
- Every quoted span must be copied EXACTLY from the ANCHOR block (find the anchor by its id) — with ZERO
  added formatting: never bold/italic markers or brackets inside quotation marks, never a leading space.
- AUDIENCE posts are the article's spine: attribute in aggregate WITH THE PLATFORM ("one X user wrote",
  "a fan on Reddit said") — never a name/handle for an ordinary person. Prefer posts with [tweet:id] (they
  render as the real embedded post). Named/critic quotes = one short beat at most. Never state a rumor as
  fact. No numbers not in the anchors.

CRAFT: hook first (use the brief's hook), short paragraphs, the real posts as visual beats, curiosity in
structure (build to the standout anchors — strongest last), at most ${SEO.maxQuestionH2s} question-style H2s,
one natural use of the SEO keyword — nothing stuffed. Return STRICT JSON only.`;

// run(job, {corrections, previousArticle}) → job.article
export async function run(job, { corrections = null, previousArticle = null, chatImpl = null } = {}) {
  const form = FORMS[job.angle.form];
  const [lo, hi] = form.words;
  const anchors = (job.factBlock.stats.namedVoices || 0) + (job.factBlock.stats.fanPosts || 0);
  const budget = Math.min(hi, Math.max(lo, lo + anchors * 40));

  const schema = `{"title":"","metaTitle":"<=60 chars","dek":"1-2 engaging sentences","metaDescription":"<=155 chars",
"keyTakeaways":["3-4 items"],"body":"markdown with ## H2s","faq":[{"q":"","a":"40-60 word answer"}],
"about":[{"name":"","type":"Person|Movie|TVSeries|Organization"}],"tags":["4-8"],"imageQuery":"image search phrase",
"reactionsRender":[{"speaker":"","connection":"","platform":"","date":"","quote":"EXACT anchor quote","tweetId":""}],
"anchorStatement":{"speaker":"","connection":"","quote":"","platform":""},
"fanConsensus":"one-line honest sentiment read","claims":[{"text":"hard fact used","sourceQuote":"anchor line"}]}`;

  const user = `Write the article.

FORM: ${job.angle.form} — ${form.label}
${FORM_GUIDE[job.angle.form]}

THE BRIEF (your editor's distillation — follow it):
${JSON.stringify(job.brief, null, 1)}

THE ANCHOR BLOCK (the ONLY quotes/voices that exist — copy quotes EXACTLY from here by ref):
${job.factText}

WORD BUDGET: ~${budget} words. SEO keyword (use once, naturally): ${job.brief.seoKeyword}
Available X embed ids (use in reactionsRender only if the post matches): ${job.embeds?.tweetIds?.join(", ") || "none"}
reactionsRender = 6-12 display cards, ordered to build to the standouts. anchorStatement ONLY for
creator-answers-critics. ${corrections ? `\n⚠⚠ MANDATORY CORRECTIONS — fix ONLY these, change nothing else:\n${corrections}` : ""}

Return JSON with EXACTLY these fields: ${schema}`;

  if (previousArticle && corrections) {
    const { data } = await agentChat("writer", { system: SYS, user, surgical: true }, chatImpl ? { chatImpl } : {});
    job.article = { ...previousArticle, ...(data || {}) };
    return job;
  }

  let article = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = attempt ? "\n\n⚠ Your previous output was INCOMPLETE. Return the FULL JSON." : "";
    const { data } = await agentChat("writer", { system: SYS, user: user + suffix }, chatImpl ? { chatImpl } : {});
    article = data;
    const words = (article?.body || "").split(/\s+/).filter(Boolean).length;
    if (article && words >= Math.min(lo, 300) && (article.keyTakeaways || []).length >= 3 && (article.faq || []).length >= 2) break;
  }
  job.article = article;
  return job;
}
