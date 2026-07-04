import { chat } from "../lib/openrouter.mjs";
import { GATE, MODELS } from "../config.mjs";
import { verifyClaims } from "../lib/claimcheck.mjs";
import { verifyGroundTruth } from "../lib/verifyEngine.mjs";
import { verifyGate } from "../lib/verifyGate.mjs";
import { verifyQuotes } from "../lib/quoteGuard.mjs";
import { specificsGuard } from "../lib/specificsGuard.mjs";

// PHASE C — classify a gate hardBlock string. BLOCK = an accuracy/grounding/must-have failure that must NEVER be
// auto-published (a fabrication, a contradicted fact, an ungrounded stray the writer left in, a missing
// image/embed/title). FIXABLE = a quality/structure nit (too short, missing FAQ/H2/links/Sources, a soft sub-score,
// dense readability) — retried to improve, and ACCEPTABLE on the terminal attempt once the piece is verified accurate.
// (2026-07-03 restructure: the judge no longer emits fabrication hardBlocks or an accuracy floor — accuracy
// enforcement lives in the DETERMINISTIC layers (claimcheck + verifyEngine + verifyGate + quoteGuard) plus the
// independent web reality-check, so "accuracy N < 8" double-jeopardy holds are gone from this regex.)
const BLOCK_RX = /^fabricated:|^CONTRADICTED \[|verify-gate BLOCK:|verify-gate CUT:|fabricated\/altered quote:|unverified claim|ungrounded fact|ungrounded specific|garbled non-Latin|prompt-leak|wrong-title|identity mismatch|^no title|no embedded video|no embedded posts|no >=?1200px image/i;
export function classifyBlocks(blocks) {
  const block = [], fixable = [];
  for (const b of blocks || []) (BLOCK_RX.test(b) ? block : fixable).push(b);
  return { block, fixable };
}

// A claim carries a CHECKABLE, DANGEROUS specific (the "fake news" kind) — a number/$/%/date, platform, award,
// season/episode, credit, chart position, or a direct quote — vs. a benign QUALITATIVE background line. We hold/cut
// ONLY the former; a true-but-unsourced qualitative background ("X is a literacy program") is common knowledge and
// is kept so a faithful article isn't gutted into a hold (owner 2026-07-03).
export const CHECKABLE_CLAIM = /\d|%|\$|["“”']|\b(netflix|prime|hulu|disney\+?|max|peacock|paramount|apple tv|amazon|hbo|theaters?|million|billion|grammy|oscar|emmy|bafta|golden globe|award|nominee|nominat|winner|won|renew|cancel|seasons?|episodes?|album|single|song|track|chart|billboard|hot 100|no\.?\s*1|number one|played|plays|stars?|starring|directed|produced|co-?wrote|composed|role as|premiere|release date|box office|gross|debut|opening|cinemascore|rotten tomatoes|metacritic|certified fresh|rated|rating)\b/i;

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
  // Don't shred on abbreviations / initials / decimals — protect their periods, split, then restore (the old
  // splitter corrupted Flesch worst on number-dense box-office prose: "$1.5M", "U.S.", "Mr.").
  const prot = String(text || "")
    .replace(/\b(Mr|Mrs|Ms|Dr|Jr|Sr|St|Mt|vs|etc|Inc|Co|Ltd|Corp|Sgt|Lt|Gen|Rev|Gov|Sen|Rep|No|Vol|U\.S|U\.K)\./g, "$1")
    .replace(/(\d)\.(\d)/g, "$1$2")
    .replace(/\b([A-Z])\.(?=\s*[A-Z])/g, "$1");
  return prot.split(/(?<=[.!?])\s+/).map((s) => s.replace(//g, ".").trim()).filter((s) => s.split(/\s+/).filter(Boolean).length >= 3);
}
// Keyword-matching helpers (step-3 gate-bug fixes): diacritic-fold so 'beyonce' matches 'Beyoncé'; word-boundary
// match so 'bear' ≠ 'beard'; and keep short PROPER tokens like 'F1' (the old length>3 filter erased them, letting any
// title containing 'movie' pass).
const deburr = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (hay, w) => new RegExp("\\b" + reEsc(w) + "\\b").test(hay);
const KW_STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are", "at", "by", "with", "from", "new"]);
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
  const kw = deburr(topic.primaryKeyword || "");
  // significant tokens: drop only stopwords (not by length), so short PROPER tokens like 'F1'/'UK' survive — the old
  // length>3 filter erased 'F1', letting any title containing 'movie' pass. Diacritic-folded + word-boundary matched.
  const kwTokens = kw.split(/\s+/).filter((w) => w.length >= 2 && !KW_STOP.has(w));
  const first100 = deburr(body.split(/\s+/).slice(0, 100).join(" "));
  const titleN = deburr(article.title || "");
  // keyword present if the exact phrase OR all significant tokens appear (word-boundary, so 'bear' != 'beard')
  const kwInTitle = (!!kw && hasWord(titleN, kw)) || (kwTokens.length > 0 && kwTokens.every((t) => hasWord(titleN, t)));
  const kwInFirst100 =
    (!!kw && hasWord(first100, kw)) ||
    (kwTokens.length > 0 && kwTokens.filter((t) => hasWord(first100, t)).length >= Math.ceil(kwTokens.length * 0.6));
  const kwInH2 = h2s.some((h) => kwTokens.length > 0 && kwTokens.every((t) => hasWord(deburr(h), t)));
  const faqCount = (article.faq || []).length;
  const ktCount = (article.keyTakeaways || []).length;

  // Per-niche structural thresholds: short-news is intentionally tighter (inverted pyramid, fast),
  // so the long-feature minimums (500w/6-FAQ/3-H2/Sources) would wrongly block it. Every other niche
  // keeps the strict rank-#1 defaults. The unique-value floor is still enforced via the LLM judge.
  // Per-form structural floors — each matches that form's OWN writing contract in generate.mjs, so the gate
  // never hard-blocks the very omission the writer prompt mandates (the audit caught the default forcing
  // ext:2 + Sources onto link-light/embed forms whose primary source is a STRUCTURED field or a banned
  // competitor, false-blocking correct drafts into wasted paid rewrites). All 8 news forms are explicit.
  const PROFILE = {
    // short inverted-pyramid news (movie/tv/celeb brief): a casting brief may legitimately have NO external
    // link (the contract says to OMIT Sources rather than pad with competitor links) — so ext:0, sources:false.
    news: { words: 300, faq: 3, h2: 1, kt: 0, ext: 0, sources: false },
    // box-office: usually cites Box Office Mojo (one primary source) — require at most that, never 2.
    "box-office": { words: 400, faq: 3, h2: 2, kt: 3, ext: 1, sources: false },
    // trailer preview: the embed + official synopsis are STRUCTURED fields, not body links.
    trailer: { words: 400, faq: 3, h2: 2, kt: 0, ext: 0, sources: false },
    // reaction roundup: sources are the EMBEDDED posts (structured tweetIds), aggregate attribution only.
    reaction: { words: 400, faq: 3, h2: 2, kt: 0, ext: 0, sources: false },
    // single-title where-to-watch news (just hit streaming / got a date):
    watchguide: { words: 600, faq: 3, h2: 2, kt: 3, ext: 2, sources: true },
    // awards winners-list: the structured winners list is the bulk; cites the ceremony's official source.
    awards: { words: 300, faq: 3, h2: 1, kt: 3, ext: 2, sources: true },
    // music news: the official artist post is a STRUCTURED embed; competitor outlets are banned as links.
    "music-news": { words: 350, faq: 3, h2: 1, kt: 0, ext: 0, sources: false },
    // music awards: like awards, has the ceremony's official source.
    "music-awards": { words: 300, faq: 3, h2: 1, kt: 3, ext: 2, sources: true },
  };
  // Fallback (should be unreachable now that all 8 news forms are explicit) keeps the strict rank-#1 default.
  const base = PROFILE[topic.formatTag] || { words: 400, faq: 3, h2: 2, kt: 3, ext: 2, sources: true };
  // C3 — GROUNDING-AWARE FLOORS: when the verified grounding is THIN (few sources / little real text), a SHORTER,
  // fully-grounded brief is the CORRECT output (Phase B tells the writer to write short, never pad/fabricate). Relax
  // the length/section/link floors so "accurate but short" is a legal, non-blocked outcome instead of a pad-or-block.
  const bsrc = (topic._bundle && topic._bundle.sources) || [];
  const groundChars = bsrc.reduce((n, s) => n + (s.text || "").length, 0);
  const thinGrounding = bsrc.length < 2 || groundChars < 1500;
  const p = thinGrounding
    ? { ...base, words: Math.min(base.words, 220), h2: Math.min(base.h2, 1), faq: Math.min(base.faq, 2), kt: 0, ext: 0, sources: false }
    : base;

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
  const kwExact = kw ? deburr(prose).split(kw).length - 1 : 0;
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
  trailer:
    "NOTE: this is a TRAILER preview (we did NOT watch it) — reward >=3 grounded context layers; HARD-BLOCK any shot/edit/dialogue/music/runtime narration ('the camera', 'we see', 'opens on', music cues) and any non-verbatim character quote. Date discipline: one exact release date everywhere.",
  reaction:
    "NOTE: this is a REACTION roundup — reward aggregate synthesis of the discourse + a forward 'what it signals'; hard-block named-user attribution, fabricated engagement numbers, and reviewing the film instead of the reaction.",
  watchguide:
    "NOTE: this is a single-title WHERE-TO-WATCH guide — reward the answer in the first 1-2 sentences, a clear Stream/Rent/Buy distinction, and shown reasoning on any window; hard-block a platform/date with NO receipt-or-estimate-label, device-list/boilerplate filler, and bloat past ~1100 words.",
};

export async function judge({ article, topic, model, metrics }) {
  // SCORE-ONLY judge (2026-07-03 restructure): quality scoring is its whole job — fabrication catching is owned
  // by the deterministic layers (claimcheck/verifyEngine/verifyGate/quoteGuard) + the web reality-check, which
  // was the 4th redundant pass over the same facts on the priciest model. Facts are provided as CONTEXT so the
  // accuracy/infoGain subscores are informed, capped tight (the old 60k-char injection paid for verification
  // this call no longer performs).
  const facts = (topic.facts || [])
    .map((f) => `- ${f.title}: ${(f.extract || "").slice(0, 2500)}`)
    .join("\n")
    .slice(0, 16000);
  const user = `${RUBRIC}

PRIMARY KEYWORD: ${topic.primaryKeyword}
TOPIC: ${topic.title} (${topic.contentType})
${topic.formatTag === "news" ? "NOTE: this is a SHORT-NEWS article — judge it by news standards (fast inverted-pyramid lead, freshness, every claim sourced/attributed, one unique sourced fact beyond the headline). Do NOT penalize it for being shorter than a feature, for fewer FAQ/H2s, or for not having a long analysis section; reward tight, accurate, well-attributed reporting." : ""}
${topic.formatTag === "box-office" ? "NOTE: this is a BOX-OFFICE report — judge it by TRADE-NEWS standards (Variety/Deadline), not feature-review standards. A crisp, authoritative, well-organized piece with accurate figures, the records in context, and a real analytical angle on what the result MEANS is excellent here — score humanVoice and infoGain on that basis (8-9 for a clear, insightful data story); do NOT require essayistic wit. Every dollar figure/record MUST match the facts." : ""}
${topic.formatTag === "awards" ? "NOTE: this is an AWARDS WINNERS-LIST — judge it by reference-news standards. The structured winners list renders separately, so the BODY is a lede + 'biggest winners/moments' + records; reward a strong decisive lede, accurate marquee winners, and records in context (score humanVoice/infoGain on that basis, not on essayistic length). CRITICAL: every winner/nominee/record MUST match the facts — hard-block ANY invented winner, nominee, host, venue, edition, or record." : ""}
${PLAYBOOK_NOTES[topic.formatTag] || ""}
${metrics ? `EDITOR METRICS (deterministic — factor into readability/phrasing/humanVoice): Flesch ${metrics.flesch} (target 60-72; <50 reads dense), avg sentence ${metrics.avgSentence}w, longest sentence ${metrics.maxSentence}w, generic-tell/AI-cliche hits ${metrics.bannedTells}, breathless filler-praise hits ${metrics.fillerPraise ?? 0} (each unbacked "stunning/masterful/riveting" is an AI-review tell — dock humanVoice), exact-keyword repeats ${metrics.kwExact}.` : ""}

REFERENCE FACTS the article was grounded on (context for your accuracy/infoGain subscores — a separate
deterministic verification layer has ALREADY diffed every claim against the full grounding, so do NOT
re-verify claim-by-claim; score how faithfully and how informatively the article works its material):
${facts}

ARTICLE (prose + the STRUCTURED FIELDS readers see):
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

Return STRICT JSON:
{ "score": 0-100 (reader-first: a high-SEO but stiff/generic/keyword-stuffed piece must score LOW),
  "subscores": {"accuracy":0-10,"readability":0-10,"humanVoice":0-10,"phrasing":0-10,"curiosity":0-10,"structure":0-10,"infoGain":0-10,"seo":0-10,"faqQuality":0-10,"completeness":0-10},
  "strengths": ["..."],
  "weaknesses": ["..."] }`;
  const { data } = await chat({
    model,
    system: "You are a demanding features editor who prizes readability and a genuine human voice ABOVE mechanical SEO. You are NOT an AI detector — never guess at origin; score craft and reader experience. Be strict and specific. Output strict JSON only.",
    user,
    json: true,
    maxTokens: 900,
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

  // Cost short-circuit: skip the paid LLM judge ONLY when the draft has a REAL block — a fabrication (factBlocks)
  // or a det BLOCK-category issue (garbled/prompt-leak/missing-title). A draft with only FIXABLE det nits (e.g.
  // keyword-not-in-title, too-short) STILL runs the judge so an accurate article gets a real score the Phase C
  // terminal-accept path can use (else an SEO nit would silently zero the score and hold an accurate piece).
  const detBlock = classifyBlocks(det.hardBlocks).block;
  if (detBlock.length || factBlocks.length) {
    return { score: 0, pass: false, subscores: {}, deterministic: det, hardBlocks: [...det.hardBlocks, ...factBlocks], claimCheck, cutClaims: claimCheck.contradicted.map((c) => c.claim).filter(Boolean), strengths: [], weaknesses: ["deterministic block"] };
  }

  // UNIVERSAL VERIFY GATE (rebuild Step 3/4): independently extract + verify EVERY claim against the gathered
  // source bundle + the structured authoritative facts — fail-closed, cheap model. This is the universal coverage
  // that replaces the old ~7-type allowlist; verifyGroundTruth above stays as the structured high-confidence layer.
  // Its corrections feed the SAME rewrite loop (run.mjs reads scored.claimCheck.corrections).
  const vbundle = { blocked: false, sources: [
    ...((topic._bundle && topic._bundle.sources) || []),
    ...(topic.facts || []).map((f) => ({ domain: String(f.title || "fact").slice(0, 40), owner: "structured", tier: "fact", text: f.extract || "", quotes: [] })),
  ] };
  const vg = vbundle.sources.length ? await verifyGate({ article, bundle: vbundle, model: MODELS.verify || "google/gemini-2.5-flash-lite" }) : null;
  if (vg && vg.corrections) claimCheck.corrections = [claimCheck.corrections, vg.corrections].filter(Boolean).join("\n");

  // DETERMINISTIC verbatim-quote guard (Phase B, model-independent): every quoted phrase must be a real
  // substring of the gathered source bundle AND not lifted out of a denial — catches misquotes the LLM pass
  // can miss, every time, at $0. A bad quote is a fixable block with a precise instruction.
  const qg = verifyQuotes(article, vbundle);
  if (!qg.ok) claimCheck.corrections = [claimCheck.corrections, `FABRICATED/ALTERED QUOTE — the quoted phrase(s) ${qg.badQuotes.map((q) => `"${q}"`).join(", ")} are NOT verbatim in the gathered sources. Use ONLY the exact words from the ON-THE-RECORD QUOTES, or remove the quotation marks and paraphrase.`].filter(Boolean).join("\n");

  // DETERMINISTIC specifics guard (gossip port, 2026-07-03): every significant NUMBER in reader copy and every
  // "according to X" attribution must exist in the grounding — model-independent, $0, fires every time. Its
  // findings are CUTTABLE (they join cutClaims below), so a stray figure is removed, never a dead-end hold.
  const sg = specificsGuard(article, vbundle.sources, topic);
  if (!sg.ok) claimCheck.corrections = [claimCheck.corrections, sg.corrections].filter(Boolean).join("\n");

  const j = await judge({ article, topic, model: judgeModel, metrics: det });
  const ss = j.subscores || {};
  // Judge = SCORE-ONLY (2026-07-03): its hardBlocks/fabrication pass was the 4th redundant layer over the same
  // facts and produced un-cuttable double-jeopardy holds. Fabrication blocks come exclusively from the
  // deterministic layers above (factBlocks) + the verify gate below + the web reality-check in run.mjs.
  const hardBlocks = [...det.hardBlocks, ...factBlocks];
  // A verify-gate BLOCK ALWAYS hard-blocks — even with an empty unsupported[] (the cheap extractor returned no
  // claims, or the bundle was empty): a draft the gate could NOT analyze must NOT pass (fail-closed, never open).
  if (vg && vg.verdict === "BLOCK")
    hardBlocks.push(`verify-gate BLOCK: ${vg.unsupported.length ? vg.unsupported.slice(0, 3).map((u) => u.claim.slice(0, 55)).join("; ") : (vg.reason || "could not verify the article against the gathered sources")}`);
  else if (vg && vg.verdict === "CUT" && vg.unsupported.length)
    hardBlocks.push(`verify-gate CUT: ${vg.unsupported.length} claim(s) not in the gathered sources — ${vg.unsupported.slice(0, 3).map((u) => u.claim.slice(0, 55)).join("; ")}`);
  if (!qg.ok) hardBlocks.push(`fabricated/altered quote: ${qg.badQuotes.slice(0, 2).map((q) => '"' + q.slice(0, 50) + '"').join("; ")} — use the exact source words or drop the quotation marks`);
  if (!sg.ok) hardBlocks.push(`ungrounded specific(s): ${sg.bad.slice(0, 3).map((b) => b.text).join("; ")} — every figure/outlet must exist in the gathered sources or authoritative facts`);
  // Only the CHECKABLE unverified claims block the piece — a benign qualitative background line doesn't (2026-07-03).
  const ccBadCheckable = (cc.bad || []).filter((b) => CHECKABLE_CLAIM.test(typeof b === "string" ? b : (b && b.claim) || ""));
  if (ccBadCheckable.length) hardBlocks.push(`${ccBadCheckable.length} unverified claim(s) (need correction)`);
  if (gt.findings.length > gt.contradicted.length) hardBlocks.push(`${gt.findings.length - gt.contradicted.length} ungrounded fact(s) (verify against the authoritative facts)`);

  // SOFT quality floors LOWERED for the brand-new-volume strategy (owner 2026-07-01): a real, accurate story that is
  // merely B-grade on voice/phrasing/infoGain/readability still PUBLISHES (7→5). ACCURACY (above) stays strict.
  if (typeof ss.infoGain !== "number" || ss.infoGain < GATE.infoGainMin) hardBlocks.push(`infoGain ${ss.infoGain ?? "missing"} < ${GATE.infoGainMin}`);
  if (typeof ss.readability !== "number" || ss.readability < 5) hardBlocks.push(`readability ${ss.readability ?? "missing"} < 5`);
  if (typeof ss.humanVoice !== "number" || ss.humanVoice < 5) hardBlocks.push(`humanVoice ${ss.humanVoice ?? "missing"} < 5`);
  if (typeof ss.phrasing !== "number" || ss.phrasing < 5) hardBlocks.push(`phrasing ${ss.phrasing ?? "missing"} < 5`);

  return {
    score: j.score,
    pass: (j.score || 0) >= GATE.publishMin && hardBlocks.length === 0,
    subscores: j.subscores,
    deterministic: det,
    hardBlocks,
    claimCheck, // {ok, bad, contradicted, corrections, verdicts, groundTruth} → drives the correction loop
    // Phase C cut-and-accept: the strays a verify-gate CUT verdict would remove (support was still >=85%, so they
    // are PERIPHERAL, not a contradiction). run.mjs may accept a CUT-only terminal article if every stray is
    // QUALITATIVE (no number/date/platform — those are caught separately as CONTRADICTED/fabricated and stay blocked).
    vgVerdict: vg ? vg.verdict : null,
    vgStrays: vg && vg.verdict === "CUT" ? (vg.unsupported || []).map((u) => u.claim) : [],
    // EVERY flagged claim text (ungrounded + contradicted + judge-flagged fabrication), so run.mjs can DETERMINISTICALLY
    // CUT those exact sentences from the body and still publish (owner 2026-07-02: publish everything the automation
    // builds — but a fabrication is REMOVED, never shipped).
    cutClaims: [
      // Only CUT an unsupported/unverified claim that carries a CHECKABLE SPECIFIC — a number/$/%/date, a platform,
      // an award, a season/episode, a credit verb, a chart position, or a direct quote. A benign QUALITATIVE
      // background line the thin source happened to omit (e.g. "the Imagination Library is a literacy program") is
      // TRUE common knowledge and LOW risk; cutting it just guts a faithful article into a hold (owner 2026-07-03:
      // publish engaging faithful briefs — hold only over DANGEROUS specifics). Contradictions + specifics-guard
      // number findings are ALWAYS cut (they're wrong or a bad figure, not merely un-sourced).
      ...(vg && vg.unsupported ? vg.unsupported.map((u) => u.claim).filter((c) => CHECKABLE_CLAIM.test(c)) : []),
      ...claimCheck.contradicted.map((c) => c.claim),
      ...(cc.bad || []).map((b) => (typeof b === "string" ? b : b && b.claim) || null).filter((c) => typeof c === "string" && CHECKABLE_CLAIM.test(c)),
      ...sg.bad.map((b) => b.text),
    ].filter((c) => typeof c === "string" && c.length > 8),
    strengths: j.strengths,
    weaknesses: j.weaknesses,
  };
}
