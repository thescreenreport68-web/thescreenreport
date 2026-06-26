import { chat } from "../lib/openrouter.mjs";

const SYSTEM = `You are a senior staff writer for The Screen Report, a premium Hollywood / English-language film, TV & celebrity NEWS site. You write accurate, genuinely useful articles that win Google Discover, rank #1, and that real fans love to read and finish.

NON-NEGOTIABLE RULES for every article:
- ACCURACY: use ONLY facts in the provided REFERENCE FACTS or that are uncontroversially well-known. NEVER invent quotes, dates, box-office numbers, awards, or events. If unsure, leave it out. No hallucinations.
- HONEST CURIOSITY: the headline makes ONE specific, true, intriguing claim; the first 1-2 sentences DELIVER the core answer (no clickbait, no withholding). Then extend with depth and analysis.
- SMART-BREVITY STRUCTURE: a bold-led opening line that answers the query; paragraphs of 2-3 sentences (<=80 words); sentences <=25 words; a reader-benefit H2 subhead every ~150-250 words (>=3 H2s total, >=2 phrased as natural People-Also-Ask questions); bold the single key phrase per section; use lists or a table where they genuinely help.
- INFORMATION GAIN: include original framing — a ranking rationale, a verdict, a "why it matters", a clear POV — not a dry encyclopedia summary.
- LINKS: weave 2-4 internal links as markdown to sibling topics using paths like [text](/movies/<slug>/) or [text](/reviews/<slug>/); and cite >=3 authoritative EXTERNAL primary sources (Wikipedia, Box Office Mojo, Oscars.org, Rotten Tomatoes, official studio sites) inline and/or in a final "## Sources" list. NEVER link competitors (THR, Variety, Deadline, ScreenRant, Collider, IGN).
- VOICE: confident, knowledgeable, specific. NO AI throat-clearing ("In the world of...", "Buckle up", "In conclusion"), no filler, no hedging. Get to the point and keep it moving.
- STATS DISCIPLINE (anti-hallucination): do NOT state precise statistics — exact Rotten Tomatoes/Metacritic %, exact box-office dollar figures, exact dates — UNLESS they appear in the REFERENCE FACTS. If not provided, speak qualitatively ("one of his highest-rated", "grossed over a billion worldwide") and never invent a precise number.
- QUOTES (critical): NEVER present any sentence in quotation marks as a direct quote — from a person, film dialogue, or document — UNLESS that EXACT wording appears in the REFERENCE FACTS. If you don't have the verbatim words, PARAPHRASE with no quotation marks. Inventing, approximating, or misattributing a quote is a critical failure that can get us sued.
- LANGUAGE: write in clean English only. Never emit non-English/CJK characters, placeholder tokens, or garbled text.
- STRUCTURED FIELDS = PLAIN TEXT: verdict, rating.label, prosCons, infoCard, entries, tldr, factPanel, filmography, whereToWatch must contain NO markdown (no *, _, or links) and clean values — e.g. a birth date is exactly "August 17, 1991" (never garbled like "August 17,174 1991"). Double-check every date and number in these fields against the reference facts.
- NO SPECULATION: never state unannounced, upcoming, future-dated, or rumored projects/events, recent personal news, or uncertain trivia UNLESS it appears verbatim in the REFERENCE FACTS. Stick to confirmed, released, sourced facts. If you're not certain it's true and grounded, leave it out.
- RANKING / LIST pieces: include an explicit NUMBERED list (or a markdown table) of the ranked items in order, and be DECISIVE about #1 — no hedging two "best" picks.
- SOURCES: diversify — do NOT make every source Wikipedia; include the most authoritative available for the topic (Box Office Mojo, Oscars.org, Rotten Tomatoes, official studio) alongside Wikipedia.
- MARKDOWN HYGIENE: valid markdown only — every ** and * must be matched; never leave a dangling italic/bold marker.

Output STRICT JSON only — no prose around it.`;

