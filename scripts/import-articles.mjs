import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "content", "articles");

// The raw workflow result (JSON). Pass a path as argv[2] to override.
const SRC =
  process.argv[2] ||
  "/private/tmp/claude-501/-Users-sivajithcu-Movie-News-site/f8bb6444-dd50-471f-8753-9b4af241679b/tasks/wjq49zhul.output";

const raw = fs.readFileSync(SRC, "utf8");
const data = JSON.parse(raw);

function looksLikeArticles(v) {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => x && typeof x === "object" && "slug" in x && "body" in x)
  );
}

let articles = null;
if (looksLikeArticles(data)) articles = data;
else
  for (const k of Object.keys(data)) {
    if (looksLikeArticles(data[k])) {
      articles = data[k];
      break;
    }
  }
if (!articles) {
  console.error("Could not find articles array. Top-level keys:", Object.keys(data));
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

function cleanBody(s) {
  let b = String(s ?? "");
  // strip any stray tool-call / tag artifacts that leaked into output
  b = b.replace(
    /<\/?(antml:invoke|invoke|antml:parameter|parameter|function_calls|factCheckNotes|tool_call)[^>]*>/gi,
    ""
  );
  // remove a leading H1 (we render the title separately)
  b = b.replace(/^﻿?\s*#\s+[^\n]*\n+/, "");
  return b.trim();
}

const base = new Date("2026-06-25T15:00:00Z").getTime();
let count = 0;

articles.forEach((a, i) => {
  const date = new Date(base - i * 16 * 3600 * 1000).toISOString();
  const fm = {
    title: a.title,
    slug: a.slug,
    category: a.category,
    author: a.author,
    date,
    dek: a.dek ?? "",
    metaTitle: a.metaTitle ?? a.title,
    metaDescription: a.metaDescription ?? a.dek ?? "",
    tags: a.tags ?? [],
    targetKeyword: a.targetKeyword ?? "",
    imageAlt: a.imageAlt ?? a.title,
    imageCredit: a.imageCredit ?? "The Screen Report",
    faq: a.faq ?? [],
    featured: i === 0,
  };
  const body = cleanBody(a.body);
  const file = path.join(OUT, `${a.slug}.md`);
  fs.writeFileSync(file, matter.stringify("\n" + body + "\n", fm), "utf8");
  count++;
  const words = body.split(/\s+/).filter(Boolean).length;
  console.log(`  + ${a.category}/${a.slug}  (${words} words, ${fm.faq.length} FAQs)`);
});

console.log(`\nWrote ${count} article files to ${OUT}`);
