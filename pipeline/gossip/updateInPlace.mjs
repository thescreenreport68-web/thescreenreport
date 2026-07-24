// GOSSIP — ONE STORY = ONE URL (owner directive, 2026-07-20).
//
// A development on a story we ALREADY covered (same people + same storyline, within ~7 days) must
// REFRESH the existing article at its existing URL — not mint a second slug. Two URLs for one story
// splits its link equity, competes with itself in search, and reads to a crawler as thin duplication.
//
// This module owns the in-place merge only. The routing decision lives in gossiprun.mjs.
//
// HARD SAFETY RULES baked in here:
//   • NEVER touch a file this lane did not write (formatTag must be "gossip") — other lanes own theirs.
//   • NEVER change the slug, the original `date`, or the category ⇒ the URL is immutable.
//   • NEVER resurrect a de-indexed page: a parent carrying robots:noindex keeps it.
//   • Outside the window ⇒ return null and let the caller publish normally.
//   • The refreshed body is the writer's NEW piece, which already leads with the new development and
//     recaps the background (writer.mjs follow-up directive) — so the reader gets a current article,
//     not a patchwork.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildGossipMarkdown } from "./assemble.mjs";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, "../../content/articles");

export const UPDATE_WINDOW_DAYS = Number(process.env.GOSSIP_UPDATE_WINDOW_DAYS ?? 7);

/** Read a published article by slug. Returns { fm, content, fp } or null. */
export function readParent(slug, dir = CONTENT_DIR) {
  if (!slug) return null;
  const fp = path.join(dir, `${slug}.md`);
  try {
    const { data, content } = matter(fs.readFileSync(fp, "utf8"));
    return { fm: data || {}, content: String(content || ""), fp };
  } catch { return null; }
}

/** Only this lane's own articles may be rewritten in place. */
export const isOwnArticle = (fm) => String(fm?.formatTag || "") === "gossip";

/** Is the parent still the SAME running story (published within the window)? */
export function withinWindow(fm, now = Date.now(), days = UPDATE_WINDOW_DAYS) {
  const t = Date.parse(fm?.date || fm?.provenance?.publishedAt || "");
  if (!t) return false;
  return now - t <= days * 864e5 && now - t >= 0;
}

// One visible freshness line, REPLACED (never accumulated) on each update.
const UPDATE_LINE = /^_Updated [^\n]*_\n\n?/;
export function stampBody(body, note, nowISO) {
  const clean = String(body || "").replace(UPDATE_LINE, "").trim();
  const day = String(nowISO).slice(0, 10);
  const n = String(note || "").replace(/\s+/g, " ").trim().replace(/[._]+$/, "");
  return n ? `_Updated ${day}: ${n}._\n\n${clean}\n` : `${clean}\n`;
}

// A single URL must not be rewritten every time another outlet covers the same beat — that is churn on
// one page. A genuine development still lands; a flurry within the gap window waits.
export const MIN_UPDATE_GAP_H = Number(process.env.GOSSIP_UPDATE_GAP_H ?? 6);

/**
 * Decide + perform the in-place refresh. Returns a STATUS so the caller never guesses:
 *   { status: "UPDATED", ...writeGossipArticle-shaped, updatedInPlace: true }
 *   { status: "PUBLISH_NEW", reason }  — no usable parent ⇒ mint a new slug as normal
 *   { status: "SKIP", reason }         — same URL was just refreshed ⇒ do nothing (anti-churn)
 */
export function updateArticleInPlace({
  parentSlug, article, frame, provenance, route, topic, bundle = null, dateISO,
  newFact = "", dir = CONTENT_DIR, dryRun = false, now = Date.now(),
}) {
  const parent = readParent(parentSlug, dir);
  if (!parent) return { status: "PUBLISH_NEW", reason: "parent article not found" };
  if (!isOwnArticle(parent.fm)) return { status: "PUBLISH_NEW", reason: "parent belongs to another lane" };
  if (!withinWindow(parent.fm, now)) return { status: "PUBLISH_NEW", reason: `parent older than ${UPDATE_WINDOW_DAYS}d — genuinely new coverage` };
  const lastTouch = Date.parse(parent.fm.dateModified || parent.fm.updated || parent.fm.date || "") || 0;
  if (lastTouch && now - lastTouch < MIN_UPDATE_GAP_H * 3600e3) {
    return { status: "SKIP", reason: `same URL refreshed ${Math.round((now - lastTouch) / 36e5)}h ago (< ${MIN_UPDATE_GAP_H}h) — not churning it` };
  }

  // Build the new article through the NORMAL path so every guard + the SEO auditor still run.
  const built = buildGossipMarkdown({ article, frame, provenance, route, topic, dateISO, bundle });
  const fresh = built.frontmatter || {};

  const fm = {
    ...fresh,
    // ---- IMMUTABLE: the URL identity of the story ----
    slug: parent.fm.slug || parentSlug,
    date: parent.fm.date,                                // original publish date stays
    category: parent.fm.category || fresh.category,
    subcategory: parent.fm.subcategory || fresh.subcategory,
    author: parent.fm.author || fresh.author,
    // ---- freshness signals the site actually reads (lib/articles.ts: updated ?? dateModified) ----
    dateModified: dateISO,
    updated: dateISO,
    updatedCount: (Number(parent.fm.updatedCount) || 0) + 1,
    // ---- carry-overs that must not regress ----
    ...(parent.fm.robots ? { robots: parent.fm.robots } : {}),          // keep a de-indexed page de-indexed
    ...(parent.fm.correction ? { correction: parent.fm.correction } : {}),
    image: fresh.image || parent.fm.image,
    imageAlt: fresh.image ? fresh.imageAlt : parent.fm.imageAlt,
    imageCredit: fresh.image ? fresh.imageCredit : parent.fm.imageCredit,
    imageWidth: fresh.image ? fresh.imageWidth : parent.fm.imageWidth,
    imageHeight: fresh.image ? fresh.imageHeight : parent.fm.imageHeight,
    tags: [...new Set([...(parent.fm.tags || []), ...(fresh.tags || [])])].slice(0, 8),
  };

  const bodyOut = stampBody(built.md.replace(/^---[\s\S]*?\n---\n/, ""), newFact, dateISO);
  const md = matter.stringify(bodyOut, fm);
  const fp = parent.fp;
  if (!dryRun) fs.writeFileSync(fp, md);
  return { status: "UPDATED", slug: fm.slug, path: fp, frontmatter: fm, md, written: !dryRun, seoIssues: built.seoIssues || [], updatedInPlace: true };
}
