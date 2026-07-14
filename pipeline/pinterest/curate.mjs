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
    storyStatus: String(fm.storyStatus || "").toUpperCase(),
    sensitivity: String(fm.sensitivity || "").toLowerCase(),
    body: body.replace(/\s+/g, " ").trim(),
    fm,
  };
}

// candidate slugs, newest first, filtered + category-capped for a day's batch
export function pickCandidates(pinnedSet, limit = 24) {
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
    rows.push({ slug, category: a.category, date: dt, title: a.title });
  }
  return rows.sort((x, y) => y.date - x.date).slice(0, limit);
}
