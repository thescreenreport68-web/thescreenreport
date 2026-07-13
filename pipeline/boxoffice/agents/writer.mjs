// AGENT 5 — WRITER. One job: turn the brief + the verified figures into an ORIGINAL, engaging,
// readable box-office article in trade voice — stars-first, then the money story (plan §1 voice).
// Creativity ON (temp 0.7 fresh / 0.2 surgical) but the ACCURACY LINE is absolute: every money
// figure / % / theater count must be one the gatherer extracted or TMDB supplied; NO invented
// opening figure, domestic/international split, or record. Readability + engagement are the goal;
// SEO stays light (one natural keyword, no stuffing). The structured boxOffice{}/records[]/
// whereToWatch[] fields are assembled DETERMINISTICALLY downstream — the writer only writes prose.
import { agentChat } from "../models.mjs";
import { FORMS, SEO } from "../config.bo.mjs";
import { boxDataBlock } from "../boxofficeData.mjs";
import { netflixBlock } from "../netflix.mjs";

const FORM_GUIDE = {
  "BO-OPENING": `This is a DEBUT (opening weekend). PART 1 — the movie: what it is, its director + cast, the buzz,
is it landing with audiences. PART 2 — the box office: the OPENING figure (+ theaters / per-theater if given),
how big that is, the worldwide + budget/profit read. It's a debut, so don't write a "second-weekend drop" or a
weeks-in-release cume.`,
  "BO-UPDATE": `This is an UPDATE on a film already in theaters. PART 1 — the movie: what it is, its director +
cast, how it's being received. PART 2 — the box office: the NEW number and what moved (a milestone, a hold/drop
%, a fresh cume) and how it compares to before, the worldwide + budget/profit read.`,
  "NOW-STREAMING": `The film has left theaters and landed on a streaming platform. PART 1 — the movie: its
director + cast, its theatrical run. PART 2 — the confirmed PLATFORM it's now on + why it's worth streaming.`,
  "NETFLIX-TOP10": `A Netflix Top 10 movie. PART 1 — the title: its director + cast, what it is, why people are
watching. PART 2 — its HOURS VIEWED + this week's rank + weeks in the Top 10 (attributed to Netflix), streaming
on Netflix. Use relative timing ("in its second week"), never a specific release date.`,
  "TRENDING-TV": `A trending series. PART 1 — the series: its creator/cast, what it is, the buzz. PART 2 — its
Netflix rank / hours + platform + why it's blowing up. Use relative timing, never a specific release date.`,
};

const SYS = `You are a staff box-office reporter for a major entertainment outlet (Variety / Deadline / THR / TMZ).
Write ONE complete, engaging, scannable article a reader actually finishes — and write the WHOLE story, in two parts:

  PART 1 — THE MOVIE: what it is, who DIRECTED it, the CAST, how people are talking about it (the buzz /
  reception), and whether it's shaping up as a hit or a disappointment.
  PART 2 — THE BOX OFFICE (or, for streaming, THE VIEWERSHIP): the money/audience story — the opening or current
  gross, how it's trending (up or down, the % move, holding or fading), the worldwide total, the budget-vs-gross
  profit read (for streaming: the hours viewed / rank + platform).

Open with a hook (the stars + the number), then develop BOTH parts into full paragraphs. This is a real article,
not a caption — hit the WORD BUDGET below by developing each real fact into a full thought (what a number is,
what it MEANS, who's in it and who they play, why audiences showed up).

ACCURACY — the one rule: use ONLY the facts given to you below (the VERIFIED FIGURES + the CONTEXT: cast,
director, reception, worldwide, budget). If a fact isn't provided, don't state it — leave it out. Never invent or
round a number, a name, a record, a comparison, or a "now streaming" platform. Automatic guards remove anything
unsupported, so write with the plain authority of a byline and simply stay on the facts you're given — no hedging,
no "analysts say", no AI voice, no commenting on your own accuracy.

STYLE: strong hook, short human paragraphs, a clear why-up/why-down, at most ${SEO.maxQuestionH2s} question-style
subheadings and they must be STORY-SPECIFIC (never "What's next?"-type filler), one natural use of the SEO keyword.
Engagement + readability is the #1 KPI. Return STRICT JSON only.`;

