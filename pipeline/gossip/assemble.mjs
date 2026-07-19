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
import { buildMetaTitle, buildMetaDescription, targetKeywordFor } from "./seo.mjs";
import { auditArticleSeo } from "./seoAudit.mjs";

// Sources-link anchor text. Outlet names are BANNED as anchors (news-lane factGuards rule) and a generic
// "Report" is useless for readers and search alike — 18/18 links shipped as "Report" on 2026-07-18 because
// the bundle never carried the extracted headline. Order: the source's real headline → the headline its own
// URL slug encodes (humanized) → a descriptive last resort.
const TITLE_CASE_SKIP = new Set(["a","an","the","and","or","but","of","in","on","at","to","for","with","from","by","as","is","are","was","were"]);
export function sourceAnchor(src = {}) {
  const clean = (t) => String(t || "").replace(/[\[\]]/g, "").replace(/\s*[|–—-]\s*[A-Z][A-Za-z! .]{2,20}$/, "").trim();
  const real = clean(src.title);
  if (real.length >= 12) return real.slice(0, 90);
  try {
    const seg = decodeURIComponent(new URL(src.url).pathname).split("/").filter(Boolean).pop() || "";
    const words = seg.replace(/\.\w+$/, "").split(/[-_]+/).filter((w) => w && !/^\d+$/.test(w));
    if (words.length >= 3) {
      return words.map((w, i) => (i && TITLE_CASE_SKIP.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ").slice(0, 90);
    }
  } catch { /* unparseable URL */ }
  return "Full report";
}

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // …/pipeline/gossip
const CONTENT_DIR = path.resolve(__dirname, "../../content/articles");

import { slugify } from "./normalize.mjs";

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

export function buildGossipMarkdown({ article, frame, provenance, route, topic, dateISO, bundle = null }) {
  // The URL slug derives from OUR headline (original phrasing), never the discovery title — the
  // discovery title IS the source outlet's headline, and shipping it as our slug is SERP
  // cannibalization against the outlet that broke the story (2026-07-18 audit fix F).
  const slug = slugify(article.title) || topic.slug || slugify(topic.title);
  const gossipType = detectGossipType(topic);
  const badge = badgeFor(frame);
  const tags = deriveTags(topic, article, route.category, gossipType);
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
    // SEO (readers see the full `title` above unchanged): the WRITER's name-first 45–55 metaTitle +
    // 140–160 metaDescription when they're clean, else a deterministic clean fallback (never a dangler).
    metaTitle: buildMetaTitle({ writerMetaTitle: article.metaTitle, title: article.title, primaryEntity: topic.primaryEntity, tags, coSubjects: topic.coSubjects || [] }),
    metaDescription: buildMetaDescription({ writerMetaDesc: article.metaDescription, dek: article.dek, keyTakeaways: article.keyTakeaways, whatWeKnow: article.whatWeKnow }),
    targetKeyword: targetKeywordFor({ primaryEntity: topic.primaryEntity, tags }),
    formatTag: "gossip",
    gossipType,
    // Phase 1 — homepage heat-contract analogs (site/lib/homepage.ts heat-ranks on these; additive fields).
    // trendScore is CONSERVATIVE: mapped from the ranker score and capped at 70 so gossip never hijacks the
    // hero from a real news heat story (homepage BASE_SCORE prior for unscored articles is 30).
    ...(topic._score != null ? { trendScore: Math.min(70, Math.round(25 + topic._score / 2)) } : {}),
    eventSlug: topic.id || slug,
    eventType: gossipType,
    outletCount: provenance.corroborationCount ?? null,
    // lib/articles.ts declares signals as an OBJECT OF NUMBERS, and lib/homepage.ts reads
    // s.breakout / s.corroboration / s.type to compute supply-side TRENDING velocity. This lane emitted
    // an ARRAY OF STRINGS, so every numeric read returned undefined and gossip articles scored ZERO
    // velocity — they could never earn a TRENDING badge before analytics data existed. Values stay
    // CONSERVATIVE (same spirit as the trendScore cap): gossip must not hijack the news slots.
    signals: {
      recency: 1,
      corroboration: Math.min(4, Number(provenance.corroborationCount) || 0),
      status: frame.tier === "CONFIRMED" || frame.tier === "OFFICIAL_RECORD" ? 2 : frame.tier === "REPORTED_BY_MAJOR" ? 1 : 0,
      type: topic.viaTrending ? 1 : 0,
      pop: topic.engagement != null ? Math.min(4, Math.round(Math.log10(1 + Number(topic.engagement)))) : 0,
      breakout: topic.heat != null ? Math.min(3, Math.max(0, Math.round(Number(topic.heat) - 1))) : 0,
    },
    // human-readable trace kept for audits; never consumed by the renderer
    signalNotes: [
      ...(topic.engagement != null ? [`social:${topic.engagement}`] : []),
      ...(topic.heat != null ? [`heat:${topic.heat}x`] : []),
      ...(provenance.corroborationCount ? [`outlets:${provenance.corroborationCount}`] : []),
      ...(topic.viaTrending ? ["via:trending-search"] : []),
    ],
    tags,
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
  // 2026-07-18 audit fix E — SOURCES BLOCK: every article cites and LINKS its sources (the audit found
  // 9/9 live articles had zero outbound links). Anchor text = the source article's headline, never the
  // bare outlet name (the news lane's factGuards rule); outlet named as plain text after the link.
  let bodyOut = (article.body || "").trim();
  if (!/^##\s+Sources\b/m.test(bodyOut)) {
    const seen = new Set();
    const srcLinks = (bundle?.sources || [])
      .filter((x) => x && /^https?:\/\//.test(x.url || "") && !/\/\/(?:www\.)?(?:x\.com|twitter\.com|bsky\.app|t\.co)\//.test(x.url) && !/news\.google\.com\/rss\//.test(x.url))
      .filter((x) => { const k = String(x.url).replace(/[?#].*$/, ""); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 4)
      .map((x) => `- [${sourceAnchor(x)}](${x.url})${x.outlet ? ` — ${x.outlet}` : ""}`);
    if (srcLinks.length) bodyOut += `\n\n## Sources\n\n${srcLinks.join("\n")}`;
  }
  article = { ...article, body: bodyOut };

  // Phase 3 — SEO AUDITOR (deterministic walls + safe repairs + cross-surface grounding) over the FINAL fm.
  const audit = auditArticleSeo({ fm, body: article.body || "", topic, bundle });
  const md = matter.stringify("\n" + (article.body || "").trim() + "\n", audit.fm);
  return { slug, frontmatter: audit.fm, md, seoIssues: audit.issues };
}

export function writeGossipArticle({ article, frame, provenance, route, topic, dateISO, bundle = null, dir = CONTENT_DIR, dryRun = false }) {
  const { slug, md, frontmatter, seoIssues } = buildGossipMarkdown({ article, frame, provenance, route, topic, dateISO, bundle });
  // COLLISION GUARD (2026-07-19): writeFileSync clobbers silently, and the UPDATE follow-up path
  // deliberately skips the dedup guard that would otherwise catch a repeat — so a follow-up whose slug
  // matched its parent overwrote the very article it links to. Never overwrite a DIFFERENT article.
  let slugOut = slug;
  if (!dryRun) {
    try {
      for (let n = 2; fs.existsSync(path.join(dir, slugOut + ".md")) && n < 12; n++) slugOut = `${slug}-${n}`;
    } catch { /* fs probe failed — fall through to the plain write */ }
  }
  const fp = path.join(dir, slugOut + ".md");
  if (!dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, md);
  }
  return { slug: slugOut, path: fp, frontmatter, md, written: !dryRun, seoIssues };
}
