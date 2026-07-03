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
import { deriveTags } from "./polish.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // …/pipeline/gossip
const CONTENT_DIR = path.resolve(__dirname, "../../content/articles");

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 75);

// Map the gossip confidence tier → the site's existing reader-facing storyStatus badge vocabulary so we reuse
// the on-page badge UI (CONFIRMED / DEVELOPING / RUMOR).
const STATUS_BADGE = {
  CONFIRMED: "CONFIRMED", OFFICIAL_RECORD: "CONFIRMED", REPORTED_BY_MAJOR: "DEVELOPING",
  SINGLE_SOURCE_RUMOR: "RUMOR", SOCIAL_SPECULATION: "RUMOR", DENIED: "RUMOR",
};

// The reader-facing badge (owner hard rule): only a story whose central fact is confirmed AND that isn't still
// unfolding may show "CONFIRMED". A DEVELOPING/monitored story (a confirmed court FILING but with unconfirmed
// source claims + an evolving situation) is downgraded to DEVELOPING — we never over-state confidence.
function badgeFor(frame) {
  const base = STATUS_BADGE[frame.tier] || "RUMOR";
  return base === "CONFIRMED" && frame.monitor ? "DEVELOPING" : base;
}

export function buildGossipMarkdown({ article, frame, provenance, route, topic, dateISO }) {
  const slug = topic.slug || slugify(article.title);
  const gossipType = detectGossipType(topic);
  const badge = badgeFor(frame);
  const fm = {
    title: article.title,
    slug,
    category: route.category,
    // Cross-list into a second category (one canonical URL). The editorial gate sets this by STORY (a musician's
    // personal-life story is category=celebrity + secondary=music). Fallback: a music/awards story is also celebrity.
    ...((route.secondaryCategory && route.secondaryCategory !== route.category)
      ? { secondaryCategory: route.secondaryCategory }
      : ((route.category === "music" || route.category === "awards") ? { secondaryCategory: "celebrity" } : {})),
    subcategory: route.subcategory,
    author: GOSSIP_AUTHOR_SLUG,
    date: dateISO,
    dek: article.dek || "",
    metaTitle: article.title,
    metaDescription: article.dek || "",
    formatTag: "gossip",
    gossipType,
    tags: deriveTags(topic, article, route.category, gossipType),
    keyTakeaways: article.keyTakeaways || [],
    faq: (article.faq || []).filter((f) => f && f.q && f.a).map((f) => ({ q: f.q, a: f.a })),
    // ── rumor-UI fields (rendered by the gossip modules) ──
    rumorStatus: frame.uiLabel,
    gossipPull: article.pullQuote || article.gossipPull || null,
    storyStatus: badge,
    // ── HERO (Step 6): a powerful, story-specific, LEGAL lead image (TMDB official still / YouTube thumb) flows
    // through the site's existing image/imageAlt/imageCredit convention (header + OG card auto-render it). The
    // originating post (YouTube/X/Bluesky) rides along as `heroEmbed` — the receipt the gossip is about.
    ...(article.hero?.kind === "image" ? {
      image: article.hero.src,
      imageAlt: article.hero.alt || article.title,
      imageCredit: article.hero.credit || "The Screen Report",
      imageCaption: article.hero.caption || "",
      imageOrientation: article.hero.orientation || "landscape", // drives the render crop (portrait → don't cut the head)
      // omit width/height entirely when absent — a literal `undefined` makes gray-matter throw a YAMLException
      // that would abort the whole run loop.
      ...(article.hero.width ? { imageWidth: article.hero.width } : {}),
      ...(article.hero.height ? { imageHeight: article.hero.height } : {}),
    } : {}),
    heroEmbed: article.hero?.embed
      ? { platform: article.hero.embed.platform, sourceUrl: article.hero.embed.sourceUrl, embedUrl: article.hero.embed.embedUrl || null, handle: article.hero.embed.handle || null, tweetId: article.hero.embed.tweetId || null, rkey: article.hero.embed.rkey || null, shortcode: article.hero.embed.shortcode || null }
      : null,
    // Step 7 — internal links to REAL related published articles (shared-entity + contradiction-firewalled).
    relatedLinks: (article.relatedLinks || []).filter((l) => l && l.slug && l.url).map((l) => ({ slug: l.slug, title: l.title, url: l.url })),
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
      status: badge,
      attribution: provenance.attribution,
      outlets: (provenance.sources || []).map((s) => s.outlet),
      corroborationCount: provenance.corroborationCount ?? null,
      verifyDegraded: !!provenance.verifyDegraded,
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
