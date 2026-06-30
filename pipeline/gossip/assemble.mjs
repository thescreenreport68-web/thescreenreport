// GOSSIP — ASSEMBLE & PUBLISH (Stage 7). Builds the article markdown (frontmatter + body) and writes it to the
// content dir. The frontmatter carries: the rumor-UI fields (rumorStatus / whatWeKnow / whatWeDont / denial /
// developing / aiDisclosure), the Alicia byline, and the PROVENANCE the monitor needs to recheck/retract later.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");
import { GOSSIP_AUTHOR_SLUG, AI_DISCLOSURE } from "./config.gossip.mjs";
import { detectGossipType } from "./writer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // …/pipeline/gossip
const CONTENT_DIR = path.resolve(__dirname, "../../content/articles");

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 75);

// Map the gossip confidence tier → the site's existing reader-facing storyStatus badge vocabulary so we reuse
// the on-page badge UI (CONFIRMED / DEVELOPING / RUMOR).
const STATUS_BADGE = {
  CONFIRMED: "CONFIRMED", OFFICIAL_RECORD: "CONFIRMED", REPORTED_BY_MAJOR: "DEVELOPING",
  SINGLE_SOURCE_RUMOR: "RUMOR", SOCIAL_SPECULATION: "RUMOR", DENIED: "RUMOR",
};

export function buildGossipMarkdown({ article, frame, provenance, route, topic, dateISO }) {
  const slug = topic.slug || slugify(article.title);
  const fm = {
    title: article.title,
    slug,
    category: route.category,
    subcategory: route.subcategory,
    author: GOSSIP_AUTHOR_SLUG,
    date: dateISO,
    dek: article.dek || "",
    metaTitle: article.title,
    metaDescription: article.dek || "",
    formatTag: "gossip",
    gossipType: detectGossipType(topic),
    keyTakeaways: article.keyTakeaways || [],
    faq: (article.faq || []).filter((f) => f && f.q && f.a).map((f) => ({ q: f.q, a: f.a })),
    // ── rumor-UI fields (rendered by the gossip modules) ──
    rumorStatus: frame.uiLabel,
    gossipPull: article.pullQuote || article.gossipPull || null,
    storyStatus: STATUS_BADGE[frame.tier] || "RUMOR",
    // ── HERO (Step 6): a powerful, story-specific, LEGAL lead image (TMDB official still / YouTube thumb) flows
    // through the site's existing image/imageAlt/imageCredit convention (header + OG card auto-render it). The
    // originating post (YouTube/X/Bluesky) rides along as `heroEmbed` — the receipt the gossip is about.
    ...(article.hero?.kind === "image" ? {
      image: article.hero.src,
      imageAlt: article.hero.alt || article.title,
      imageCredit: article.hero.credit || "The Screen Report",
      imageCaption: article.hero.caption || "",
      imageWidth: article.hero.width || undefined,
      imageHeight: article.hero.height || undefined,
    } : {}),
    heroEmbed: article.hero?.embed
      ? { platform: article.hero.embed.platform, sourceUrl: article.hero.embed.sourceUrl, embedUrl: article.hero.embed.embedUrl || null, handle: article.hero.embed.handle || null, tweetId: article.hero.embed.tweetId || null, rkey: article.hero.embed.rkey || null }
      : null,
    whatWeKnow: article.whatWeKnow || [],
    whatWeDont: article.whatWeDont || [],
    denial: article.denial || null,
    developing: !!frame.monitor,
    aiDisclosure: AI_DISCLOSURE,
    sensitivity: provenance.sensitivity,
    dateModified: dateISO,
    // ── provenance the monitor reads to recheck/retract ──
    provenance: {
      primaryEntity: topic.primaryEntity || "",
      claim: topic.claim || "",
      tier: frame.tier,
      severity: frame.severity,
      sensitivity: provenance.sensitivity,
      monitor: provenance.monitor,
      status: STATUS_BADGE[frame.tier] || "RUMOR",
      attribution: provenance.attribution,
      outlets: (provenance.sources || []).map((s) => s.outlet),
      publishedAt: dateISO,
    },
  };
  const md = matter.stringify("\n" + (article.body || "").trim() + "\n", fm);
  return { slug, frontmatter: fm, md };
}

export function writeGossipArticle({ article, frame, provenance, route, topic, dateISO, dir = CONTENT_DIR, dryRun = false }) {
  const { slug, md, frontmatter } = buildGossipMarkdown({ article, frame, provenance, route, topic, dateISO });
  const fp = path.join(dir, slug + ".md");
  if (!dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, md);
  }
  return { slug, path: fp, frontmatter, md, written: !dryRun };
}
