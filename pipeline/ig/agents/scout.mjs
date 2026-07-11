// AGENT 1 — SCOUT: pick today's slate for VIRAL potential (plan §2.2 #1, §4).
// Deterministic candidate pool (articles, freshness, category, ledger dedup) +
// one cheap LLM scoring call per candidate batch. Sendability first — sends-per-reach
// is the #1 lever for non-follower reach (Mosseri, verified).
import fs from "node:fs";
import path from "node:path";
import { IG } from "../config.mjs";
import { llm } from "../models.mjs";
import { isPosted, isHeld, isBuilt, loadWeights } from "../lib/ledger.mjs";
import { parseFrontmatter, stripMarkdown } from "../lib/util.mjs";

// The reaction / social-media lane is a SEPARATE automation (owner 2026-07-11): the VIDEO lane
// builds ONLY from genuine NEWS + GOSSIP stories — never a "how fans are reacting online" piece
// (those articles are wall-to-wall fan quotes and read terribly as a reel). Targeted so it drops
// reaction pieces ("Has Fans Celebrating", "Has the Internet Divided", "Fans react…") without
// nuking a real news story that merely mentions a reaction.
const REACTION_TITLE_RE = /\bhas (fans?|viewers?|the internet|audiences?)\b|^\s*(fans?|viewers?|the internet|social ?media)\b|\b(fans?|viewers?|the internet|social ?media|audiences?)\b[^.!?]{0,40}\b(are (reacting|divided|losing it|freaking|obsess\w*|split|melting)|react to|can'?t (stop|get over|even))|\b(reactions? (pour|flood|are pouring|erupt)|go(es|ing)? viral|took to (social|twitter|x|reddit|instagram)|sparked? (a )?(frenzy|backlash|debate|meltdown|wave of (praise|reactions)))\b/i;
const REACTION_TAGS = new Set(["fan reactions", "fan reaction", "social media reactions", "internet reactions", "viral moments", "reactions"]);
export function isReactionArticle(data) {
  if (REACTION_TITLE_RE.test(`${data.title || ""} ${data.dek || data.description || ""}`)) return true;
  const tags = Array.isArray(data.tags) ? data.tags.map((x) => String(x).toLowerCase().trim()) : [];
  return tags.some((x) => REACTION_TAGS.has(x));
}

export function listCandidates({ now = new Date() } = {}) {
  const files = fs.readdirSync(IG.articlesDir).filter((f) => f.endsWith(".md"));
  const cutoff = now.getTime() - IG.freshDays * 864e5;
  const out = [];
  for (const f of files) {
    const slug = f.replace(/\.md$/, "");
    let raw;
    try { raw = fs.readFileSync(path.join(IG.articlesDir, f), "utf8"); } catch { continue; }
    const { data, body } = parseFrontmatter(raw);
    const category = String(data.category || "").toLowerCase();
    if (!IG.categories.includes(category)) continue;
    if (String(data.storyStatus || "").toUpperCase() === "RUMOR") continue;
    if (isReactionArticle(data)) continue; // reaction/social-media lane = separate automation, not video
    const date = new Date(data.date || 0).getTime();
    if (!date || date < cutoff) continue;
    if (isPosted(slug)) continue; // never repost — mine OR the old lane's
    if (isBuilt(slug)) continue; // never rebuild an already-built story (repetition guard)
    if (isHeld(slug)) continue; // held stories don't consume slate slots run after run
    // owner floor: every video is 30-40s of REAL story — thin articles can't carry that
    // without padding, so they never enter the slate (skip up front, zero spend)
    if (stripMarkdown(body).length < 1200) continue;
    out.push({
      slug,
      title: stripMarkdown(data.title || slug),
      dek: stripMarkdown(data.dek || data.description || "").slice(0, 240),
      category,
      date: data.date,
      heroImage: data.heroImage || data.image || null,
      sourceUrls: Array.isArray(data.sourceUrls) ? data.sourceUrls : [],
      body: stripMarkdown(body).slice(0, 1200),
    });
  }
  out.sort((a, b) => new Date(b.date) - new Date(a.date));
  return out;
}

const SYS = `You score Hollywood news stories for ONE goal: which would go MOST VIRAL as an Instagram Reel right now.
Scoring lens (in order): (1) SENDABILITY — would a movie/TV fan DM this to a specific friend? (casting shocks, record numbers, first-looks, "X is back" nostalgia, fandom-identity beats score high); (2) HOOK POTENTIAL — is there one concrete, surprising fact that works as a ≤12-word opening line?; (3) SURPRISE DENSITY — enough strong facts for 20-35 seconds. Generic recaps, process stories ("X discussed Y"), and inside-baseball score low.
Return STRICT JSON: {"scores":[{"slug":string,"score":0-100,"sendability":0-10,"breaking":boolean,"hookIdea":string,"segment":string}]}
segment ∈ ["Box Office in 30","Casting Watch","Trailer Take","Celebrity Wire","TV Signal"]. breaking=true only for a still-developing, hours-old story.`;

export async function scout({ limit = 3, candidates = null } = {}) {
  const pool = candidates ?? listCandidates();
  if (!pool.length) return [];
  const weights = loadWeights();
  const batch = pool.slice(0, 18); // newest 18 — plenty for a daily slate
  const user = JSON.stringify(
    batch.map(({ slug, title, dek, category, date }) => ({ slug, title, dek, category, date })),
  ) + (Object.keys(weights.segments || {}).length
    ? `\n\nLEARNED SEGMENT PERFORMANCE (higher = our audience responds better): ${JSON.stringify(weights.segments)}`
    : "");
  const res = await llm({ role: "classify", system: SYS, user, temp: 0.2, maxTokens: 900, json: true });
  const scores = new Map((res.scores || []).map((s) => [s.slug, s]));
  const scored = batch
    .map((c) => ({ ...c, ...(scores.get(c.slug) || { score: 0, sendability: 0, breaking: false, segment: "Celebrity Wire" }) }))
    .filter((c) => c.score >= 40);
  // movies-first ~80/20: stable-sort movies (and movie-adjacent tv) ahead when scores are close
  scored.sort((a, b) => (b.score + (b.category === "movies" ? 8 : 0)) - (a.score + (a.category === "movies" ? 8 : 0)));
  // category variety: max 2 per category in a slate
  const out = [];
  const perCat = {};
  for (const c of scored) {
    if ((perCat[c.category] || 0) >= 2) continue;
    perCat[c.category] = (perCat[c.category] || 0) + 1;
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
