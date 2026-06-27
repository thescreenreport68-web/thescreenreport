import { chat } from "../lib/openrouter.mjs";
import { GATE } from "../config.mjs";

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
    news: { words: 350, faq: 3, h2: 2, kt: 0, ext: 2, sources: false },
    // awards winners-list: the structured winners list is the bulk; the body is a lede + records narrative.
    awards: { words: 300, faq: 3, h2: 1, kt: 3, ext: 2, sources: true },
  };
  // Defaults RELAXED (anti over-SEO): FAQ 6->4 (Google removed FAQ rich results), H2 3->2, body 500->400.
  const p = PROFILE[topic.formatTag] || { words: 400, faq: 4, h2: 2, kt: 3, ext: 2, sources: true };

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
  const kwExact = kw ? prose.toLowerCase().split(kw).length - 1 : 0;
  if (maxSentence > 45) hardBlocks.push(`a ${maxSentence}-word sentence (>45 — split it; unreadable)`);
  if (flesch < 40) hardBlocks.push(`Flesch ${flesch} < 40 (too dense to read comfortably)`);
  if (kwExact > 8) hardBlocks.push(`keyword stuffed (exact phrase ${kwExact}x)`);

  return {
    words, h2s: h2s.length, h2Questions, internalLinks, externalLinks,
    hasSources, faqCount, ktCount, kwInTitle, kwInFirst100, kwInH2,
    maxSentence, avgSentence, flesch, bannedTells, kwExact, hardBlocks,
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

export async function judge({ article, topic, model, metrics }) {
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
${metrics ? `EDITOR METRICS (deterministic — factor into readability/phrasing/humanVoice): Flesch ${metrics.flesch} (target 60-72; <50 reads dense), avg sentence ${metrics.avgSentence}w, longest sentence ${metrics.maxSentence}w, generic-tell/AI-cliche hits ${metrics.bannedTells}, exact-keyword repeats ${metrics.kwExact}.` : ""}

REFERENCE FACTS the article was grounded on (these are VERIFIED, including live streaming availability from TMDB). Treat any claim consistent with these as accurate. Only record a hardBlock for a claim that CONTRADICTS these facts, or a clearly invented quote/stat/event with no basis here. Do NOT hardBlock for incompleteness, for current-availability claims that match these facts, or for facts you personally can't verify but that appear here:
${facts}

ARTICLE:
${JSON.stringify({
    title: article.title,
    dek: article.dek,
    keyTakeaways: article.keyTakeaways,
    body: article.body,
    faq: article.faq,
    about: article.about,
  }).slice(0, 24000)}

FABRICATION CHECK (do this FIRST, before scoring — be mechanical and strict; this is the most important job):
Go through the article and check EACH of these against the REFERENCE FACTS. Add any unsupported one to hardBlocks as "fabricated: <the exact claim>":
 (a) direct quotes in quotation marks; (b) dollar figures / box-office numbers; (c) specific dates; (d) awards/nominations/winners/records; (e) deep-link IDs like "tt1234567"; (f) named statistics (RT/Metacritic %).
 (g) EPISODES & SEASONS (critical): every specific episode or season the article names or ranks MUST appear in the REFERENCE FACTS. If the facts describe a show only through Season 2 and the article ranks or describes a "Season 3" episode (or any episode/title not in the facts), that episode is FABRICATED — flag it. Do not assume a later season exists.
 (h) RELEASE / AIR STATUS (critical): a review, ranking, or box-office report is only valid for a work that the facts show is RELEASED/AIRED. If the article reviews, reports box office for, or ranks episodes of something the facts indicate is unreleased / not-yet-aired / has no such data, flag it as "fabricated: reports on unreleased/unaired content".
 (i) TITLE IDENTITY (critical — name collisions): the article must be about the SAME specific title as the REFERENCE FACTS (matching year/director/cast). Many works share similar names. If the article's plot, cast, or details clearly describe a DIFFERENT work than the one in the facts (a same-named or similar-named other film/show), flag it as "fabricated: wrong-title / identity mismatch".
 (j) RANKED ITEMS: in a list/ranking, every ranked entry should be grounded; flag any invented entry.
Rule of thumb: for (b)(d)(f)(g)(h)(i), if a must-be-sourced specific is NOT in the facts, FLAG it — never pass a likely fabrication. (Do NOT flag obvious common-knowledge background, well-known released films, or current-availability claims that match the facts.)

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
  const j = await judge({ article, topic, model: judgeModel, metrics: det });
  const hardBlocks = [...det.hardBlocks, ...(j.hardBlocks || [])];
  const ss = j.subscores || {};
  // Mandatory information-gain floor (spec rule): thin/derivative pieces must not publish.
  if (typeof ss.infoGain === "number" && ss.infoGain < GATE.infoGainMin) {
    hardBlocks.push(`infoGain ${ss.infoGain} < ${GATE.infoGainMin}`);
  }
  // Reader-quality floors (anti over-SEO): a stiff, generic, or hard-to-read piece must not publish,
  // however well "optimized" it is. These weight reader experience above mechanical SEO.
  if (typeof ss.readability === "number" && ss.readability < 6) hardBlocks.push(`readability ${ss.readability} < 6`);
  if (typeof ss.humanVoice === "number" && ss.humanVoice < 7) hardBlocks.push(`humanVoice ${ss.humanVoice} < 7`);
  if (typeof ss.phrasing === "number" && ss.phrasing < 7) hardBlocks.push(`phrasing ${ss.phrasing} < 7`);
  return {
    score: j.score,
    pass: j.score >= 80 && hardBlocks.length === 0,
    subscores: j.subscores,
    deterministic: det,
    hardBlocks,
    strengths: j.strengths,
    weaknesses: j.weaknesses,
  };
}
