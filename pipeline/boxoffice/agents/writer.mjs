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
import { canonicalFigures } from "../moneyGuard.mjs";

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
RE-REPORT the story from the material you're given — same facts, better words — as ONE complete, engaging article a
reader actually finishes, in two parts:

  PART 1 — THE MOVIE: what it is (the premise + genre), who DIRECTED it, the CAST and the characters they play, and
  how it's being received (the buzz / reception) — is it shaping up as a hit or a disappointment.
  PART 2 — THE BOX OFFICE (or, for streaming, THE VIEWERSHIP): the money/audience story — the opening or current
  gross, how it's trending (the % move, holding or fading), the worldwide total, the budget-vs-gross profit read
  (for streaming: the hours viewed / rank + platform).

Open with a hook (the stars + the number), then DEVELOP each real fact into a full thought: what a number MEANS,
who is in the cast and the characters they play, what the premise is, how the gross compares to the budget, why
audiences did or didn't show up. You are given abundant real material below (the source reporting + the TMDB
context + the verified figures) — re-report it fully. This is a real article, not a caption.

ACCURACY — the one rule: every fact must come from the MATERIAL below. Re-word freely, but never invent or change a
number, a name, a character, a record, a comparison, or a "now streaming" platform, and never add a fact the
material doesn't contain. The SOURCE REPORTING may mention OTHER films (weekend roundups do) — use it only for THIS
film, and every NUMBER you state must appear in the VERIFIED FIGURES or the TMDB context. Automatic guards remove
anything unsupported, so write with the plain authority of a byline — no hedging, no "analysts say", no AI voice,
no commenting on your own accuracy.

STYLE: strong hook, short human paragraphs, a clear why-up/why-down, at most ${SEO.maxQuestionH2s} question-style
subheadings and they must be STORY-SPECIFIC (never "What's next?"-type filler), one natural use of the SEO keyword.
Engagement + readability is the #1 KPI. Return STRICT JSON only.`;

