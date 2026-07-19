// GOSSIP — VECTOR + RELATIONAL STORE (Step 1 infra, JSON-backed). A dependency-free persistent store for dedup
// (Step 2) and internal-links (Step 7): keeps each record's exact hashes, eventKey, entities, summary and
// embedding, loaded into memory for brute-force cosine search (sub-millisecond at this scale). No native
// modules (better-sqlite3 won't compile here, and isn't needed) — migrate to a real vector DB at tens of
// thousands of records (the owner's deferred "at-scale vector store" decision).
// Hardened (audit): urlHash/eventKey are Map-indexed (O(1)); createdAt is validated on write; all reads return
// COPIES so a caller can't corrupt in-memory state.
import fs from "node:fs";
import { entityKey } from "./normalize.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cosine } from "./embed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "../../data/gossip/store.json");

const copy = (r) => (r ? { ...r, entities: [...(r.entities || [])], meta: { ...(r.meta || {}) } } : null);
const validDate = (s) => (s && !isNaN(Date.parse(s)) ? s : new Date().toISOString());

export function openStore(filePath = DEFAULT_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let records = [];
  if (fs.existsSync(filePath)) {
    // 2026-07-19: this used to swallow a corrupt store into `records = []`, so a truncated write (a crash
    // mid-save) would make dedup start from EMPTY history — every story looks new and the lane republishes
    // its whole recent backlog. A missing file is a legitimate first run; a PRESENT but unreadable one is
    // data loss and must fail CLOSED (dedupCheck wraps this and returns HOLD, and gossiprun re-queues).
    try { records = JSON.parse(fs.readFileSync(filePath, "utf8")).records || []; }
    catch (e) { throw new Error(`dedup store unreadable at ${filePath} (${String(e?.message || e).slice(0, 60)}) — refusing to run with empty dedup history`); }
  }
  const byKey = new Map(), byUrl = new Map(), byEvent = new Map();
  const index = (r) => {
    byKey.set(r.key, r);
    if (r.urlHash) byUrl.set(r.urlHash, r);
    if (r.eventKey) { const a = byEvent.get(r.eventKey) || []; if (!a.includes(r)) a.push(r); byEvent.set(r.eventKey, a); }
  };
  records.forEach((r) => { r.createdAt = validDate(r.createdAt); index(r); });
  const save = () => fs.writeFileSync(filePath, JSON.stringify({ records }));

  return {
    // MERGE upsert: only the fields you provide are updated; existing fields are kept. embedding stored as a
    // rounded plain array to keep the JSON compact (cosine unaffected at 5dp). Keeps the indexes consistent.
    upsert(rec) {
      const existing = byKey.get(rec.key);
      const oldUrl = existing?.urlHash, oldEvent = existing?.eventKey;
      const row = existing || { key: rec.key, kind: "", urlHash: "", eventKey: "", entities: [], summary: "", embedding: null, meta: {}, createdAt: new Date().toISOString() };
      for (const f of ["kind", "urlHash", "eventKey", "entities", "summary", "meta"]) if (rec[f] !== undefined) row[f] = rec[f];
      if (rec.embedding !== undefined) row.embedding = rec.embedding ? Array.from(rec.embedding, (x) => +Number(x).toFixed(5)) : null;
      if (rec.createdAt !== undefined) row.createdAt = validDate(rec.createdAt);
      if (!existing) records.push(row);
      else {
        if (oldUrl && oldUrl !== row.urlHash) byUrl.delete(oldUrl);
        if (oldEvent && oldEvent !== row.eventKey) { const a = (byEvent.get(oldEvent) || []).filter((x) => x !== row); a.length ? byEvent.set(oldEvent, a) : byEvent.delete(oldEvent); }
      }
      index(row);
      save();
      return copy(row);
    },
    get(key) { return copy(byKey.get(key)); },
    byUrlHash(h) { return copy(h ? byUrl.get(h) : null); },
    byEventKey(k) { return (byEvent.get(k) || []).map(copy); },
    getAll() { return records.map(copy); },
    count() { return records.length; },
    // brute-force cosine search over records with an embedding; optional entity + recency-window filters.
    search(vec, { k = 5, sinceDays = null, entity = null, minScore = 0 } = {}) {
      const cut = sinceDays ? Date.now() - sinceDays * 864e5 : 0;
      const q = Float32Array.from(vec);
      return records
        // 2026-07-19: this compared raw display spellings, so "Bunnie XO" searched 1 record while 5 exist
        // and "Beyonce" searched ZERO while 3 exist — and zero candidates falls through to NEW, i.e. the
        // semantic layer failed OPEN against its own documented fail-closed contract. Fold both sides.
        .filter((r) => r.embedding && (!entity || (r.entities || []).some((e) => entityKey(e) === entityKey(entity))) && (!cut || Date.parse(r.createdAt) >= cut))
        .map((r) => ({ ...copy(r), score: cosine(q, Float32Array.from(r.embedding)) }))
        .filter((r) => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  };
}
