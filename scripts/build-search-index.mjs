// Build the D1 search index SQL (Phase 1 of ARCHITECTURE_MIGRATION_PLAN.md).
// Reads content/articles/*.md and emits search-index.sql: a full refresh of the
// `articles` table + an FTS5 rebuild. Run by deploy-live after the site build:
//   node scripts/build-search-index.mjs && npx -y wrangler@4 d1 execute tsr-search --remote -y --file=search-index.sql
// Full-refresh is fine at this scale (hundreds–thousands of rows, ~1–3 MB SQL);
// Phase 2's content store replaces this with incremental upserts.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const DIR = path.join(process.cwd(), "content", "articles");
const OUT = path.join(process.cwd(), "search-index.sql");

const esc = (s) => String(s ?? "").replace(/'/g, "''");
// markdown → plain text good enough for an FTS index
const plain = (md) =>
  String(md ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".md") || f.endsWith(".mdx"));
const rows = [];
for (const f of files) {
  const { data, content } = matter(fs.readFileSync(path.join(DIR, f), "utf8"));
  if (!data.title || !data.category || data.robots === "noindex") continue;
  const slug = data.slug || f.replace(/\.mdx?$/, "");
  rows.push(
    `('${esc(slug)}','${esc(data.category)}','${esc(data.title)}','${esc(data.dek ?? "")}','${esc(
      data.date
    )}','${esc(data.image ?? "")}','${esc(plain(content))}')`
  );
}

const sql = [
  `CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    dek TEXT DEFAULT '',
    date TEXT NOT NULL,
    image TEXT DEFAULT '',
    body TEXT DEFAULT ''
  );`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(title, dek, body, content='articles', content_rowid='id');`,
  `DELETE FROM articles;`,
];
// Chunk INSERTs by BYTE SIZE, not row count — D1 rejects statements over ~100KB
// (SQLITE_TOOBIG; broke the deploy at 1,030 articles when 40-row batches outgrew the cap).
const PREFIX = "INSERT INTO articles (slug, category, title, dek, date, image, body) VALUES\n";
const MAX_SQL = 80_000;
let batch = [];
let batchLen = PREFIX.length;
for (const row of rows) {
  if (batch.length && batchLen + row.length + 2 > MAX_SQL) {
    sql.push(PREFIX + batch.join(",\n") + ";");
    batch = []; batchLen = PREFIX.length;
  }
  batch.push(row); batchLen += row.length + 2;
}
if (batch.length) sql.push(PREFIX + batch.join(",\n") + ";");
sql.push(`INSERT INTO articles_fts(articles_fts) VALUES('rebuild');`);
fs.writeFileSync(OUT, sql.join("\n"));
console.log(`search-index.sql: ${rows.length} articles, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
