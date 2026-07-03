import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");
import { TAXONOMY, AUTHOR_SLUG } from "../config.mjs";
import { addInternalLinks, isRemovedForm } from "../lib/internalLinks.mjs";

const ART = "/Users/sivajithcu/Movie News site/site/content/articles";

// Meta-refusal / prompt-leak phrases a reader (or the FAQ JSON-LD) must never see — assemble-level
// insurance behind the gate's PROMPT_LEAK hard-block.
const FAQ_LEAK = /\b(not (?:detailed|specified|mentioned|provided|stated|available|listed|included) in the (?:provided |reference |given |available )?(?:facts|information|sources|text|article|context|material)|the (?:provided |reference |given )?(?:facts|information|sources) (?:do(?:es)?n'?t|do not|does not)|based on the provided (?:facts|information)|as an ai|the reference facts)\b/i;

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 75);

// Set of every internal path that actually exists, for link validation.
function validPaths() {
  const set = new Set(["/", "/news/"]);
  for (const [c, subs] of Object.entries(TAXONOMY)) {
    set.add(`/${c}/`);
    for (const s of subs) set.add(`/${c}/${s}/`);
  }
  for (const f of fs.readdirSync(ART).filter((x) => x.endsWith(".md"))) {
    const d = matter(fs.readFileSync(path.join(ART, f), "utf8")).data;
    if (isRemovedForm(d)) continue; // news-only: a link to a legacy ranking/review page is invalid → gets stripped
    set.add(`/${d.category}/${d.slug || f.replace(/\.md$/, "")}/`);
  }
  return set;
}

export function assemble({ article, classification, image, topic, dateISO }) {
  const valid = validPaths();
  // Keep internal links that resolve to a real page; otherwise drop the link, keep the text. A BARE
  // homepage link ("[x](/)") is low-value filler the owner banned — drop it (keep the text) too.
  const fixLinks = (s) =>
    typeof s === "string"
      ? s.replace(/\[([^\]]+)\]\((\/[^)]*)\)/g, (m, txt, href) => {
          const norm = href.endsWith("/") ? href : href + "/";
          if (norm === "/") return txt; // bare homepage link → strip, keep text
          return valid.has(norm) ? `[${txt}](${norm})` : txt;
        })
      : s;
  // FIX-3: never publish a link to a COMPETITOR outlet (THR/Variety/Deadline/etc.) — strip it, keep the
  // text. Attribution stays as a plain name ("according to Variety"), never a hyperlink (owner decision).
  // Editorial RIVALS only — NOT data sources like Rotten Tomatoes / Metacritic / Box Office Mojo /
  // Wikipedia / Oscars.org, which the writer is allowed to cite (homepage) for credibility.
  const COMPETITOR = /(?:hollywoodreporter|variety|deadline|screenrant|collider|indiewire|slashfilm|ign|thewrap|empireonline|gamespot|cbr)\.[a-z.]+/i;
  const stripCompetitorLinks = (s) =>
    typeof s === "string"
      ? s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, (m, txt, href) => (COMPETITOR.test(href) ? txt : m))
      : s;
  const clean = (s) => stripCompetitorLinks(fixLinks(s));
  // FAQ answers render as PLAIN TEXT in the app — strip ALL markdown (links → their text, emphasis markers)
  // so nothing renders as a literal "[x](/y)" or "**bold**".
  const faqPlain = (s) =>
    typeof s === "string"
      ? s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s{2,}/g, " ").trim()
      : s;
  let body = clean(article.body || "");

  const slug = topic.slug || slugify(article.title);
  // Support-system #1: insert 2-3 REAL, tone-safe internal links to related published articles +
  // strip any dangling "see our feature" phantom phrases. Runs AFTER fixLinks (these links are valid).
  const tagsForLinks = classification.tags?.length ? classification.tags : article.tags || [];
  const linkResult = addInternalLinks({ body, title: article.title, tags: tagsForLinks, category: classification.category, slug }, { max: 3 });
  body = linkResult.body;
  const imageAlt = (
    (article.imageQuery ? article.imageQuery + " — " : "") + (article.title || "")
  ).slice(0, 125);

  const fm = {
    title: article.title,
    slug,
    category: classification.category,
    subcategory: classification.subcategory,
    author: AUTHOR_SLUG,
    date: dateISO,
    dek: article.dek || "",
    metaTitle: article.metaTitle || article.title,
    metaDescription: article.metaDescription || article.dek || "",
    tags: classification.tags?.length ? classification.tags : article.tags || [],
    targetKeyword: topic.primaryKeyword,
    keyTakeaways: article.keyTakeaways || [],
    // Drop any FAQ that leaked a meta-refusal (insurance behind the gate's hard-block — a reader/JSON-LD
    // must never see "not detailed in the provided facts"). The Faq component renders the answer as PLAIN
    // TEXT, so flatten any markdown (links/emphasis) to text — otherwise "[x](/y)" shows literally (FIX-3).
    faq: (article.faq || [])
      .filter((f) => f && f.q && f.a && !FAQ_LEAK.test(`${f.q} ${f.a}`))
      .map((f) => ({ q: faqPlain(f.q), a: faqPlain(f.a) })),
    about: Array.isArray(article.about) ? article.about.filter((e) => e && e.name && e.type) : [],
    imageAlt,
    imageCredit: image?.credit || "Wikimedia Commons",
    image: image?.image,
    imageWidth: image?.imageWidth,
    imageHeight: image?.imageHeight,
    formatTag: classification.formatTag || article.formatTag || "",
    // music pop/indie lane (the 6%/4% axis) — preserved for the future indie badge / analytics
    ...(topic.tier ? { tier: topic.tier } : {}),
  };
  // Homepage placement signals (HOMEPAGE_PROGRAMMING_PLAN.md §1.2): the FIND trend
  // score + its breakdown persist to frontmatter so the static homepage can rank
  // slots, rotate the hero, and badge trending stories at every rebuild.
  if (Number.isFinite(topic.priority)) fm.trendScore = topic.priority;
  if (topic.signals && typeof topic.signals === "object") fm.signals = topic.signals;
  if (topic.eventSlug) fm.eventSlug = topic.eventSlug;
  if (topic.eventType) fm.eventType = topic.eventType;
  {
    const outletCount = topic.verification?.outletCount ?? topic.corroborationCount;
    if (Number.isFinite(outletCount)) fm.outletCount = outletCount;
  }
  // Provenance for the post-publish recheck / auto-retraction system (only on breaking-news articles).
  // Lets recheck.mjs re-verify the event later and take down / correct / upgrade it.
  if (topic.verification && topic.sources?.length) {
    fm.provenance = {
      eventSlug: topic.eventSlug || "",
      primaryEntity: topic.primaryEntity || "",
      eventType: topic.eventType || "other",
      sensitivity: topic.verification.sensitivity || topic.sensitivity || "normal",
      status: topic.verification.status || "",
      attribution: topic.verification.attribution || null,
      outlets: topic.verification.outlets || [],
      publishedAt: dateISO,
    };
    fm.dateModified = dateISO;
    // PR2: surface the FIND trust label as the reader-facing storyStatus badge (deterministic — never
    // depends on the LLM). EVERGREEN reference pieces get no badge; held statuses collapse to HOLD.
    const STATUS_BADGE = { CONFIRMED: "CONFIRMED", DEVELOPING: "DEVELOPING", RUMOR: "RUMOR", CONFIRMING: "HOLD", QUEUE: "HOLD", "EDITORIAL-HOLD": "HOLD" };
    const badge = STATUS_BADGE[topic.verification.status];
    if (badge) fm.storyStatus = badge;
    if (topic.verification.sensitivity && topic.verification.sensitivity !== "normal") fm.sensitivity = topic.verification.sensitivity;
  }
  // strip stray markdown emphasis from plain-text structured-field strings
  const stripMd = (v) =>
    typeof v === "string"
      ? v.replace(/\*+/g, "").replace(/\s+,/g, ",").trim()
      : Array.isArray(v)
        ? v.map(stripMd)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, stripMd(x)]))
          : v;
  // merge the per-niche structured fields the generator produced (only when present)
  for (const k of ["verdict", "rating", "prosCons", "infoCard", "entries", "tldr", "spoiler", "factPanel", "filmography", "whereToWatch",
    "youtubeId", "releaseInfo", "keyMoments", "sourceOutlet", "sourceUrl", "pullQuotes", "tweetIds", "consensus",
    "newsType", "pullQuote", "boxOffice", "records",
    "awardsType", "awardShow", "awardCategories", "awardRecords",
    // MUSIC structured fields (rendered by MusicModules — Commit 3 UI; carried now so data persists)
    "release", "tracklist", "tourDates", "ticketInfo", "officialPost", "predictions",
    "careerArc", "keyTracks", "peerLine", "stats", "screenWork", "soundtrack", "songSpotlight", "discoveryArtist",
    // PLAYBOOK PR1 structured fields (rendered in PR2 UI; carried now so writer output persists)
    "storyStatus", "sensitivity", "keyPoints", "sightings", "criterion", "honorableMentions", "topFive", "bestFor",
    "readingModes", "reveals", "officialSynopsis", "seriesContext", "seriesStatus", "weekendChart", "verdictBox",
    "releaseWindows", "credits", "careerStats", "methodology", "footnotes", "speakers", "looseThreads", "atAGlance",
    "verdictBuckets", "confidenceTier", "precursorTimeline", "bottomLine"]) {
    let v = article[k];
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (k !== "spoiler") v = stripMd(v);
    fm[k] = v;
  }
  const md = matter.stringify("\n" + body.trim() + "\n", fm);
  return { slug, frontmatter: fm, md, body, internalLinks: linkResult.linked };
}