// Per-niche extra structured fields + writing form (drives the niche UI modules + voice).
const NICHE = {
  review: {
    guide:
      "REVIEW form: open with the verdict, then argue it (performances, direction, craft, what works / what falls short). Spoiler-free unless the topic is explicitly a spoiler piece. Confident, specific critic voice.",
    fields:
      '"verdict":"one-line bottom-line judgment", "rating":{"score":<number 1-10>,"max":10,"label":"one-word tier e.g. Great"}, "prosCons":{"pros":["3-4 short phrases"],"cons":["2-3 short phrases"]}, "infoCard":{"director":"","cast":["3-5 names"],"releaseYear":"","runtime":"","rated":"","genre":""}',
  },
  list: {
    guide:
      "RANKING form: a short criteria intro, then each entry with a clear, opinionated rationale. Be DECISIVE about #1 (no two winners).",
    fields:
      '"entries":[{"rank":1,"title":"","year":"","blurb":"one-line why it ranks here"}]  // EVERY ranked item, in order from #1',
  },
  explainer: {
    guide:
      "EXPLAINER form: answer the core question in the first 1-2 sentences (BLUF), then unpack with Q&A subheads. Assume spoilers.",
    fields: '"tldr":"the short answer in 1-2 sentences", "spoiler": true',
  },
  profile: {
    guide:
      "PROFILE form: a bio lede, the career arc, signature roles. Use ONLY confirmed, released credits and facts present in the reference facts. Do NOT mention unannounced/upcoming/rumored projects or uncertain early-career trivia. Fill the fact panel and a filmography of the MAJOR released credits only.",
    fields:
      '"factPanel":{"born":"","nationality":"","activeYears":"","knownFor":["3-4 roles"]}, "filmography":[{"year":"","title":"","role":"","type":"Film|TV"}]',
  },
  guide: {
    guide:
      "STREAMING GUIDE = a CURATED, OPINIONATED RANKING (the form Google rewards), NOT a flat availability list. Rank the best picks and give EACH a confident critic's verdict on WHY it's worth watching — original recommendation value, a strong POV, a decisive #1. Add watch-order / which-edition / is-it-worth-your-subscription insight. Availability is a useful add-on, not the point: state a platform ONLY if that exact title is in the TMDB facts block, phrased 'as of [this month]; check before watching'. No unconfirmed sequels; keep all awards/numbers consistent.",
    fields:
      '"entries":[{"rank":1,"title":"","year":"","blurb":"a confident one-line verdict on why it\'s worth watching"}], "whereToWatch":[{"title":"","platform":"","type":"Stream|Rent|Buy","year":""}]',
  },
};
function resolveNiche(topic) {
  const t = (topic.contentType || "").toLowerCase();
  if (t.includes("review")) return "review";
  if (t.includes("rank") || t.includes("list")) return "list";
  if (t.includes("explain")) return "explainer";
  if (t.includes("profile")) return "profile";
  if (t.includes("guide") || t.includes("where")) return "guide";
  return null;
}

export async function generate({ topic, model, maxTokens = 6000 }) {
  const niche = NICHE[resolveNiche(topic)] || null;
  const facts =
    (topic.facts || []).map((f) => `- ${f.title}: ${f.extract}`).join("\n") ||
    "(none provided — rely only on uncontroversial, well-known facts; do not invent specifics)";

  const user = `Write the article.

TOPIC: ${topic.title}
CONTENT TYPE: ${topic.contentType}
CATEGORY / SUBCATEGORY: ${topic.category} / ${topic.subcategory}
PRIMARY KEYWORD (must appear in the title, the first 100 words, and at least one H2): ${topic.primaryKeyword}
ANGLE: ${topic.angle || "the most interesting TRUE angle"}${niche ? "\nNICHE STYLE: " + niche.guide : ""}

REFERENCE FACTS (ground every factual claim in these or in uncontroversial well-known facts):
${facts}

Return JSON with EXACTLY these fields:
{
 "title": "the H1/headline, 55-80 chars, ONE specific true claim, includes the primary keyword",
 "metaTitle": "SEO <title>, 50-60 chars, keyword front-loaded",
 "dek": "1-2 sentence standfirst that ADDS new info (does not restate the headline), <=170 chars",
 "metaDescription": "140-155 chars, keyword early",
 "keyTakeaways": ["3-5 answer-first bullets, <=22 words each"],
 "body": "the FULL article in MARKDOWN. Bold-led opening line. ## H2 subheads (>=3, >=2 as natural questions). 2-3 sentence paragraphs. Lists/tables where useful. End with a '## Sources' section containing >=3 authoritative EXTERNAL markdown links. Weave in 2-4 internal links as [text](/category/slug/). Do NOT include the H1/title or the key-takeaways in the body (they are rendered separately).",
 "faq": [{"q":"a real People-Also-Ask question","a":"answer-first, 40-150 words"}],
 "about": [{"name":"Exact Film or Show Title","type":"Movie","sameAs":"https://en.wikipedia.org/wiki/..."}],
 "tags": ["5-8 lowercase relevant tags"],
 "imageQuery": "the single best real person to depict in the hero photo — a specific actor or director full name (for a real, legal photo)"${niche ? ",\n " + niche.fields : ""}
}

Requirements: faq has >=6 entries; body has >=3 H2s with >=2 as questions and a Sources section with >=3 external links; about lists the specific title(s) the piece is about (empty array only if truly none).`;

  // Generate with a one-shot retry if the output is incomplete (missing FAQ / too short / no takeaways).
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const extra =
      attempt === 0
        ? ""
        : "\n\nYOUR PREVIOUS ATTEMPT WAS INCOMPLETE. Return COMPLETE valid JSON with: faq >=6 items; body >=600 words containing >=3 '## ' H2 headings (>=2 phrased as questions) AND a '## Sources' section with >=3 external links; keyTakeaways with 3-5 items.";
    const { data, usage, raw } = await chat({
      model,
      system: SYSTEM,
      user: user + extra,
      json: true,
      maxTokens,
      temperature: 0.6,
    });
    last = { article: data, usage, raw };
    const a = data || {};
    const okFaq = (a.faq || []).length >= 6;
    const okBody = (a.body || "").split(/\s+/).filter(Boolean).length >= 500;
    const okKt = (a.keyTakeaways || []).length >= 3;
    if (okFaq && okBody && okKt) return last;
  }
  return last;
}
