// GOSSIP — INTERNAL-LINK INDEX (Step 7). Builds a small embedding index over the REAL published articles in the
// content dir so a new gossip story can link ONLY to articles that actually exist (no invented links). Each entry
// carries the article's entities (for the shared-entity gate) + a title/dek embedding (for semantic ranking).
// Cached by content hash so we re-embed only what changed — cheap, local, keyless (bge-small via embed.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import { embed as defaultEmbed } from "./embed.mjs";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, "../../content/articles");
const CACHE_PATH = path.resolve(__dirname, "../../data/gossip/link-index.json");

const hash = (s) => crypto.createHash("sha1").update(s || "").digest("hex").slice(0, 16);

// Proper-name-ish entities from a title: runs of 2+ capitalized words (catches "Selena Gomez", "Taylor Swift")
// so older articles without structured frontmatter still get a shared-entity signal.
export function titleNames(title) {
  const out = [];
  for (const m of (title || "").matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z'’.-]+)+)\b/g)) { const n = m[1].trim(); if (!out.includes(n)) out.push(n); }
  return out;
}

// The entity set we gate links on: the structured primaryEntity + about[] names + title names.
export function articleEntities(data) {
  const set = new Set();
  if (data?.provenance?.primaryEntity) set.add(data.provenance.primaryEntity);
  for (const a of data?.about || []) if (a?.name) set.add(a.name);
  for (const n of titleNames(data?.title)) set.add(n);
  return [...set].filter(Boolean);
}

// Build (or incrementally refresh) the link index. Returns [{ slug, title, url, category, formatTag, date,
// entities, claim, embedding:number[] }]. embedImpl/files injectable for offline tests.
export async function buildLinkIndex({ dir = CONTENT_DIR, cachePath = CACHE_PATH, embedImpl = defaultEmbed, files = null, persist = true } = {}) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, "utf8")); } catch { /* first run */ }
  const list = files || (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") || f.endsWith(".mdx")) : []);
  const index = [];
  let changed = false;
  for (const file of list) {
    let raw;
    try { raw = fs.readFileSync(path.join(dir, file), "utf8"); } catch { continue; }
    let data;
    try { ({ data } = matter(raw)); } catch { continue; } // a malformed file must not abort the whole index
    if (data?.draft) continue;
    const slug = data.slug || file.replace(/\.mdx?$/, "");
    const entities = articleEntities(data);
    const text = [data.title, data.dek, entities.join(", ")].filter(Boolean).join(". ");
    const h = hash(text);
    let rec = cache[slug];
    if (!rec || rec.h !== h || !Array.isArray(rec.embedding)) {
      const emb = await embedImpl(text);
      rec = {
        slug, title: data.title || slug, url: `/${data.category}/${slug}/`, category: data.category || "",
        formatTag: data.formatTag || "", date: data.date || "", entities,
        claim: data?.provenance?.claim || data.dek || "", h, embedding: Array.from(emb),
      };
      cache[slug] = rec; changed = true;
    }
    index.push(rec);
  }
  if (changed && persist) { try { fs.mkdirSync(path.dirname(cachePath), { recursive: true }); fs.writeFileSync(cachePath, JSON.stringify(cache)); } catch { /* cache is best-effort */ } }
  return index;
}
