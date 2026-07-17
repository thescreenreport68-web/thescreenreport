import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");
import { TAXONOMY, AUTHOR_SLUG } from "../config.mjs";
import { addInternalLinks, isRemovedForm } from "../lib/internalLinks.mjs";
import { finishMetaTitle, finishMetaDescription, driftGuard, entityFidelity, slugifyTitle } from "../lib/seoFinish.mjs";
import { anchorGuards, cleanSourcesSection, sanitizeBareUrls } from "../lib/factGuards.mjs";

import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url)); // …/site/pipeline/stages
const ART = path.resolve(__dirname, "../../content/articles");

// Meta-refusal / prompt-leak phrases a reader (or the FAQ JSON-LD) must never see — assemble-level
// insurance behind the gate's PROMPT_LEAK hard-block.
const FAQ_LEAK = /\b(not (?:detailed|specified|mentioned|provided|stated|available|listed|included) in the (?:provided |reference |given |available )?(?:facts|information|sources|text|article|context|material)|the (?:provided |reference |given )?(?:facts|information|sources) (?:do(?:es)?n'?t|do not|does not)|based on the provided (?:facts|information)|as an ai|the reference facts)\b/i;

// slug: diacritics transliterated + 75-char cap on a WORD boundary (root-fix 2026-07-16 — was a blind
// slice(0,75) that shipped "…-merger-lawsu" and mangled "Maridueña" → "maridue-a"). Lives in seoFinish.mjs.
const slugify = (s) => slugifyTitle(s, 75);

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
  // ENTITY-SPELLING FIDELITY (root-fix 2026-07-16, the 'Unleeshed'→"Unleashed" case): the writer must never
  // spell-"correct" the real name of the thing the story is about — FIND's primaryEntity carries the SOURCE
  // spelling; if it never appears verbatim but a near-miss variant does, every occurrence (title, body, FAQs,
  // even inside direct quotes) is restored to the source spelling BEFORE anything downstream reads the article.
  article = entityFidelity(article, topic.primaryEntity);
  // ANTI-FABRICATION ANCHORS (root-fix 2026-07-17, the fabricated-Jagger-quotes / invented-Oct-25-date class):
  // any quoted passage or explicit calendar date NOT present in the source bundle is CUT (cut-not-hold).
  // The writer may only restate the source — these guards make that mechanically true.
  {
    const bundleText = (topic._bundle?.sources || []).map((s) => s.text || "").join("\n");
    const g = anchorGuards(article, bundleText);
    if (g.cuts.length) console.log(`  ✂ anchor guards cut ${g.cuts.length}: ${g.cuts.slice(0, 4).join(" · ")}`);
    article = g.article;
  }
  // Placeholder citation URLs (a bare "https://www.instagram.com/" is not a source) → dropped field-wide.
  article = sanitizeBareUrls(article);
  // Belt for the "Power:: Origins" class — a doubled colon is never legitimate in a title or body.
  for (const k of ["title", "dek", "body", "metaTitle", "metaDescription"])
    if (typeof article[k] === "string") article[k] = article[k].replace(/::+/g, ":");
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

  // SLUG from the writer's FINAL, corrected headline — NOT the stale FIND topic headline (owner 2026-07-06). The FIND
  // angle can be pre-correction (a "Reba McEntire to HOST…" topic the writer rightly rewrites to "…JOINS…"); using
  // topic.slug first baked the wrong word into the URL. Prefer slugify(article.title); fall back to topic.slug only
  // if the writer somehow returned no title.
  const slug = slugify(article.title) || topic.slug;
  // Support-system #1: insert 2-3 REAL, tone-safe internal links to related published articles +
  // strip any dangling "see our feature" phantom phrases. Runs AFTER fixLinks (these links are valid).
  const tagsForLinks = classification.tags?.length ? classification.tags : article.tags || [];
  const linkResult = addInternalLinks({ body, title: article.title, tags: tagsForLinks, category: classification.category, slug }, { max: 3 });
  body = linkResult.body;
  // SOURCES HYGIENE (root-fix 2026-07-17): the Sources section may cite only real EXTERNAL links —
  // internal/linkless bullets are fabricated attribution and are dropped (section removed if emptied).
  body = cleanSourcesSection(body);
  // BASIC SEO — deterministic guarantee (owner 2026-07-14; ROOT-CAUSE REBUILD 2026-07-16): EVERY article ships a
  // search-optimized metaTitle (45–55 target, brand-free, NEVER a mid-phrase fragment — the old clampWords blind
  // last-space cut shipped "…Cast in Netflix's The" / "…Lineup with Margot"), a 140–160 complete-sentence
  // metaDescription, and keyword tags, even when the cheap writer model slips. All finishers live in
  // lib/seoFinish.mjs (semantic tail rules + name-pair completion + quote balance; full-text ≤65 beats a fragment).
  // These live only in <head> + JSON-LD, so they never affect on-page readability.
  const bodyPlain = body.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^#+\s.*$/gm, " ").replace(/[*_`>]/g, " ").replace(/\s+/g, " ").trim();
  const metaTitle = finishMetaTitle({ model: article.metaTitle, title: article.title });
  const metaDescription = finishMetaDescription({ model: article.metaDescription, dek: article.dek, bodyText: bodyPlain.slice(0, 1500) });
  let seoTags = (classification.tags?.length ? classification.tags : article.tags || []).filter(Boolean);
  if (!seoTags.length) seoTags = [...new Set([topic.primaryEntity, classification.category, ...String(topic.primaryKeyword || "").split(/\s+/)].filter(Boolean).map((s) => String(s).toLowerCase()))].slice(0, 8);
  // TOPIC→ARTICLE DRIFT GUARD (root-fix 2026-07-16, the Bonta/"swimming lesson" case): FIND metadata describes
  // the TOPIC that was selected; when the written article is about something else (wrong page behind a source
  // redirect, an editorial subject correction), inheriting it verbatim ships wrong-story SEO. Validate every
  // inherited field against the final title+body; re-derive from the article itself on mismatch.
  const drift = driftGuard({ article, topic, tags: seoTags, bodyText: bodyPlain, slug });
  if (drift.drifted) console.log(`  ✎ drift guard: topic keyword "${topic.primaryKeyword}" absent from article → targetKeyword "${drift.targetKeyword}", tags [${drift.tags.join(", ")}], eventSlug "${drift.eventSlug}"`);
  if (drift.tags.length) seoTags = drift.tags;
  // imageAlt only keeps the imageQuery prefix when the query matches this article (drift class), is not
  // redundant with the title ("Mayday in Mayday — …"), and does not claim a PERSON is pictured over TMDB
  // work-art ("Brian Tyler in Yellowstone" on a Yellowstone still that shows no Brian Tyler).
  const iq = String(article.imageQuery || "").trim();
  const iqRedundant = iq && String(article.title || "").toLowerCase().includes(iq.toLowerCase());
  const iqPersonOnWorkArt = / in /i.test(` ${iq} `) && /image\.tmdb\.org/.test(image?.image || "");
  const imageAlt = (
    (iq && drift.imageQueryOk && !iqRedundant && !iqPersonOnWorkArt ? iq + " — " : "") + (article.title || "")
  ).slice(0, 125);

  const fm = {
    title: article.title,
    slug,
    category: classification.category,
    subcategory: classification.subcategory,
    author: AUTHOR_SLUG,
    date: dateISO,
    dek: article.dek || "",
    metaTitle,
    metaDescription,
    tags: seoTags,
    targetKeyword: drift.targetKeyword,
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
  if (drift.eventSlug) fm.eventSlug = drift.eventSlug;
  if (drift.eventType) fm.eventType = drift.eventType;
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
      ? v.replace(/\*+/g, "").replace(/::+/g, ":").replace(/\s+,/g, ",").trim()
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
