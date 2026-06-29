import { chat } from "../lib/openrouter.mjs";
import { GATE, MODELS } from "../config.mjs";
import { verifyClaims } from "../lib/claimcheck.mjs";
import { verifyGroundTruth } from "../lib/verifyEngine.mjs";
import { verifyGate } from "../lib/verifyGate.mjs";

// ---- Readability / human-voice helpers (free, deterministic) ----
function plainProse(md) {
  return (md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>`#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).filter(Boolean).length >= 3);
}
function countSyllables(w) {
  w = w.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const m = w.match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}
function fleschReadingEase(text) {
  const sents = splitSentences(text);
  const words = text.split(/\s+/).filter(Boolean);
  if (!sents.length || !words.length) return 60;
  const syl = words.reduce((n, w) => n + countSyllables(w), 0);
  return 206.835 - 1.015 * (words.length / sents.length) - 84.6 * (syl / words.length);
}
// Generic-AI / over-SEO "tells" — counted as a quality signal, NOT an AI detector.
const BANNED_TELLS = /\b(delve|tapestry|testament|pivotal|underscore|crucial|realm|boasts|elevate|intricate|seamless|nuanced|robust|multifaceted|foster|in the world of|when it comes to|it'?s worth noting|buckle up|in conclusion|at the end of the day|needless to say|stands? the test of time|cements? (his|her|its|their) (place|status|legacy)|not just .{1,45}? it'?s|moreover|furthermore|additionally)\b/gi;

// FIX-3 (engagement) — breathless filler-praise intensifiers. One, backed by a concrete detail, is fine;
// a PILE-UP is the AI-review tell that kills reader trust. Counted as a metric for the judge, and hard-
// blocked only on an egregious pile-up (so genuinely vivid writing still passes).
const FILLER_PRAISE = /\b(stunning|masterful|breathless|breathtaking|immersive|gripping|riveting|mesmeriz\w+|electrifying|spellbinding|tour de force|visceral|enthralling|dazzling|jaw-dropping|awe-inspiring|powerhouse|unforgettable|captivating|spectacular|phenomenal)\b/gi;

// FIX-3 — PROMPT-LEAK / META-REFUSAL phrases that must NEVER reach a reader. These leaked into FAQ copy
// AND the JSON-LD in prior drafts. They reference the prompt's own machinery ("the provided/reference
// facts", "as an AI") — unambiguous artifacts, so a hard-block here is safe (no legitimate-prose collision).
const PROMPT_LEAK = /\b(not (?:detailed|specified|mentioned|provided|stated|available|listed|included|clear) in the (?:provided |reference |given |available )?(?:facts|information|sources|text|article|context|material)|the (?:provided |reference |given )?(?:facts|information|sources|context)\b[^.]{0,40}?\b(?:do(?:es)?n'?t|do not|does not) (?:detail|specify|mention|provide|include|state|cover)|based on the provided (?:facts|information|context|sources)|as an ai(?: language model)?|i (?:cannot|can'?t|do not|don'?t) (?:have|provide|access)|the reference facts)\b/i;

// Deterministic, free checks computed from the article object (no LLM).
export function deterministic(article, topic) {
  const body = article.body || "";
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  const h2s = (body.match(/^##\s+.+/gm) || []).map((h) => h.replace(/^##\s+/, ""));
  const h2Questions = h2s.filter((h) => h.trim().endsWith("?")).length;
  const internalLinks = (body.match(/\]\(\/[^)]+\)/g) || []).length;
  const externalLinks = (body.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  const hasSources = /^##\s*Sources/im.test(body);
  const kw = (topic.primaryKeyword || "").toLowerCase();
  const kwTokens = kw.split(/\s+/).filter((w) => w.length > 3);
  const first100 = body.toLowerCase().split(/\s+/).slice(0, 100).join(" ");
  const titleLc = (article.title || "").toLowerCase();
  // keyword present if exact phrase OR all significant tokens appear (natural prose rarely repeats the exact phrase)
  const kwInTitle = titleLc.includes(kw) || (kwTokens.length > 0 && kwTokens.every((t) => titleLc.includes(t)));
  const kwInFirst100 =
    first100.includes(kw) ||
    (kwTokens.length > 0 && kwTokens.filter((t) => first100.includes(t)).length >= Math.ceil(kwTokens.length * 0.6));
  const kwInH2 = h2s.some((h) => kwTokens.every((t) => h.toLowerCase().includes(t)));
  const faqCount = (article.faq || []).length;
  const ktCount = (article.keyTakeaways || []).length;

  // Per-niche structural thresholds: short-news is intentionally tighter (inverted pyramid, fast),
  // so the long-feature minimums (500w/6-FAQ/3-H2/Sources) would wrongly block it. Every other niche
  // keeps the strict rank-#1 defaults. The unique-value floor is still enforced via the LLM judge.
  const PROFILE = {
    // short inverted-pyramid news (movie/tv/celeb brief): 1 H2 is fine, no key-takeaways floor (playbook).
    news: { words: 300, faq: 3, h2: 1, kt: 0, ext: 2, sources: false },
    // awards winners-list: the structured winners list is the bulk; the body is a lede + records narrative.
    awards: { words: 300, faq: 3, h2: 1, kt: 3, ext: 2, sources: true },
    // PLAYBOOK new/changed forms:
    watchguide: { words: 600, faq: 3, h2: 2, kt: 3, ext: 2, sources: true },
    recap: { words: 500, faq: 2, h2: 2, kt: 0, ext: 1, sources: false }, // recaps are short + spoiler-forward
    predictions: { words: 550, faq: 3, h2: 1, kt: 3, ext: 2, sources: true },
    // rankings need length for entries, but keep the floor MODEST (playbook Part-6 anti-padding rail) so a
    // tight, fully-grounded ranking isn't pushed to fabricate entries to clear it. 700 clears a real ranking.
    list: { words: 700, faq: 3, h2: 2, kt: 3, ext: 2, sources: true },
    review: { words: 650, faq: 3, h2: 2, kt: 3, ext: 2, sources: true },
  };
  // Defaults RELAXED (anti over-SEO): FAQ 6->4 (Google removed FAQ rich results), H2 3->2, body 500->400.
  const p = PROFILE[topic.formatTag] || { words: 400, faq: 3, h2: 2, kt: 3, ext: 2, sources: true };

  const hardBlocks = [];
  if (!article.title) hardBlocks.push("no title");
  if (faqCount < p.faq) hardBlocks.push(`FAQ ${faqCount} < ${p.faq}`);
  if (externalLinks < p.ext) hardBlocks.push(`external links ${externalLinks} < ${p.ext}`);
  if (h2s.length < p.h2) hardBlocks.push(`H2s ${h2s.length} < ${p.h2}`);
  if (p.kt && ktCount < p.kt) hardBlocks.push(`keyTakeaways ${ktCount} < ${p.kt}`);
  if (!kwInTitle) hardBlocks.push("primary keyword not in title");
  if (words < p.words) hardBlocks.push(`body ${words}w < ${p.words}`);
  if (p.sources && !hasSources) hardBlocks.push("no Sources section");
  // garbled / non-English tokens (CJK, Hangul, kana) have no place in an English article
  if (/[぀-ヿ㐀-鿿가-힯]/.test(JSON.stringify(article))) {
    hardBlocks.push("garbled non-Latin characters");
  }

  // Readability + human-voice signals (deterministic; the LLM judge does the nuanced scoring). These
  // guard against the worst over-SEO/AI-tell regressions; the soft cases feed the judge's subscores.
  const prose = plainProse(body);
  const sentLens = splitSentences(prose).map((s) => s.split(/\s+/).filter(Boolean).length);
  const maxSentence = sentLens.length ? Math.max(...sentLens) : 0;
  const avgSentence = sentLens.length ? Math.round(sentLens.reduce((a, b) => a + b, 0) / sentLens.length) : 0;
  const flesch = Math.round(fleschReadingEase(prose));
  const bannedTells = (prose.match(BANNED_TELLS) || []).length;
  const fillerPraise = (prose.match(FILLER_PRAISE) || []).length;
  const kwExact = kw ? prose.toLowerCase().split(kw).length - 1 : 0;
  // A single long sentence is tolerable (burstiness); a genuine run-on is not. Overall density is caught
  // by Flesch (<40 blocks) + the avg-sentence/readability scores — so hard-block only true run-ons (>55).
  if (maxSentence > 55) hardBlocks.push(`a ${maxSentence}-word run-on sentence (>55 — split it)`);
  if (flesch < 40) hardBlocks.push(`Flesch ${flesch} < 40 (too dense to read comfortably)`);
  if (kwExact > 8) hardBlocks.push(`keyword stuffed (exact phrase ${kwExact}x)`);

  // FIX-3: a meta-refusal / prompt-leak phrase anywhere a reader can see it (body, FAQ, takeaways, dek) is
  // a hard fail — it both breaks the reading experience and poisons the FAQ JSON-LD. Force a rewrite.
  const readerCopy = [body, article.dek || "", ...(article.faq || []).flatMap((f) => [f?.q, f?.a]), ...(article.keyTakeaways || [])].filter(Boolean).join("\n");
  if (PROMPT_LEAK.test(readerCopy)) hardBlocks.push("prompt-leak / meta-refusal phrase reached reader copy (e.g. 'not detailed in the provided facts' / 'the reference facts') — rewrite or omit");
  // FIX-3: breathless filler pile-up. Threshold is deliberately high (5) so vivid-but-earned writing passes;
  // the judge weighs the 1-4 range via humanVoice using the fillerPraise metric below.
  if (fillerPraise >= 5) hardBlocks.push(`breathless filler pile-up (${fillerPraise} empty intensifiers — back them with specifics or cut)`);

  // PLAYBOOK per-form deterministic guards — fire ONLY on clear, unambiguous violations (the judge handles
  // nuance). Each enforces the form's load-bearing promise so a structurally-wrong piece routes to review.
  const ft = topic.formatTag;
  // a review/recap MUST deliver a verdict or a rating
  if ((ft === "review" || ft === "recap") && !article.verdict && !(article.rating && typeof article.rating.score === "number"))
    hardBlocks.push(`${ft} has no verdict/rating (a review must deliver a verdict)`);
  // a RANKED list must be decisive — if entries are ranked, one must be #1
  if ((ft === "list" || ft === "guide") && Array.isArray(article.entries) && article.entries.length >= 3 &&
      article.entries.some((e) => typeof e?.rank === "number") && !article.entries.some((e) => Number(e?.rank) === 1))
    hardBlocks.push("ranked entries but no #1 (be decisive)");
  // a trailer whose TITLE promises "N Reveals/Things" must match the reveals contract
  const countM = (article.title || "").match(/\b(\d{1,2})\s+(reveals?|things|takeaways|moments)\b/i);
  if (ft === "trailer" && countM && Array.isArray(article.reveals) && article.reveals.length !== Number(countM[1]))
    hardBlocks.push(`title promises ${countM[1]} ${countM[2]} but reveals[] has ${article.reveals.length}`);
  // awards: never claim MORE wins than the grounded structured winners list supports
  if (ft === "awards" && Array.isArray(article.awardCategories)) {
    const winners = article.awardCategories.reduce((n, c) => n + (c.nominees || []).filter((x) => x.isWinner).length, 0);
    const wonM = body.match(/won\s+(\d{1,2})\s+(oscars|grammys|emmys|globes|awards)/i);
    if (winners > 0 && wonM && Number(wonM[1]) > winners) hardBlocks.push(`body claims "won ${wonM[1]} ${wonM[2]}" but only ${winners} winner(s) in the structured list`);
  }
  // watch-guide stays a fast answer, not a bloated feature
  if (ft === "watchguide" && words > 1100) hardBlocks.push(`watch-guide ${words}w > 1100 (keep it a fast answer)`);

  return {
    words, h2s: h2s.length, h2Questions, internalLinks, externalLinks,
    hasSources, faqCount, ktCount, kwInTitle, kwInFirst100, kwInH2,
    maxSentence, avgSentence, flesch, bannedTells, fillerPraise, kwExact, hardBlocks,
  };
}

const RUBRIC = `Score The Screen Report's READER-FIRST standard. Reader experience (readability, human voice, phrasing) matters MORE than mechanical SEO — a keyword-stuffed, stiff, or generic article must NOT pass even if technically "optimized."
- ACCURACY: every claim plausible/sourced; penalize any likely-fabricated quote/number/date HARD.
- READABILITY: would a busy fan read it effortlessly and finish it? Reward varied sentence rhythm, short paragraphs, plain words, real subheads; penalize dense, long-winded, monotone prose.
- HUMAN VOICE / ENGAGEMENT: reward a real POV, specifics (named scenes/actors/numbers), wit, surprise; penalize generic AI tells — negative parallelism ("not just X, it's Y"), throat-clearing, "delve/tapestry/testament/underscore", filler praise ("stunning/masterful" with no specific), copula-avoidance ("serves as"), templated repeated section shapes. You are NOT an AI detector — score engagement and human craft, never guess at origin.
- PHRASING / FLUENCY: does it read like a top news desk wrote it, unedited? Penalize forced/repeated keyword, keyword shoved into a heading, repeating a full name where a pronoun belongs, passive voice/nominalizations, stiff transitions.
- CURIOSITY: headline = one specific true claim; lead delivers the answer fast; no clickbait.
- INFORMATION GAIN: original framing/analysis/verdict/POV, not a dry summary.
- STRUCTURE: answer-first lead, useful subheads, Key Takeaways, lists/tables where they help.
- SEO (secondary): keyword present NATURALLY (not stuffed/forced into headings); strong meta; a few genuine FAQ that add NEW info; >=3 authoritative external sources; internal links. Over-optimization is a NEGATIVE, not a plus.`;

// PLAYBOOK per-form judge NOTEs (CATEGORY_UIUX_EDITORIAL_PLAYBOOK.md §2.3) — keyed by formatTag, injected
// into the judge prompt so the >=80 gate enforces EACH form's standard. (news/box-office/awards stay inline
// above.) Each = "judge by [X]; reward [payoff]; hard-block [failure mode]."
const PLAYBOOK_NOTES = {
  list:
    "NOTE: this is a RANKED LIST — reward a stated criterion, a decisive DEFENDED #1, and a fresh hook on every entry; penalize interchangeable boilerplate praise, plot-summary-as-blurb, a padded count, and unjustified ranks. Don't require essayistic length; reward decisiveness.",
  guide:
    "NOTE: this is a curated best-of list — reward a clear angle + a decisive editor's pick + rotated, verdict-first blurbs; penalize 'Netflix has tons' openers, 'This movie follows…' summary blurbs, and an undefended pick. Availability claims must match the facts.",
  explainer:
    "NOTE: this is an EXPLAINER — reward a fast frame-then-answer lede, a COMMITTED reading, and question-phrased H2s; hard-block an 'open to interpretation' non-answer, meaning-before-plot inversion, and any invented fate/post-credits/'the director said'.",
  trailer:
    "NOTE: this is a TRAILER preview (we did NOT watch it) — reward >=3 grounded context layers; HARD-BLOCK any shot/edit/dialogue/music/runtime narration ('the camera', 'we see', 'opens on', music cues) and any non-verbatim character quote. Date discipline: one exact release date everywhere.",
  reaction:
    "NOTE: this is a REACTION roundup — reward aggregate synthesis of the discourse + a forward 'what it signals'; hard-block named-user attribution, fabricated engagement numbers, and reviewing the film instead of the reaction.",
  watchguide:
    "NOTE: this is a single-title WHERE-TO-WATCH guide — reward the answer in the first 1-2 sentences, a clear Stream/Rent/Buy distinction, and shown reasoning on any window; hard-block a platform/date with NO receipt-or-estimate-label, device-list/boilerplate filler, and bloat past ~1100 words.",
  profile:
    "NOTE: this is a no-access celebrity PROFILE — reward a thesis + named eras + a triangulation graf; HARD-BLOCK a faked in-room/hotel scene (we did not interview them) and PR-bio transcribed as if observed.",
  interview:
    "NOTE: this is an INTERVIEW summary — reward a BLUF revelation + paraphrase-then-quote rhythm + thematic organization; hard-block invented scene-setting, quote-dumping, and wrong-speaker attribution. Quotes must be verbatim from the transcript/facts.",
  review:
    "NOTE: this is a REVIEW — reward a verdict-first stance, praise CHAINED to a named grounded reason, and one earned reservation; hard-block >50% plot-summary, non-verbatim dialogue quotes, a spoiler (it is not a recap), and prose POV that contradicts the score.",
  recap:
    "NOTE: this is an EPISODE RECAP (spoilers ON) — reward a spoiler banner, beat-by-beat analysis tied to the season arcs, and a 'Loose Threads' close; hard-block inventing a scene/line/death or any unaired episode, and grading the whole season.",
  predictions:
    "NOTE: this is an AWARDS PREDICTIONS piece — reward a state-of-the-race lede, every frontrunner citing a REAL named precursor, and a named spoiler; HARD-BLOCK anonymous sourcing ('insiders say'), fabricated %/odds, a logistics/ceremony-date lede, and listing contenders without ranking them.",
};

export async function judge({ article, topic, model, metrics, groundTruth }) {
  // The judge must see enough grounding to VERIFY claims (truncating long Wikipedia extracts causes
  // false "fabrication" flags on facts that live deeper in the article). Keep short must-verify blocks
  // (reactions, TMDB, release info) whole; cap long extracts generously.
  const facts = (topic.facts || [])
    .map((f) => {
      const ex = f.extract || "";
      const cap = ex.length <= 3000 ? ex.length : 18000;
      return `- ${f.title}: ${ex.slice(0, cap)}`;
    })
    .join("\n")
    .slice(0, 60000);
  const user = `${RUBRIC}

PRIMARY KEYWORD: ${topic.primaryKeyword}
TOPIC: ${topic.title} (${topic.contentType})
${topic.formatTag === "news" ? "NOTE: this is a SHORT-NEWS article — judge it by news standards (fast inverted-pyramid lead, freshness, every claim sourced/attributed, one unique sourced fact beyond the headline). Do NOT penalize it for being shorter than a feature, for fewer FAQ/H2s, or for not having a long analysis section; reward tight, accurate, well-attributed reporting." : ""}
${topic.formatTag === "box-office" ? "NOTE: this is a BOX-OFFICE report — judge it by TRADE-NEWS standards (Variety/Deadline), not feature-review standards. A crisp, authoritative, well-organized piece with accurate figures, the records in context, and a real analytical angle on what the result MEANS is excellent here — score humanVoice and infoGain on that basis (8-9 for a clear, insightful data story); do NOT require essayistic wit. Every dollar figure/record MUST match the facts." : ""}
${topic.formatTag === "awards" ? "NOTE: this is an AWARDS WINNERS-LIST — judge it by reference-news standards. The structured winners list renders separately, so the BODY is a lede + 'biggest winners/moments' + records; reward a strong decisive lede, accurate marquee winners, and records in context (score humanVoice/infoGain on that basis, not on essayistic length). CRITICAL: every winner/nominee/record MUST match the facts — hard-block ANY invented winner, nominee, host, venue, edition, or record." : ""}
${PLAYBOOK_NOTES[topic.formatTag] || ""}
${metrics ? `EDITOR METRICS (deterministic — factor into readability/phrasing/humanVoice): Flesch ${metrics.flesch} (target 60-72; <50 reads dense), avg sentence ${metrics.avgSentence}w, longest sentence ${metrics.maxSentence}w, generic-tell/AI-cliche hits ${metrics.bannedTells}, breathless filler-praise hits ${metrics.fillerPraise ?? 0} (each unbacked "stunning/masterful/riveting" is an AI-review tell — dock humanVoice), exact-keyword repeats ${metrics.kwExact}.` : ""}

${groundTruth && groundTruth.findings.length ? `⚠ MECHANICALLY VERIFIED CONTRADICTIONS — each was checked IN CODE against authoritative structured data (TMDB credits/dates/platform + OMDb ratings/box office) BEFORE you ran. Treat EVERY item below as a confirmed hardBlock regardless of how confident or polished the prose reads, and copy it into your hardBlocks:
${groundTruth.findings.map((f) => `• [${f.layer}] ${f.why}`).join("\n")}

` : ""}REFERENCE FACTS the article was grounded on (these are the authoritative, VERIFIED facts — TMDB + OMDb (credits/dates/providers/ratings/box-office), the official Academy Awards Database + first-party Golden Globes/Emmys (award winners), MusicBrainz + Last.fm + Billboard (music/charts), GDELT (breaking corroboration) — NO Wikipedia). A claim CONSISTENT with these is accurate. But you must also be STRICT about gaps: any checkable specific the article asserts — a Rotten Tomatoes/Metacritic/IMDb score or any %, a box-office/dollar figure, a date or year, a streaming platform, an award winner or nomination, a Billboard/chart position, a streaming-viewership number, a runtime — that is NOT present in these facts is UNGROUNDED: flag it as "fabricated: <the claim>". Do NOT give the writer the benefit of the doubt on a specific that does not appear here, no matter how plausible it sounds (every past fabrication was a plausible gap-fill, not a contradiction). Do NOT flag obvious common-knowledge background or analysis/opinion that asserts no specific.
${facts}

ARTICLE (prose + the STRUCTURED FIELDS readers see — verify these too; invented winners/platforms/dates live here):
${JSON.stringify({
    title: article.title,
    dek: article.dek,
    keyTakeaways: article.keyTakeaways,
    body: article.body,
    faq: article.faq,
    about: article.about,
    verdict: article.verdict,
    rating: article.rating,
    entries: article.entries,
    whereToWatch: article.whereToWatch,
    releaseWindows: article.releaseWindows,
    awardCategories: article.awardCategories,
    awardRecords: article.awardRecords,
    boxOffice: article.boxOffice,
    records: article.records,
    tracklist: article.tracklist,
    tourDates: article.tourDates,
    soundtrack: article.soundtrack,
    careerArc: article.careerArc,
    verdictBuckets: article.verdictBuckets,
  }).slice(0, 28000)}

FABRICATION CHECK (do this FIRST, before scoring — be mechanical and strict; this is the most important job):
Go through the article and check EACH of these against the REFERENCE FACTS. Add any unsupported one to hardBlocks as "fabricated: <the exact claim>":
 (a) direct quotes in quotation marks; (b) dollar figures / box-office numbers; (c) specific dates; (d) awards/nominations/winners/records; (e) deep-link IDs like "tt1234567"; (f) named statistics (RT/Metacritic %); (l) a Billboard/chart position or a music certification; (m) a streaming-viewership number (X million views/hours) — there is NO public source for OTT viewership, so any specific figure not attributed to a named outlet in the facts is fabricated.
 (g) EPISODES & SEASONS (critical): every specific episode or season the article names or ranks MUST appear in the REFERENCE FACTS. If the facts describe a show only through Season 2 and the article ranks or describes a "Season 3" episode (or any episode/title not in the facts), that episode is FABRICATED — flag it. Do not assume a later season exists.
 (h) RELEASE / AIR STATUS (critical): a review, ranking, or box-office report is only valid for a work that the facts show is RELEASED/AIRED. If the article reviews, reports box office for, or ranks episodes of something the facts indicate is unreleased / not-yet-aired / has no such data, flag it as "fabricated: reports on unreleased/unaired content".
 (i) TITLE IDENTITY (critical — name collisions): the article must be about the SAME specific title as the REFERENCE FACTS (matching year/director/cast). Many works share similar names. If the article's plot, cast, or details clearly describe a DIFFERENT work than the one in the facts (a same-named or similar-named other film/show), flag it as "fabricated: wrong-title / identity mismatch".
 (j) RANKED ITEMS: in a list/ranking, every ranked entry should be grounded; flag any invented entry.
 (k) STREAMING PLATFORM (critical): any claim that a title streams on / is available on / is a "[Platform] original" MUST match the platform named in the facts. A different platform is a fabrication ("fabricated: says X streams on Netflix, facts show Prime Video"). If the facts mark a film STREAMING-ORIGINAL, any box-office/theatrical claim for it is fabricated.
Rule of thumb: for (b)(d)(f)(g)(h)(i)(k), if a must-be-sourced specific is NOT in the facts, FLAG it — never pass a likely fabrication. (Do NOT flag obvious common-knowledge background, well-known released films, or current-availability claims that match the facts.)

Return STRICT JSON:
{ "score": 0-100 (reader-first: a high-SEO but stiff/generic/keyword-stuffed piece must score LOW),
  "subscores": {"accuracy":0-10,"readability":0-10,"humanVoice":0-10,"phrasing":0-10,"curiosity":0-10,"structure":0-10,"infoGain":0-10,"seo":0-10,"faqQuality":0-10,"completeness":0-10},
  "hardBlocks": ["any likely-fabricated fact or rule violation"],
  "strengths": ["..."],
  "weaknesses": ["..."] }`;
  const { data } = await chat({
    model,
    system: "You are a demanding features editor who prizes readability and a genuine human voice ABOVE mechanical SEO. You are NOT an AI detector — never guess at origin; score craft and reader experience. Be strict and specific. Output strict JSON only.",
    user,
    json: true,
    maxTokens: 1500,
    temperature: 0.2,
  });
  return data;
}

export async function gate({ article, topic, judgeModel }) {
  const det = deterministic(article, topic);

  // FREE verification — ALWAYS run, even on a structural short-circuit (the old code returned
  // claimCheck.ok=true WITHOUT checking — Problem #8). Two independent lines:
  //  (1) verifyClaims — claims[]-scoped receipt validation (PR2);
  //  (2) verifyGroundTruth — deterministic diff of the PROSE + STRUCTURED FIELDS vs the authoritative
  //      TMDB/OMDb facts (PR3) — independent of the writer's opt-out claims[]; catches platform/RT/OTT
  //      box-office/director contradictions the writer never listed.
  const cc = verifyClaims(article, topic);
  const gt = verifyGroundTruth(article, topic);
  const factCorrections = [cc.corrections, gt.corrections].filter(Boolean).join("\n");
  const factBlocks = [
    ...cc.contradicted.map((v) => `fabricated: ${v.claim} — ${v.why}`),
    ...gt.contradicted.map((f) => `CONTRADICTED [${f.layer}]: ${f.claim} — ${f.why}`),
  ];
  // The merged claim-check payload the run.mjs self-correct loop reads (corrections drive the rewrite).
  const claimCheck = { ok: cc.ok && gt.ok, corrections: factCorrections, bad: cc.bad, verdicts: cc.verdicts, contradicted: [...cc.contradicted, ...gt.contradicted], groundTruth: gt.findings };

  // Cost short-circuit: a structurally-broken draft routes to retry WITHOUT paying the LLM judge — but we
  // still surface the free fact corrections so the rewrite fixes structure AND facts in one pass.
  if (det.hardBlocks.length) {
    return { score: 0, pass: false, subscores: {}, deterministic: det, hardBlocks: [...det.hardBlocks, ...factBlocks], claimCheck, strengths: [], weaknesses: ["deterministic block"] };
  }

  // UNIVERSAL VERIFY GATE (rebuild Step 3/4): independently extract + verify EVERY claim against the gathered
  // source bundle + the structured authoritative facts — fail-closed, cheap model. This is the universal coverage
  // that replaces the old ~7-type allowlist; verifyGroundTruth above stays as the structured high-confidence layer.
  // Its corrections feed the SAME rewrite loop (run.mjs reads scored.claimCheck.corrections).
  const vbundle = { blocked: false, sources: [
    ...((topic._bundle && topic._bundle.sources) || []),
    ...(topic.facts || []).map((f) => ({ domain: String(f.title || "fact").slice(0, 40), owner: "authoritative", tier: "major", text: f.extract || "", quotes: [] })),
  ] };
  const vg = vbundle.sources.length ? await verifyGate({ article, bundle: vbundle, model: MODELS.verify || "google/gemini-2.5-flash-lite" }) : null;
  if (vg && vg.corrections) claimCheck.corrections = [claimCheck.corrections, vg.corrections].filter(Boolean).join("\n");

  const j = await judge({ article, topic, model: judgeModel, metrics: det, groundTruth: gt });
  const ss = j.subscores || {};
  const hardBlocks = [...det.hardBlocks, ...(j.hardBlocks || []), ...factBlocks];
  if (vg && (vg.verdict === "BLOCK" || vg.verdict === "CUT") && vg.unsupported.length)
    hardBlocks.push(`verify-gate ${vg.verdict}: ${vg.unsupported.length} claim(s) not in the gathered sources — ${vg.unsupported.slice(0, 3).map((u) => u.claim.slice(0, 55)).join("; ")}`);
  if (cc.bad.length) hardBlocks.push(`${cc.bad.length} unverified claim(s) (need correction)`);
  if (gt.findings.length > gt.contradicted.length) hardBlocks.push(`${gt.findings.length - gt.contradicted.length} ungrounded fact(s) (verify against the authoritative facts)`);

  // FAIL-CLOSED accuracy floor (priority #1): a missing/low accuracy score blocks — never silently skip.
  if (typeof ss.accuracy !== "number") hardBlocks.push("judge accuracy score missing — cannot verify accuracy");
  else if (ss.accuracy < 8) hardBlocks.push(`accuracy ${ss.accuracy} < 8`);

  if (typeof ss.infoGain !== "number" || ss.infoGain < GATE.infoGainMin) hardBlocks.push(`infoGain ${ss.infoGain ?? "missing"} < ${GATE.infoGainMin}`);
  if (typeof ss.readability !== "number" || ss.readability < 6) hardBlocks.push(`readability ${ss.readability ?? "missing"} < 6`);
  if (typeof ss.humanVoice !== "number" || ss.humanVoice < 7) hardBlocks.push(`humanVoice ${ss.humanVoice ?? "missing"} < 7`);
  if (typeof ss.phrasing !== "number" || ss.phrasing < 7) hardBlocks.push(`phrasing ${ss.phrasing ?? "missing"} < 7`);

  return {
    score: j.score,
    pass: (j.score || 0) >= GATE.publishMin && hardBlocks.length === 0,
    subscores: j.subscores,
    deterministic: det,
    hardBlocks,
    claimCheck, // {ok, bad, contradicted, corrections, verdicts, groundTruth} → drives the correction loop
    strengths: j.strengths,
    weaknesses: j.weaknesses,
  };
}
