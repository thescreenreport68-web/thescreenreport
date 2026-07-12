// ASSEMBLE (inside) — frontmatter per the site contract (category/author/trendScore/signals/
// eventSlug/eventType/outletCount for the homepage engine) + the inside fields the UI renders
// (insideForm/parentEventSlug/reactions/anchorStatement/fanConsensus). gray-matter via
// createRequire (same as news/gossip assemble). NEVER emit an undefined key — gray-matter throws.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CONTENT_DIR, INSIDE_FORMAT_TAG, INSIDE_AUTHOR_SLUG, AI_DISCLOSURE, MONITOR_WINDOW_HOURS, FORMS, MAX_EMBEDS, NO_EMBEDS, routeForStory } from "./config.inside.mjs";
import { norm } from "./reactionFinder.mjs";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");

// Slug capped at a WORD boundary — "…the-memes-ar" class artifacts read broken in the URL bar.
const slugify = (s) => {
  const full = (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (full.length <= 80) return full;
  const cut = full.slice(0, 80);
  return cut.includes("-") ? cut.replace(/-[^-]*$/, "") : cut;
};

// SEO FINISHER (owner: AVERAGE seo, mechanically guaranteed, METADATA ONLY — never a word of the
// prose is touched and never a keyword injected). Trims at word boundaries so nothing reads cut.
const trimAtWord = (str, max) => {
  const t = (str || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const atSpace = cut.lastIndexOf(" ");
  return (atSpace > max * 0.6 ? cut.slice(0, atSpace) : cut.slice(0, max)).replace(/[\s,;:—–-]+$/, "");
};
export const seoFinish = ({ metaTitle, metaDescription }) => ({
  metaTitle: trimAtWord(metaTitle, 60),
  metaDescription: trimAtWord(metaDescription, 155),
});

// Headline hygiene (owner audit: a title trailed off "…and the Tributes Are a Masterclass in"). Drop a
// dangling em-dash tail, and if it still runs long, cut at the last sentence/clause boundary — never
// leave the headline ending on a preposition/connector.
const DANGLING_TAIL = /\s+(in|on|of|to|for|with|and|but|as|the|a|an|that|which|from|about|—and|- and)\s*$/i;
export function cleanTitle(title) {
  let t = (title || "").trim();
  if (t.length > 92) {
    const dash = t.search(/\s[—–-]\s?(and|but|as)\b/i);
    if (dash > 30) t = t.slice(0, dash).trim();          // drop a run-on "— and …" clause
  }
  if (t.length > 100) {
    const cut = t.slice(0, 100);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(", "), cut.lastIndexOf(" — "));
    t = (stop > 40 ? cut.slice(0, stop) : cut.replace(/\s+\S*$/, "")).trim();
  }
  while (DANGLING_TAIL.test(t)) t = t.replace(DANGLING_TAIL, "").trim();
  return t.replace(/[\s,;:—–-]+$/, "").trim();
}
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

// INLINE EMBEDS (REV 3, owner): the real post renders DIRECTLY BELOW the paragraph that quotes it —
// never pooled at the bottom — so readers scroll through the receipts as they read. Deterministic:
// the harvest's own quote↔tweet pairing decides placement (once per post); Instagram posts (no
// quote pairing) slot after the first paragraph that speaks of Instagram, else right after the
// lede. Markers are their own blocks; ArticleBody renders them as the real embed components.
export function insertInlineEmbeds(body, factBlock, embeds = null) {
  const blocks = (body || "").trim().split(/\n\n+/).filter(Boolean);
  if (!blocks.length) return body || "";
  const anchorPool = [...(factBlock?.reactions || []), ...(factBlock?.aggregateFans || [])];
  const tweetPool = anchorPool.filter((h) => h.tweetId && h.quote);
  const used = new Set();
  const out = [];
  // Cap the inline embeds per article — the X-search pool can be large, but a wall of live iframes
  // hurts load + reads as spam. MAX_EMBEDS keeps it to a handful of the best-placed receipts.
  for (const blk of blocks) {
    out.push(blk);
    if (/^#/.test(blk.trim())) continue;
    if (used.size >= MAX_EMBEDS) continue;
    for (const m of blk.matchAll(/["“]([^"“”\n]{12,400})["”]/g)) {
      if (used.size >= MAX_EMBEDS) break;
      const nq = norm(m[1]);
      if (nq.length < 12) continue;
      const t = tweetPool.find((h) => !used.has(h.tweetId) && (norm(h.quote).includes(nq) || nq.includes(norm(h.quote))));
      if (t) { used.add(t.tweetId); out.push(`[embed:tweet:${t.tweetId}]`); }
    }
  }
  const igUrls = (embeds?.instagramUrls || []).slice(0, 2);
  if (igUrls.length) {
    let idx = out.findIndex((b) => /instagram/i.test(b) && !b.startsWith("[embed:"));
    if (idx === -1) idx = Math.min(1, out.length - 1);
    out.splice(idx + 1, 0, `[embed:instagram:${igUrls[0]}]`);
    if (igUrls[1]) {
      const mid = Math.min(out.length - 1, Math.max(idx + 3, Math.floor(out.length * 0.66)));
      out.splice(mid + 1, 0, `[embed:instagram:${igUrls[1]}]`);
    }
  }
  return { body: out.join("\n\n"), inlined: used };
}

export function buildInsideMarkdown({ article, trigger, angle, factBlock, image, embeds = null, dateISO }) {
  const route = routeForStory(trigger);
  const title = cleanTitle(article.title);
  const slug = slugify(title);
  // Sibling inside-articles must not collapse into each other (or the parent) in the homepage's
  // eventSlug dedup — each gets a derived, unique eventSlug; parentEventSlug carries the cluster.
  const eventSlug = `${trigger.parentEventSlug || slugify(trigger.primaryEntity)}--in-${angle.form}`;
  const flagship = !!FORMS[angle.form]?.flagship;

  // Tweet↔quote pairing is DETERMINISTIC from the harvest's own knowledge (which anchor came from
  // which post) — never trust the writer's id pairing. Fall back to the writer's id only when it's
  // cached AND the harvest has no opinion.
  const tweetPool = [...(factBlock.reactions || []), ...(factBlock.aggregateFans || [])].filter((h) => h.tweetId && h.quote);
  const tweetIdFor = (q) => {
    const nq = norm(q);
    if (nq.length < 8) return undefined;
    return tweetPool.find((h) => norm(h.quote).includes(nq) || nq.includes(norm(h.quote)))?.tweetId;
  };
  const allAnchors = [...(factBlock.reactions || []), ...(factBlock.aggregateFans || [])];
  const anchorFor = (q) => {
    const nq = norm(q || "");
    if (nq.length < 8) return undefined;
    return allAnchors.find((h) => h.quote && (norm(h.quote).includes(nq) || nq.includes(norm(h.quote))));
  };
  // FREE MODE (NO_EMBEDS): zero iframe embeds — the body stays as-is (no [embed:] markers), and the
  // reaction display cards carry ONLY the quote text (no tweetId, so nothing renders an embed).
  const inlined = NO_EMBEDS ? { body: (article.body || "").trim(), inlined: new Set() }
    : insertInlineEmbeds((article.body || "").trim(), factBlock, embeds);
  // FREE MODE: reaction cards for ordinary people carry ONLY "A viewer" + the quote — no platform
  // name (owner: generic attribution) and no raw relative date ("6h"). Named voices keep attribution.
  const isNamed = (r) => r.speaker && r.speaker !== "A viewer";
  const okDate = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d : undefined);
  const reactions = (article.reactionsRender || [])
    .filter((r) => r && r.speaker !== undefined && r.quote)
    .map((r) => clean({
      speaker: r.speaker || "A viewer",
      connection: r.connection,
      platform: NO_EMBEDS && !isNamed(r) ? undefined : r.platform,
      date: NO_EMBEDS ? okDate(r.date) : r.date,
      quote: r.quote,
      ...(NO_EMBEDS ? {} : { tweetId: tweetIdFor(r.quote) ?? (factBlock.tweetIds.includes(r.tweetId) ? r.tweetId : undefined) }),
    }))
    // A post embedded INLINE is its own display — a duplicate bottom card would repeat it.
    .filter((r) => !(r.tweetId && inlined.inlined.has(r.tweetId)));

  const fm = clean({
    title,
    slug,
    category: route.category,
    subcategory: route.subcategory,
    author: INSIDE_AUTHOR_SLUG,
    date: dateISO,
    dek: article.dek || "",
    ...seoFinish({
      metaTitle: article.metaTitle || article.title,
      metaDescription: article.metaDescription || article.dek || "",
    }),
    tags: article.tags || [],
    keyTakeaways: article.keyTakeaways || [],
    faq: (article.faq || []).filter((f) => f?.q && f?.a),
    about: Array.isArray(article.about) ? article.about.filter((e) => e && e.name && e.type) : [],
    formatTag: INSIDE_FORMAT_TAG,
    insideForm: angle.form,
    parentEventSlug: trigger.parentEventSlug || undefined,
    parentSlug: trigger.parentSlug || undefined,
    parentTitle: trigger.parentTitle || undefined,
    reactions,
    anchorStatement: article.anchorStatement?.speaker && article.anchorStatement?.quote
      ? clean(article.anchorStatement) : undefined,
    fanConsensus: article.fanConsensus || undefined, // the honest sentiment read, all forms
    tweetIds: NO_EMBEDS ? undefined : (embeds?.tweetIds?.length ? embeds.tweetIds : factBlock.tweetIds.length ? factBlock.tweetIds : undefined),
    instagramUrls: NO_EMBEDS ? undefined : (embeds?.instagramUrls?.length ? embeds.instagramUrls : undefined),
    updatedCount: 0,
    // Homepage placement contract. Non-flagship siblings run 5 under the parent's heat so one
    // story's angle set never monopolizes the fold.
    trendScore: Number.isFinite(trigger.priority) ? (flagship ? trigger.priority : Math.max(0, trigger.priority - 5)) : undefined,
    signals: trigger.signals && Object.keys(trigger.signals).length ? trigger.signals : undefined,
    eventSlug,
    eventType: trigger.eventType, // "discourse"
    outletCount: factBlock.sources.filter((s) => s.url).length || undefined,
    developing: true, // discourse builds — the monitor tops this article up
    aiDisclosure: AI_DISCLOSURE,
    dateModified: dateISO,
    provenance: clean({
      parentEventSlug: trigger.parentEventSlug || "",
      primaryEntity: trigger.primaryEntity || "",
      eventType: trigger.eventType || "discourse",
      monitor: true,
      monitorWindowH: MONITOR_WINDOW_HOURS,
      anchors: (factBlock.stats.namedVoices || 0) + (factBlock.stats.fanPosts || 0),
      publishedAt: dateISO,
    }),
    ...(image ? {
      image: image.image,
      imageAlt: article.imageQuery || `${trigger.primaryEntity}`,
      imageCredit: image.credit || "Photo via source",
      imageWidth: image.imageWidth,
      imageHeight: image.imageHeight,
    } : {}),
  });

  const md = matter.stringify("\n" + inlined.body + "\n", fm);
  return { slug, frontmatter: fm, md };
}

export function writeInsideArticle({ article, trigger, angle, factBlock, image, embeds = null, dateISO, dir = CONTENT_DIR, dryRun = false }) {
  const out = buildInsideMarkdown({ article, trigger, angle, factBlock, image, embeds, dateISO });
  if (!dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, out.slug + ".md"), out.md);
  }
  return { ...out, path: path.join(dir, out.slug + ".md"), written: !dryRun };
}
