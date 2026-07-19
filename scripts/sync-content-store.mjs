// Phase 2 (ARCHITECTURE_MIGRATION_PLAN.md): sync content/articles/*.md into the
// content store — R2 bucket `tsr-articles` (raw markdown bodies, key articles/<slug>.md)
// + D1 `tsr-content`.articles_meta (queryable core columns + FULL frontmatter JSON).
// Git stays the publish interface: the lanes commit markdown exactly as before, and
// deploy-live runs this after deploying. INCREMENTAL — a per-slug sha256 in D1 means a
// normal deploy uploads only the handful of new/changed articles (the first run bulk-loads).
// Verifies itself (fs count vs D1 count + field spot-checks) and exits 1 on mismatch.
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID. Optional: SKIP_R2=1 (D1 only).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const DB_ID = "015b1dc4-c389-470b-a391-67c24d7a1156"; // tsr-content
const BUCKET = "tsr-articles";
const SKIP_R2 = process.env.SKIP_R2 === "1";
if (!TOKEN || !ACCOUNT) { console.error("missing CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID"); process.exit(1); }

const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;
const H = { Authorization: `Bearer ${TOKEN}` };

async function d1(sql) {
  const r = await fetch(`${API}/d1/database/${DB_ID}/query`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ sql }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`D1: ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j.result;
}
async function r2put(key, body) {
  const r = await fetch(`${API}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`, {
    method: "PUT", headers: { ...H, "Content-Type": "text/markdown; charset=utf-8" }, body,
  });
  const j = await r.json().catch(() => ({ success: r.ok }));
  if (!j.success) throw new Error(`R2 put ${key}: ${JSON.stringify(j.errors ?? r.status).slice(0, 200)}`);
}
async function r2del(key) {
  await fetch(`${API}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`, { method: "DELETE", headers: H });
}
const esc = (s) => String(s ?? "").replace(/'/g, "''");

// ---- 1) read the fs truth ----
const DIR = path.join(process.cwd(), "content", "articles");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".md") || f.endsWith(".mdx"));
const local = new Map(); // slug -> {raw, hash, data}
for (const f of files) {
  const raw = fs.readFileSync(path.join(DIR, f), "utf8");
  const { data } = matter(raw);
  if (!data?.title || !data?.category || !data?.date) continue; // same validity bar as the site build
  const slug = data.slug || f.replace(/\.mdx?$/, "");
  local.set(slug, { raw, hash: crypto.createHash("sha256").update(raw).digest("hex"), data });
}

// ---- 2) schema + current D1 state ----
await d1(`CREATE TABLE IF NOT EXISTS articles_meta (
  slug TEXT PRIMARY KEY, category TEXT NOT NULL, subcategory TEXT, date TEXT NOT NULL,
  updated TEXT, robots TEXT, formatTag TEXT, featured INTEGER DEFAULT 0,
  trendScore REAL, eventSlug TEXT, hash TEXT NOT NULL, frontmatter TEXT NOT NULL
)`);
await d1(`CREATE INDEX IF NOT EXISTS idx_meta_date ON articles_meta(date DESC)`);
await d1(`CREATE INDEX IF NOT EXISTS idx_meta_cat_date ON articles_meta(category, date DESC)`);
const existing = new Map();
{
  const res = await d1(`SELECT slug, hash FROM articles_meta`);
  for (const row of res[0]?.results ?? []) existing.set(row.slug, row.hash);
}

// ---- 3) diff ----
const changed = [...local.entries()].filter(([slug, v]) => existing.get(slug) !== v.hash);
const removed = [...existing.keys()].filter((slug) => !local.has(slug));
console.log(`fs: ${local.size} articles | D1: ${existing.size} | changed/new: ${changed.length} | removed: ${removed.length}`);

// ---- 4) R2 bodies (changed only; concurrency 6). FORCE_R2=1 uploads EVERY local body
// regardless of the hash diff — the one-time backfill mode for when D1 was loaded first. ----
const r2set = process.env.FORCE_R2 === "1" ? [...local.entries()] : changed;
if (!SKIP_R2 && r2set.length) {
  let done = 0;
  const queue = [...r2set];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const [slug, v] = item;
      await r2put(`articles/${slug}.md`, v.raw);
      if (++done % 100 === 0) console.log(`  r2: ${done}/${r2set.length}`);
    }
  }));
  console.log(`  r2: uploaded ${done}`);
  // verify a sample object round-trips byte-identical
  const [vslug, vv] = r2set[0];
  const got = await fetch(`${API}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(`articles/${vslug}.md`)}`, { headers: H });
  const body = await got.text();
  if (body !== vv.raw) { console.error(`  R2 VERIFY FAILED for ${vslug}`); process.exit(1); }
  console.log(`  r2: sample round-trip verified (${vslug})`);
}
if (!SKIP_R2) for (const slug of removed) await r2del(`articles/${slug}.md`);

// ---- 5) D1 upserts (chunked by SQL byte-size — D1 rejects statements >~100KB;
// gossip frontmatter can run tens of KB per row, so a fixed row count won't do) ----
const PREFIX = `INSERT OR REPLACE INTO articles_meta (slug,category,subcategory,date,updated,robots,formatTag,featured,trendScore,eventSlug,hash,frontmatter) VALUES `;
const MAX_SQL = 80_000;
let batch = [];
let batchLen = PREFIX.length;
async function flush() {
  if (!batch.length) return;
  await d1(PREFIX + batch.join(","));
  batch = [];
  batchLen = PREFIX.length;
}
for (const [slug, v] of changed) {
  const d = v.data;
  const row = `('${esc(slug)}','${esc(d.category)}','${esc(d.subcategory ?? "")}','${esc(d.date)}','${esc(
    d.updated ?? d.dateModified ?? ""
  )}','${esc(d.robots ?? "")}','${esc(d.formatTag ?? "")}',${d.featured ? 1 : 0},${
    Number.isFinite(+d.trendScore) ? +d.trendScore : "NULL"
  },'${esc(d.eventSlug ?? "")}','${v.hash}','${esc(JSON.stringify(d))}')`;
  if (batchLen + row.length > MAX_SQL) await flush();
  batch.push(row);
  batchLen += row.length + 1;
}
await flush();
if (removed.length)
  await d1(`DELETE FROM articles_meta WHERE slug IN (${removed.map((s) => `'${esc(s)}'`).join(",")})`);

// ---- 6) verify ----
const [cnt] = await d1(`SELECT COUNT(*) AS n FROM articles_meta`);
const n = cnt.results[0].n;
let ok = n === local.size;
// spot-check 3 rows: stored frontmatter must round-trip to the fs values
const sample = [...local.keys()].filter((_, i) => i % Math.max(1, Math.floor(local.size / 3)) === 0).slice(0, 3);
for (const slug of sample) {
  const [row] = await d1(`SELECT frontmatter FROM articles_meta WHERE slug='${esc(slug)}'`);
  const fm = JSON.parse(row.results[0]?.frontmatter ?? "{}");
  const truth = local.get(slug).data;
  if (fm.title !== truth.title || fm.category !== truth.category) { ok = false; console.error(`  MISMATCH ${slug}`); }
}
console.log(`verify: D1 rows=${n} vs fs=${local.size} | spot-checks ${sample.length} | ${ok ? "OK" : "FAILED"}`);
process.exit(ok ? 0 : 1);
