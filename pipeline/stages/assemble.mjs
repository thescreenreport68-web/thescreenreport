import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");
import { TAXONOMY, AUTHOR_SLUG } from "../config.mjs";
import { addInternalLinks } from "../lib/internalLinks.mjs";

const ART = "/Users/sivajithcu/Movie News site/site/content/articles";

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
    set.add(`/${d.category}/${d.slug || f.replace(/\.md$/, "")}/`);
  }
  return set;
}

export function assemble({ article, classification, image, topic, dateISO }) {
  const valid = validPaths();
  // Keep internal links that resolve to a real page; otherwise drop the link, keep the text.
  const fixLinks = (s) =>
    typeof s === "string"
      ? s.replace(/\[([^\]]+)\]\((\/[^)]*)\)/g, (m, txt, href) => {
          const norm = href.endsWith("/") ? href : href + "/";
          return valid.has(norm) ? `[${txt}](${norm})` : txt;
        })
      : s;
  let body = fixLinks(article.body || "");

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
    faq: (article.faq || []).filter((f) => f && f.q && f.a).map((f) => ({ ...f, a: fixLinks(f.a) })),
    about: Array.isArray(article.about) ? article.about.filter((e) => e && e.name && e.type) : [],
    imageAlt,
    imageCredit: image?.credit || "Wikimedia Commons",
    image: image?.image,
    imageWidth: image?.imageWidth,
    imageHeight: image?.imageHeight,
    formatTag: classification.formatTag || article.formatTag || "",
  };
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
    "youtubeId", "releaseInfo", "keyMoments", "sourceOutlet", "sourceUrl", "pullQuotes", "tweetIds", "instagramUrls", "consensus",
    "newsType", "pullQuote", "boxOffice", "records",
    "awardsType", "awardShow", "awardCategories", "awardRecords"]) {
    let v = article[k];
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (k !== "spoiler") v = stripMd(v);
    fm[k] = v;
  }
  const md = matter.stringify("\n" + body.trim() + "\n", fm);
  return { slug, frontmatter: fm, md, body, internalLinks: linkResult.linked };
}
