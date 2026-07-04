// ASSEMBLE (inside) — frontmatter per the site contract (category/author/trendScore/signals/
// eventSlug/eventType/outletCount for the homepage engine) + the inside fields the UI renders
// (insideForm/parentEventSlug/reactions/anchorStatement/fanConsensus). gray-matter via
// createRequire (same as news/gossip assemble). NEVER emit an undefined key — gray-matter throws.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CONTENT_DIR, INSIDE_FORMAT_TAG, INSIDE_AUTHOR_SLUG, AI_DISCLOSURE, MONITOR_WINDOW_HOURS, FORMS, routeForStory } from "./config.inside.mjs";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

export function buildInsideMarkdown({ article, trigger, angle, factBlock, image, dateISO }) {
  const route = routeForStory(trigger);
  const slug = slugify(article.title);
  // Sibling inside-articles must not collapse into each other (or the parent) in the homepage's
  // eventSlug dedup — each gets a derived, unique eventSlug; parentEventSlug carries the cluster.
  const eventSlug = `${trigger.parentEventSlug || slugify(trigger.primaryEntity)}--in-${angle.form}`;
  const flagship = !!FORMS[angle.form]?.flagship;

  const reactions = (article.reactionsRender || [])
    .filter((r) => r && r.speaker !== undefined && r.quote)
    .map((r) => clean({
      speaker: r.speaker || "A viewer",
      connection: r.connection, platform: r.platform, date: r.date, quote: r.quote,
      tweetId: factBlock.tweetIds.includes(r.tweetId) ? r.tweetId : undefined, // cached-only — a dead id renders nothing
    }));

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
    tweetIds: factBlock.tweetIds.length ? factBlock.tweetIds : undefined,
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

  const md = matter.stringify("\n" + (article.body || "").trim() + "\n", fm);
  return { slug, frontmatter: fm, md };
}

export function writeInsideArticle({ article, trigger, angle, factBlock, image, dateISO, dir = CONTENT_DIR, dryRun = false }) {
  const out = buildInsideMarkdown({ article, trigger, angle, factBlock, image, dateISO });
  if (!dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, out.slug + ".md"), out.md);
  }
  return { ...out, path: path.join(dir, out.slug + ".md"), written: !dryRun };
}
