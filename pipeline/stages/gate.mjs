import { chat } from "../lib/openrouter.mjs";

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

  const hardBlocks = [];
  if (!article.title) hardBlocks.push("no title");
  if (faqCount < 6) hardBlocks.push(`FAQ ${faqCount} < 6`);
  if (externalLinks < 3) hardBlocks.push(`external links ${externalLinks} < 3`);
  if (h2s.length < 3) hardBlocks.push(`H2s ${h2s.length} < 3`);
  if (ktCount < 3) hardBlocks.push(`keyTakeaways ${ktCount} < 3`);
  if (!kwInTitle) hardBlocks.push("primary keyword not in title");
  if (words < 500) hardBlocks.push(`body ${words}w < 500`);
  if (!hasSources) hardBlocks.push("no Sources section");
  // garbled / non-English tokens (CJK, Hangul, kana) have no place in an English article
  if (/[぀-ヿ㐀-鿿가-힯]/.test(JSON.stringify(article))) {
    hardBlocks.push("garbled non-Latin characters");
  }

  return {
    words, h2s: h2s.length, h2Questions, internalLinks, externalLinks,
    hasSources, faqCount, ktCount, kwInTitle, kwInFirst100, kwInH2, hardBlocks,
  };
}

const RUBRIC = `Score against The Screen Report rank-#1 + engagement standard:
- ACCURACY: every claim must be plausible/sourced; penalize any likely-fabricated quote/number/date hard.
- CURIOSITY: headline = one specific true claim; lead delivers the answer in 1-2 sentences; no clickbait; opens loops that pull the reader on.
- READABILITY: short paragraphs (2-3 sentences), scannable, reader-benefit question subheads, bold key phrases.
- STRUCTURE: BLUF lead, >=3 H2 (>=2 questions), Key-Takeaways, lists/tables where useful.
- INFORMATION GAIN: original framing/analysis/verdict/POV, not a dry summary.
- SEO: primary keyword placed well; strong meta; 6+ real PAA FAQ; >=3 authoritative EXTERNAL sources; internal links.
- VOICE/ENGAGEMENT: confident, specific, no AI filler; makes you want to read more and stay.`;

export async function judge({ article, topic, model }) {
  const user = `${RUBRIC}

PRIMARY KEYWORD: ${topic.primaryKeyword}
TOPIC: ${topic.title} (${topic.contentType})

ARTICLE:
${JSON.stringify({
    title: article.title,
    dek: article.dek,
    keyTakeaways: article.keyTakeaways,
    body: article.body,
    faq: article.faq,
    about: article.about,
  }).slice(0, 24000)}

Return STRICT JSON:
{ "score": 0-100,
  "subscores": {"accuracy":0-10,"curiosity":0-10,"readability":0-10,"structure":0-10,"infoGain":0-10,"seo":0-10,"faqQuality":0-10,"voice":0-10,"engagement":0-10,"completeness":0-10},
  "hardBlocks": ["any likely-fabricated fact or rule violation"],
  "strengths": ["..."],
  "weaknesses": ["..."] }`;
  const { data } = await chat({
    model,
    system: "You are a ruthless senior news editor scoring against a rank-#1 SEO + reader-engagement rubric. Be strict and specific. Output strict JSON only.",
    user,
    json: true,
    maxTokens: 1500,
    temperature: 0.2,
  });
  return data;
}

export async function gate({ article, topic, judgeModel }) {
  const det = deterministic(article, topic);
  const j = await judge({ article, topic, model: judgeModel });
  const hardBlocks = [...det.hardBlocks, ...(j.hardBlocks || [])];
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
