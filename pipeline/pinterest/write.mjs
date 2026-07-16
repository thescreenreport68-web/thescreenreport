// COPYWRITER + SEO agents. Faithful-only: condense the article, never invent facts (project accuracy mandate).
// 2026-07-16 external audit root fixes: '#'-preserving sanitizer, hashtags as validated DATA (0–3, not prose),
// fact/entity verification with regenerate-then-fallback, no ellipsis-truncated copy, CTA rotation.
import { chat } from "../lib/openrouter.mjs";
import { PIN } from "./config.mjs";
import { noMd, factCheck, cleanHashtags, completeSentences, finishPinTitle, frontLoaded, ctaFor } from "./copyfinish.mjs";

// word-boundary shorten (kicker/on-card only — pin titles/descriptions use the finishers, never this)
const shorten = (s, n) => { s = noMd(s); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "").replace(/[\s,;:-]+$/, ""); };

const brief = (a) => `HEADLINE: ${a.title}
CATEGORY: ${a.category}
SUMMARY: ${a.dek}
KEY FACTS:
${(a.keyTakeaways || []).slice(0, 5).map((t) => "- " + t).join("\n") || "- " + a.whatWeKnow}
ARTICLE (for detail, do not copy verbatim): ${a.body.slice(0, 1500)}`;

// ── Copywriter (hook specialist): the on-CARD text — a scroll-stopping hook headline + one tight detail line.
const COPY_SYS = `You are the hook-writing specialist for The Screen Report, a premium Hollywood-news brand, writing the text that goes on a Pinterest news CARD. Shrink the story to its most magnetic, scroll-stopping essence — but stay 100% faithful to the facts given (never invent names, numbers, dates, or claims; if unsure, leave it out).
Return STRICT JSON only:
{"kicker":"1-2 word label in Title Case (e.g. Celebrity, Box Office, Casting, First Look, TV)",
 "headlineLines":["line 1","line 2"],   // the HOOK: 4-9 words total across 1-2 short lines, punchy, curiosity-driven, NOT clickbait the facts don't support; Title Case; no end punctuation
 "dek":"ONE tight sentence (max ~22 words) with the essential detail — who/what/why it matters. Faithful."}
Keep each headline line short (aim <=18 characters) so it sets large and clean. Match tone to the story (somber for tragedy).`;

export async function copywriter(a) {
  let data = {};
  try { ({ data } = await chat({ model: PIN.copyModel, system: COPY_SYS, user: brief(a), json: true, maxTokens: 500, temperature: 0.6 })); }
  catch { try { ({ data } = await chat({ model: PIN.copyFallback, system: COPY_SYS, user: brief(a), json: true, maxTokens: 500, temperature: 0.6 })); } catch {} }
  let lines = (data.headlineLines || []).map((l) => noMd(l)).filter(Boolean).slice(0, 2);
  if (!lines.length) lines = [shorten(a.title, 40)];
  return {
    kicker: shorten(data.kicker || a.category, 18),
    headline: lines.join("<br>"),
    dek: completeSentences(data.dek || a.dek, 150),
  };
}

// ── Board router (content classifier): READ the story and decide which of our 3 Pinterest boards it belongs
// on — Movies, TV series, or Celebrity — the way a human editor would. Owner rule (2026-07-14): the pin must
// land on the board that best matches what the IMAGE/STORY is actually about, not just its raw tag. Also acts
// as the on-brand gate: anything that isn't Hollywood/English-language movie·TV·celebrity entertainment → skip.
const BOARD_SYS = `You are the board editor for The Screen Report's Pinterest. Read the story and decide the ONE board it belongs on, by understanding what it is actually about (not just its tag).
BOARDS:
- "movies"    — theatrical or streaming FILMS: box office, film casting, trailers, reviews, release news, franchises, animated features (e.g. Moana, Toy Story 5, a Marvel film, a biopic movie).
- "tv"        — TV & streaming SERIES: show renewals/cancellations, series casting, episode/season/finale talk, streaming-series news (e.g. House of David, a Netflix series, a reality-TV season).
- "celebrity" — UPBEAT entertainment-celebrity news: relationships, dating, marriages, family/baby news, red carpet, career moves, feuds, brand launches, music releases, a star's public life. Entertainment figures only (film/TV/music stars, name reality-TV personalities).
- "skip"      — anything that does NOT belong on a premium, upbeat entertainment Pinterest. ALWAYS skip, even if a famous/music/reality person is attached: (a) crime, shootings, 911 calls, arrests, indictments, lawsuits, abuse or assault, overdoses, accidents, disturbing/tragic incidents; (b) DEATHS, obituaries, memorials or tribute pieces (even a natural death of a beloved star — tonally wrong for this platform); (c) OPINION / editorial / commentary / "think-piece" / moral-take / "why X matters" arguments where the outlet's viewpoint (not a reported event) is the story; (d) POLITICS or partisan content, politicians, elections, or "celebrities vs politics" framing; (e) non-entertainment sports figures, and anything else off our movie·TV·celebrity entertainment mandate.
RULES: If a FILM is the main subject → movies. If a SERIES is the main subject → tv. If an entertainment PERSON's public life is the subject → celebrity. When a film or show is the star of the story, prefer movies/tv over celebrity even if a famous name is attached. A crime/tragedy/death/opinion/political story is ALWAYS "skip" — never route it to a board just because a person is involved. Reported entertainment EVENTS (casting, trailers, releases, box office, renewals, awards/nominations, red carpet, relationships, new music, fan reactions to a film/show) are good; the outlet's OPINION about them is not. Use the given CATEGORY only as a hint; the actual content decides.
Return STRICT JSON only: {"board":"movies|tv|celebrity|skip","why":"<=8 words"}`;