// run(job, {corrections, previousArticle}) → job.article
export async function run(job, { corrections = null, previousArticle = null, chatImpl = null } = {}) {
  const form = FORMS[job.angle.form];
  const [lo, hi] = form.words;
  const g = job.gathered || {};

  const verifiedFigures = [
    g.openingWeekend ? `Opening weekend: ${g.openingWeekend}` : "",
    g.domestic ? `Domestic: ${g.domestic}` : "",
    g.international ? `International: ${g.international}` : "",
    g.worldwide ? `Worldwide (trade): ${g.worldwide}` : "",
    g.cume ? `Cume: ${g.cume}` : "",
    g.dropPct ? `Weekend drop: ${g.dropPct}` : "",
    g.theaters ? `Theaters: ${g.theaters}` : "",
    g.perTheater ? `Per-theater average: ${g.perTheater}` : "",
    g.records?.length ? `Records/milestones (only these are real): ${g.records.join("; ")}` : "",
    ...(g.numbers || []).map((n) => `Other reported figure (verbatim): ${n}`),
  ].filter(Boolean).join("\n");

  const schema = `{"title":"","metaTitle":"<=60 chars","dek":"1-2 engaging sentences","metaDescription":"<=155 chars",
"keyTakeaways":["3-4 items"],"body":"markdown with ## H2s","faq":[{"q":"","a":"40-60 word answer"},{"q":"2-3 REAL reader questions","a":""}],
"about":[{"name":"","type":"Movie|Person|Organization"}],"tags":["4-8"],"imageQuery":"image search phrase for the film/star"}`;

  const user = `Write the article.

FORM: ${job.angle.form} — ${form.label}
${FORM_GUIDE[job.angle.form]}

THE BRIEF (your editor's engagement distillation — follow it):
${JSON.stringify(job.brief, null, 1)}

PART 1 MATERIAL — the movie (write Part 1 from this + the cast/director in the CONTEXT below):
${[job.film?.overview ? `What it is: ${job.film.overview}` : "", g.narrative ? `How it's being received / the story the trades tell: ${g.narrative}` : ""].filter(Boolean).join("\n") || "(develop Part 1 from the cast, director, and the brief's hook)"}

PART 2 — VERIFIED FIGURES (the ONLY numbers that exist — copy exactly, invent nothing):
${verifiedFigures || "(no explicit trade figures — use ONLY the TMDB context below; do not state a number not shown there)"}

${boxDataBlock(job.boxData)}
${form.streaming ? "\n" + netflixBlock({ title: job.film.title, rank: g.netflixRank, hours: g.hoursViewed, weeksInTop10: g.weeksInTop10 }, { week: g.netflixWeek }) : ""}

WORD BUDGET: at least 340 words (target ${lo}-${hi}). This is a HARD floor — a draft under 340 words is REJECTED. Develop BOTH parts in full: the movie (what it is + director + the FULL cast + the buzz + hit-or-miss) and the money story (each figure, what it means, the trend, the profit read) — keep writing until you are well past 340. Never invent to reach length; you have enough real facts. SEO keyword (use once, naturally): ${job.brief.seoKeyword}
${corrections ? `\n⚠⚠ MANDATORY CORRECTIONS — fix ONLY these, change nothing else:\n${corrections}` : ""}

Return JSON with EXACTLY these fields: ${schema}`;

  if (previousArticle && corrections) {
    const { data } = await agentChat("writer", { system: SYS, user, surgical: true }, chatImpl ? { chatImpl } : {});
    job.article = { ...previousArticle, ...(data || {}) };
    return job;
  }

  // Affordable writers vary a LOT in length run-to-run (same input → 94-290 words). Rather than fight that,
  // EXPLOIT it: generate a few drafts and KEEP THE LONGEST complete one — this reliably lands a full-length
  // draft (≥ the owner's minimum) without a premium model. Stop early once a draft clears the bar.
  const wc = (a) => (a?.body || "").split(/\s+/).filter(Boolean).length;
  let best = null, bestWords = -1;
  for (let attempt = 0; attempt < 3; attempt++) {
    const suffix = attempt ? `\n\n⚠ Your previous draft was only ${bestWords} words — that is TOO SHORT. Write a LONGER, fuller article (develop the movie AND the money story in more depth, using the facts above). Return the FULL JSON.` : "";
    const { data } = await agentChat("writer", { system: SYS, user: user + suffix }, chatImpl ? { chatImpl } : {});
    if (!data?.body) continue;
    const words = wc(data);
    const complete = (data.keyTakeaways || []).length >= 3 && (data.faq || []).length >= 2;
    if ((complete && words > bestWords) || !best) { best = data; bestWords = words; }
    if (best && bestWords >= Math.min(lo, 190) && (best.keyTakeaways || []).length >= 3 && (best.faq || []).length >= 2) break;
  }
  job.article = best;
  return job;
}