// Deterministic box-office section for a daily UPDATE — built ONLY from the CANONICAL figure set (the
// same single source of truth the title, metaTitle, boxOffice block, and FAQs draw from), so every number
// is accurate, invention-free, AND self-consistent across every surface of the article.
export function dailyBoxOfficeSection(job) {
  const canon = canonicalFigures({ gathered: job.gathered || {}, boxData: job.boxData || {}, film: job.film || {} });
  const sentences = [];
  const clause = [];
  if (canon.domestic) clause.push(`has grossed ${canon.domestic.text} at the domestic box office`);
  if (canon.dayInRelease) clause.push(`${canon.dayInRelease} days into its theatrical run`);
  if (canon.theaters) clause.push(`while playing across ${canon.theaters.text} theaters`);
  if (clause.length) sentences.push(`${job.film.title} ${clause.join(", ")}.`);
  if (canon.dailyGross) sentences.push(`The film added ${canon.dailyGross.text} in its most recent day of release.`);
  if (canon.worldwide) sentences.push(`Worldwide, it has taken in ${canon.worldwide.text}.`);
  if (canon.budget) sentences.push(`It carries a reported production budget of ${canon.budget.text}.`);
  return sentences.length ? `\n\n## At the Box Office\n\n${sentences.join(" ")}` : "";
}

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

  const schema = `{"title":"","metaTitle":"<=55 chars, NO brand/site name, LEAD with the FILM title + the concrete number/rank/milestone (e.g. \\"'Superman' Tops $500M at Box Office\\")","dek":"1-2 engaging sentences","metaDescription":"<=155 chars",
"keyTakeaways":["3-4 items"],"body":"markdown with ## H2s","faq":[{"q":"","a":"40-60 word answer"},{"q":"2-3 REAL reader questions","a":""}],
"about":[{"name":"","type":"Movie|Person|Organization"}],"tags":["4-8"],"imageQuery":"image search phrase for the film/star"}`;

  // THE FIX FOR SHORT ARTICLES: feed the writer the raw multi-outlet source prose the gatherer already
  // captured (job.bundle.sources[].text) — the same rich material the news lane hands its writer — instead
  // of only a 800-char distilled narrative. With real material to re-report, a cheap model reaches full
  // length faithfully; without it, it correctly wrote ~150 words. (plan: mirror generate.mjs's grounding.)
  // Redact $ money figures from the source prose. Weekend roundups are full of OTHER films' numbers, and a
  // cheap writer will lift them — then the fidelity wall cuts every unsupported figure and the article shrinks
  // back under the floor (the exact failure we saw: 8-12 cuts/draft). With money masked, the writer takes the
  // MOVIE + its RECEPTION from the prose and every NUMBER from the VERIFIED FIGURES block only.
  const redactMoney = (t) => String(t)
    .replace(/\$\s?\d[\d.,]*\s*(billion|million|thousand|[mbk])?\b/gi, "[$ figure]")
    .replace(/\b\d[\d.,]*\s*(billion|million)\b/gi, "[figure]");
  // Daily-chart box-office UPDATES skip the raw multi-outlet source prose: box-office coverage is number-dense,
  // so the writer lifts stray weekend / other-film figures that the fidelity wall then cuts en masse (the
  // draft-level-failure we saw). The update instead develops the RICH TMDB movie material (cast, premise, genre,
  // director, worldwide, budget) + the chart's own cume/daily/theaters + the milestone. Openings + streaming keep
  // the source prose — it's their length engine and their numbers are the story.
  const sourceProse = job.film?.dailyChart ? "" : redactMoney((job.bundle?.sources || [])
    .map((s) => `[${s.owner || s.domain || "source"}]\n${(s.text || "").trim().slice(0, 2200)}`)
    .filter((t) => t.replace(/^\[.*\]\n/, "").trim().length > 40)
    .join("\n\n---\n\n").slice(0, 6000));
  // Grounding-matched WORD BUDGET (news lane's technique): a target sized to how much real material exists,
  // never a hard floor that forces padding (padding = the fabrication this lane exists to prevent).
  const solidMaterial = sourceProse.length > 400 || (job.film?.overview || "").length > 100 || (job.boxData?.castRoles?.length || 0) >= 3;
  const isStreaming = !!form.streaming;
  const isDailyUpdate = !!job.film?.dailyChart;
  const isTV = form.category === "tv";
  // Streaming + daily box-office updates are FULL 200+ word stories built from the ALWAYS-rich TMDB material +
  // their own numbers (Netflix hours / the chart cume), so aim high; a first-report opening keeps the grounding-
  // matched budget tied to its trade coverage.
  const [budgetLo, budgetHi] = isDailyUpdate ? [190, 250] : isStreaming ? [220, 320] : (solidMaterial ? [240, 330] : [180, 240]);
  const structure = isStreaming
    ? `STRUCTURE — build the FULL story, developing EACH part into a full paragraph so the article clears 200 words (a real article, never a stub):
1) LEAD: a hook — the title and why it's a phenomenon right now (its Netflix rank or hours viewed).
2) WHAT IT IS: a brief introduction to the ${isTV ? "series" : "movie"} — a short description of the premise/story and its genre.
3) THE CAST: who stars in it and the characters they play, plus the creator/director.
4) THE NUMBERS: it's on Netflix — the hours viewed / views in the millions, this week's rank, and how many weeks it has held in the Top 10; explain how big that is.
5) WHY PEOPLE LOVE IT: the reception — why audiences are watching and what's driving the buzz (from the source reporting).
6) A closing line on its momentum.`
    : isDailyUpdate
    ? `Write a ~210-word profile of the MOVIE ITSELF. The verified box-office figures are added by the system as a separate section, so you write ONLY about the film — develop each part into a full paragraph:
1) LEAD: a hook introducing the film and why audiences are turning out for it (its premise, its stars) — NO numbers.
2) WHAT IT IS: the premise/story, the genre, the runtime, and the director — developed fully from the TMDB context.
3) THE CAST: the full cast and the characters they play.
4) THE APPEAL: why it is resonating with audiences right now (from the reception/context provided).
5) A closing line on the film.
⛔ CRITICAL: do NOT write ANY dollar amount, gross, cume, budget, theater count, day-in-release, ranking, percentage, or profit/loss — the system inserts every verified box-office figure itself in a separate section. Writing a number here only gets it cut. Write ONLY about the movie and its appeal.`
    : `STRUCTURE — develop EACH of these into full paragraph(s) (this is what makes it a real article, not a stub):
1) LEAD: the hook — the star(s) + the headline number, in one or two punchy sentences.
2) THE MOVIE: what it is (premise + genre + runtime), the director, and the CAST with the characters they play.
3) THE RECEPTION: how it's landing with audiences/critics (from the source reporting) — hit or miss.
4) THE MONEY: the opening/current gross, the % move (holding or fading), the worldwide total, budget-vs-gross.
5) A closing line on what the number means for the film.`;

  const user = `Write the article.

FORM: ${job.angle.form} — ${form.label}
${FORM_GUIDE[job.angle.form]}

${structure}

THE BRIEF (your editor's engagement distillation — follow it):
${JSON.stringify(job.brief, null, 1)}

SOURCE REPORTING — the trade coverage for THIS film's story + reception, to RE-REPORT in your own words (same facts, better words; never copy a sentence verbatim). Money figures are masked as [$ figure] on purpose — take the MOVIE and its RECEPTION from here, but EVERY number in your article must come from the VERIFIED FIGURES block below, never from this prose:
${sourceProse || "(no extended source prose — develop from the TMDB context + the brief + the verified figures below)"}

${boxDataBlock(job.boxData)}
${form.streaming ? "\n" + netflixBlock({ title: job.film.title, rank: g.netflixRank, hours: g.hoursViewed, weeksInTop10: g.weeksInTop10 }, { week: g.netflixWeek }) : ""}

VERIFIED FIGURES (the ONLY numbers that exist — copy exactly, invent nothing):
${verifiedFigures || "(no explicit trade figures — use ONLY the TMDB context above; do not state a number not shown there)"}

WORD BUDGET: ${budgetLo}-${budgetHi} words, and NEVER below 200 — a real, fully-developed story of this length. This is NOT a padding quota: develop every part of the STRUCTURE above (what it is, the cast and who they play, the description, what each number means, the reception) into a full paragraph and you will clear 200 naturally. NEVER invent a fact to reach length — a faithful, fully-developed article is the goal. SEO keyword (use once, naturally): ${job.brief.seoKeyword}
${corrections ? `\n⚠⚠ MANDATORY CORRECTIONS — fix ONLY these, change nothing else:\n${corrections}` : ""}

Return JSON with EXACTLY these fields: ${schema}`;

  if (previousArticle && corrections) {
    const { data } = await agentChat("writer", { system: SYS, user, surgical: true }, chatImpl ? { chatImpl } : {});
    job.article = { ...previousArticle, ...(data || {}) };
    return job;
  }

  // Rich material in hand, generate up to 2 drafts and keep the most fully-developed one. The retry NUDGE
  // asks the model to develop the material it left on the table (faithful) — it never asks it to pad to a
  // number (padding = the fabrication this lane exists to avoid). Stop early once a complete draft clears
  // the grounding-matched budget.
  const wc = (a) => (a?.body || "").split(/\s+/).filter(Boolean).length;
  const complete = (d) => !!d?.body && (d?.keyTakeaways || []).length >= 3 && (d?.faq || []).length >= 2;
  let best = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const nudge = attempt ? `\n\n⚠ Your previous draft left real material undeveloped — you have the full cast and the characters they play, the premise, the reception, and what each number means in the material above. Develop those into full paragraphs (same facts, better words). Do NOT invent anything; use only the material given.` : "";
    const { data } = await agentChat("writer", { system: SYS, user: user + nudge }, chatImpl ? { chatImpl } : {});
    if (!data?.body) continue;
    if (!best || (complete(data) && !complete(best)) || (complete(data) === complete(best) && wc(data) > wc(best))) best = data;
    if (complete(best) && wc(best) >= budgetLo) break;
  }
  // Daily updates: strip any box-office NUMBER sentence the cheap writer slipped in despite the instruction, so
  // nothing is left for the fidelity wall to cut, THEN append the deterministic verified figures. This is what
  // makes daily updates publish reliably — the numbers are 100% system-generated and accurate.
  if (isDailyUpdate && best?.body) {
    const prose = best.body.split(/(?<=[.!?])\s+/).filter((s) => !/\$\s?\d|\b\d[\d.,]*\s*(million|billion)\b|#\s?\d/i.test(s)).join(" ").trim();
    const keepProse = prose.split(/\s+/).filter(Boolean).length >= 120 ? prose : best.body.trim();
    best.body = keepProse + dailyBoxOfficeSection(job);
  }
  job.article = best;
  return job;
}
