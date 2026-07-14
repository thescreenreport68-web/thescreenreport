// COPYWRITER + SEO agents. Faithful-only: condense the article, never invent facts (project accuracy mandate).
import { chat } from "../lib/openrouter.mjs";
import { PIN } from "./config.mjs";

const noMd = (s) => String(s || "").replace(/[*_`~#]+/g, "").replace(/\s{2,}/g, " ").trim();
const clamp = (s, n) => { s = noMd(s); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…"; };

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
  if (!lines.length) lines = [clamp(a.title, 40)];
  return {
    kicker: clamp(data.kicker || a.category, 18),
    headline: lines.join("<br>"),
    dek: clamp(data.dek || a.dek, 150),
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
- "celebrity" — stories primarily about a PERSON: relationships, family, red carpet, feuds, personal milestones, singers/musicians, a star's private life.
- "skip"      — NOT Hollywood/English-language entertainment: pure crime with no film/TV angle, non-entertainment sports figures, politics, or anything off our movie·TV·celebrity mandate.
RULES: If a FILM is the main subject → movies. If a SERIES is the main subject → tv. If a PERSON (their life/gossip/music) is the main subject → celebrity. When a film or show is the star of the story, prefer movies/tv over celebrity even if a famous name is attached. Use the given CATEGORY only as a hint; the actual content decides.
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
const SEO_SYS = `You are the Pinterest SEO strategist for The Screen Report. Pinterest is a visual SEARCH engine — keyword relevance in the pin title and description is the #1 ranking signal. Front-load the specific searchable terms people type (names, film/show titles, "cast", "release date", "2026", etc.). Faithful to the facts only.
Return STRICT JSON only:
{"title":"<=95 chars, keyword-rich and searchable, front-loaded with the main entity + hook",
 "description":"2-3 sentences, <=480 chars, keyword-rich and natural, weaves in the searchable terms + a soft call to action to read the full story. 3-6 relevant hashtags at the end (#MovieNews etc.)."}`;

export async function seo(a, copy) {
  const u = brief(a) + `\nCARD HOOK: ${copy.headline.replace(/<br>/g, " ")}`;
  let data = {};
  try { ({ data } = await chat({ model: PIN.seoModel, system: SEO_SYS, user: u, json: true, maxTokens: 500, temperature: 0.5 })); }
  catch {}
  return {
    title: clamp(data.title || a.metaTitle || a.title, 95),
    description: clamp(data.description || a.dek, 480),
  };
}
