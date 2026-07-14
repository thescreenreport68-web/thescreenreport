// CURATOR — read our published articles, keep the recent, pin-eligible, not-yet-pinned ones, newest first.
// Both the news lane and the gossip lane write to content/articles/, so this naturally covers both.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { PIN } from "./config.mjs";

// full parsed article for the downstream agents
export function readArticle(slug) {
  const p = path.join(PIN.articlesDir, slug + ".md");
  const { data: fm, content: body } = matter(fs.readFileSync(p, "utf8"));
  return {
    slug,
    title: fm.title || "",
    dek: fm.dek || fm.metaDescription || "",
    category: String(fm.category || "").toLowerCase(),
    image: (String(fm.image || "").match(/https?:\/\/[^\s"'>]+/) || [""])[0],
    imageCredit: fm.imageCredit || "",
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    keyTakeaways: Array.isArray(fm.keyTakeaways) ? fm.keyTakeaways : [],
    whatWeKnow: fm.whatWeKnow || "",
    date: fm.date || fm.publishedAt || "",
    trendScore: typeof fm.trendScore === "number" ? fm.trendScore : null, // the site's importance/trending score
    outletCount: typeof fm.outletCount === "number" ? fm.outletCount : 0,  // corroboration = how big the story is
    eventSlug: fm.eventSlug || "",   // same real-world event → don't pin two of them in one batch
    formatTag: String(fm.formatTag || "news"),
    storyStatus: String(fm.storyStatus || "").toUpperCase(),
    sensitivity: String(fm.sensitivity || "").toLowerCase(),
    body: body.replace(/\s+/g, " ").trim(),
    fm,
  };
}

// candidates ranked by TRENDING (owner rule 2026-07-14: post only the best/trending latest stories, not
// just the newest). Score = the site's trendScore, decayed by age, nudged by corroboration; un-scored
// stories (gossip) fall to `fallbackTrend` so they only fill in when there aren't enough trending ones.
export function pickCandidates(pinnedSet, limit = 30) {
  const now = Date.now();
  const rows = [];
  for (const f of fs.readdirSync(PIN.articlesDir)) {
    if (!f.endsWith(".md")) continue;
    const slug = f.slice(0, -3);
    if (pinnedSet.has(slug)) continue; // strict no-repeat
    let a;
    try { a = readArticle(slug); } catch { continue; }
    if (!PIN.categories.has(a.category)) continue;
    if (a.storyStatus === "RUMOR") continue;      // never pin unverified rumors
    if (!a.image) continue;                        // needs a hero photo to build a card
    const dt = Date.parse(a.date || 0);
    if (!dt || now - dt > PIN.freshDays * 864e5) continue;
    const ageDays = (now - dt) / 864e5;
    const score = (a.trendScore ?? PIN.fallbackTrend) - ageDays * 6 + Math.min(a.outletCount || 0, 6) * 1.5;
    rows.push({ slug, category: a.category, date: dt, title: a.title, trendScore: a.trendScore, eventSlug: a.eventSlug, score });
  }
  return rows.sort((x, y) => y.score - x.score).slice(0, limit); // hottest first
}