export async function classifyBoard(a) {
  const u = brief(a);
  let data = {};
  try { ({ data } = await chat({ model: PIN.curateModel, system: BOARD_SYS, user: u, json: true, maxTokens: 120, temperature: 0 })); }
  catch { try { ({ data } = await chat({ model: PIN.seoModel, system: BOARD_SYS, user: u, json: true, maxTokens: 120, temperature: 0 })); } catch {} }
  let board = String(data.board || "").toLowerCase().trim();
  if (!["movies", "tv", "celebrity", "skip"].includes(board)) {
    // fail-safe: fall back to the article's own category mapping rather than guessing
    const c = a.category;
    board = ["tv", "series", "television", "streaming"].includes(c) ? "tv"
      : ["celebrity", "celebrities", "gossip", "music"].includes(c) ? "celebrity"
      : ["movies", "movie", "box-office", "boxoffice", "awards"].includes(c) ? "movies" : "celebrity";
  }
  return { board, why: String(data.why || "").slice(0, 40) };
}

// ── SEO strategist: the pin's keyword-rich TITLE + DESCRIPTION (Pinterest = a search engine).
// Copy must read naturally to a HUMAN first — keywords woven into real sentences, never keyword salad.
// Hashtags come back as a separate ARRAY (validated data, 0–3 max — Pinterest gives hashtags ~no ranking
// weight post-2020, so prose keywords carry the load). Every draft is fact-checked against the article;
// one regeneration on mismatch, then a deterministic article-derived fallback (faithful by construction).
const SEO_SYS = `You are the Pinterest SEO strategist for The Screen Report, a premium Hollywood-news brand. Pinterest is a visual SEARCH engine — but pins are read by PEOPLE first: write natural, complete sentences a human enjoys reading, with the searchable terms (names, film/show titles, "cast", "release date", the year) woven in organically. Use ONLY facts, names, numbers and years that appear in the material below — never invent or "correct" anything.
Return STRICT JSON only:
{"title":"a COMPLETE phrase, 40-70 chars, that puts the main entity + topic inside the first 40 characters. Never end mid-phrase.",
 "description":"2-4 complete sentences, 200-400 chars total, natural and specific, weaving in searchable terms. End with this exact call to action: <CTA>",
 "hashtags":["0-3 hashtags, each a single #CamelCase token naming this story's entities or a broad category like #MovieNews. Omit entirely if none feel natural."]}`;

export async function seo(a, copy) {
  const cta = ctaFor(a.slug);
  const sys = SEO_SYS.replace("<CTA>", cta);
  const base = brief(a) + `\nCARD HOOK: ${copy.headline.replace(/<br>/g, " ")}`;
  let title = "", description = "", tags = [];
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let data = {};
    try { ({ data } = await chat({ model: PIN.seoModel, system: sys, user: base + feedback, json: true, maxTokens: 500, temperature: attempt ? 0.3 : 0.5 })); }
    catch { break; }
    title = finishPinTitle({ model: data.title, article: a });
    description = completeSentences(data.description, 400);
    tags = cleanHashtags(Array.isArray(data.hashtags) ? data.hashtags : [], a);
    const fc = factCheck(a, title + " " + description);
    if (fc.ok && frontLoaded(title, a)) break;
    feedback = `\n\nYOUR PREVIOUS DRAFT FAILED VERIFICATION. These items are NOT supported by the article — remove or correct each one using only the article's own words: ${fc.missing.join(", ") || "(title must open with the story's main entity)"}. Rewrite completely.`;
    title = ""; description = "";
  }
  // deterministic fallback — built purely from the article, so it can never assert an unsupported fact
  if (!title || !description || !factCheck(a, title + " " + description).ok) {
    title = finishPinTitle({ model: "", article: a });
    description = completeSentences(a.dek || a.whatWeKnow || a.title, 320) + " " + cta;
    tags = cleanHashtags(["#MovieNews"], a);
  }
  // budget-aware assembly (Pinterest cap 480) — drop hashtags before ever cutting a sentence
  let full = tags.length ? `${description} ${tags.join(" ")}` : description;
  if (full.length > 480) full = description.length <= 480 ? description : completeSentences(description, 480);
  return { title, description: full.trim() };
}
