// ASSEMBLE (inside) — frontmatter per the site contract (category/author/trendScore/signals/
// eventSlug/eventType/outletCount for the homepage engine) + the inside fields the UI renders
// (insideForm/parentEventSlug/reactions/anchorStatement/fanConsensus). gray-matter via
// createRequire (same as news/gossip assemble). NEVER emit an undefined key — gray-matter throws.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CONTENT_DIR, INSIDE_FORMAT_TAG, INSIDE_AUTHOR_SLUG, AI_DISCLOSURE, MONITOR_WINDOW_HOURS, FORMS, routeForStory } from "./config.inside.mjs";
import { norm } from "./reactionFinder.mjs";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

// INLINE EMBEDS (REV 3, owner): the real post renders DIRECTLY BELOW the paragraph that quotes it —
// never pooled at the bottom — so readers scroll through the receipts as they read. Deterministic:
// the harvest's own quote↔tweet pairing decides placement (once per post); Instagram posts (no
// quote pairing) slot after the first paragraph that speaks of Instagram, else right after the
// lede. Markers are their own blocks; ArticleBody renders them as the real embed components.
export function insertInlineEmbeds(body, factBlock, embeds = null) {
  const blocks = (body || "").trim().split(/\n\n+/).filter(Boolean);
  if (!blocks.length) return body || "";
  const tweetPool = [...(factBlock?.reactions || []), ...(factBlock?.aggregateFans || [])].filter((h) => h.tweetId && h.quote);
  const used = new Set();
  const out = [];
  for (const blk of blocks) {
    out.push(blk);
    if (/^#/.test(blk.trim())) continue;
    for (const m of blk.matchAll(/["“]([^"“”\n]{12,400})["”]/g)) {
      const nq = norm(m[1]);
      if (nq.length < 12) continue;
      const hit = tweetPool.find((h) => !used.has(h.tweetId) && (norm(h.quote).includes(nq) || nq.includes(norm(h.quote))));
      if (hit) { used.add(hit.tweetId); out.push(`[embed:tweet:${hit.tweetId}]`); }
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
  return { body: out.join("\n\n"), inlinedTweetIds: used };
}

export function buildInsideMarkdown({ article, trigger, angle, factBlock, image, embeds = null, dateISO }) {
  const route = routeForStory(trigger);
  const slug = slugify(article.title);
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
  const inlined = insertInlineEmbeds((article.body || "").trim(), factBlock, embeds);
  const reactions = (article.reactionsRender || [])
    .filter((r) => r && r.speaker !== undefined && r.quote)
    .map((r) => clean({
      speaker: r.speaker || "A viewer",
      connection: r.connection, platform: r.platform, date: r.date, quote: r.quote,
      tweetId: tweetIdFor(r.quote) ?? (factBlock.tweetIds.includes(r.tweetId) ? r.tweetId : undefined), // cached-only — a dead id renders nothing
    }))
    // A post embedded INLINE is its own display — a duplicate bottom card would repeat it.
    .filter((r) => !r.tweetId || !inlined.inlinedTweetIds.has(r.tweetId));

  const fm = clean({
    title: article.title,
    slug,
    category: route.category,
    subcategory: route.subcategory,
    author: INSIDE_AUTHOR_SLUG,
    date: dateISO,
    dek: article.dek || "",
    metaTitle: article.metaTitle || article.title,
    metaDescription: article.metaDescription || article.dek || "",
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
    tweetIds: (embeds?.tweetIds?.length ? embeds.tweetIds : factBlock.tweetIds.length ? factBlock.tweetIds : undefined),
    instagramUrls: embeds?.instagramUrls?.length ? embeds.instagramUrls : undefined,
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
