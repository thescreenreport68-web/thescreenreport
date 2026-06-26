import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");
import { TAXONOMY, AUTHOR_SLUG } from "../config.mjs";

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
  let body = article.body || "";
  // Keep internal links that resolve to a real page; otherwise drop the link, keep the text.
  body = body.replace(/\[([^\]]+)\]\((\/[^)]*)\)/g, (m, txt, href) => {
    const norm = href.endsWith("/") ? href : href + "/";
    return valid.has(norm) ? `[${txt}](${norm})` : txt;
  });

  const slug = topic.slug || slugify(article.title);
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
    faq: (article.faq || []).filter((f) => f && f.q && f.a),
    about: Array.isArray(article.about) ? article.about.filter((e) => e && e.name && e.type) : [],
    imageAlt,
    imageCredit: image?.credit || "Wikimedia Commons",
    image: image?.image,
    imageWidth: image?.imageWidth,
    imageHeight: image?.imageHeight,
    formatTag: classification.formatTag || article.formatTag || "",
  };
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
  for (const k of ["verdict", "rating", "prosCons", "infoCard", "entries", "tldr", "spoiler", "factPanel", "filmography", "whereToWatch"]) {
    let v = article[k];
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (k !== "spoiler") v = stripMd(v);
    fm[k] = v;
  }
  const md = matter.stringify("\n" + body.trim() + "\n", fm);
  return { slug, frontmatter: fm, md };
}
