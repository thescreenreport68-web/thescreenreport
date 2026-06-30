// GOSSIP — VECTOR + RELATIONAL STORE (Step 1 infra, JSON-backed). A dependency-free persistent store for dedup
// (Step 2) and internal-links (Step 7): keeps each record's exact hashes, eventKey, entities, summary and
// embedding, loaded into memory for brute-force cosine search (sub-millisecond at this scale). No native
// modules (better-sqlite3 won't compile here, and isn't needed) — migrate to a real vector DB at tens of
// thousands of records (the owner's deferred "at-scale vector store" decision).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cosine } from "./embed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "../../data/gossip/store.json");

export function openStore(filePath = DEFAULT_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let records = [];
  if (fs.existsSync(filePath)) {
    try { records = JSON.parse(fs.readFileSync(filePath, "utf8")).records || []; } catch { records = []; }
  }
  const byKey = new Map(records.map((r) => [r.key, r]));
  const save = () => fs.writeFileSync(filePath, JSON.stringify({ records }));

  return {
    // upsert a record. MERGE semantics: only the fields you provide are updated; existing fields are kept (so a
    // later "update this record's status" call won't wipe its embedding/eventKey). embedding is stored as a
    // rounded plain array to keep the JSON compact (cosine is unaffected at 5dp).
    upsert(rec) {
      const existing = byKey.get(rec.key);
      const row = existing || { key: rec.key, kind: "", urlHash: "", eventKey: "", entities: [], summary: "", embedding: null, meta: {}, createdAt: new Date().toISOString() };
      for (const f of ["kind", "urlHash", "eventKey", "entities", "summary", "meta", "createdAt"]) if (rec[f] !== undefined) row[f] = rec[f];
      if (rec.embedding !== undefined) row.embedding = rec.embedding ? Array.from(rec.embedding, (x) => +Number(x).toFixed(5)) : null;
      if (!existing) { records.push(row); byKey.set(rec.key, row); }
      save();
      return row;
    },
    get(key) { return byKey.get(key) || null; },
    byUrlHash(h) { return (h && records.find((r) => r.urlHash === h)) || null; },
    byEventKey(k) { return records.filter((r) => r.eventKey === k); },
    getAll() { return records.slice(); },
    count() { return records.length; },
    // brute-force cosine search over records with an embedding; optional entity + recency-window filters.
    search(vec, { k = 5, sinceDays = null, entity = null, minScore = 0 } = {}) {
      const cut = sinceDays ? Date.now() - sinceDays * 864e5 : 0;
      const q = Float32Array.from(vec);
      return records
        .filter((r) => r.embedding && (!entity || r.entities.includes(entity)) && (!cut || Date.parse(r.createdAt) >= cut))
        .map((r) => ({ ...r, score: cosine(q, Float32Array.from(r.embedding)) }))
        .filter((r) => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}
