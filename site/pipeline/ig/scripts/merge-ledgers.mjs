#!/usr/bin/env node
// CONFLICT RESOLVER for the ledger commit (owner incident 2026-07-17: a rebase conflict on
// posted.json/built.json killed the push after 5 retries → the run's posted rows were LOST → the next
// run rebuilt the same stories and DOUBLE-POSTED them). Ledgers are append-mostly JSON, so a conflict
// is always resolvable as a UNION — never a failure:
//   posted.json  → union of rows keyed (slug|platform|postId|whenISO)
//   built.json / holds.json / discovery-cache.json / weights.json / built-meta/*.json
//                → key-wise merge, ours wins per key (both sides' keys kept)
// Usage (from the workflow, inside a halted rebase): node merge-ledgers.mjs <file> <oursPath> <theirsPath>
// Reads the two sides, writes the merged JSON to <file>, exits 0. Any parse failure → keep OURS (the
// current run's rows must never be lost; theirs is already on the remote reflog).
import fs from "node:fs";

const [, , out, oursPath, theirsPath] = process.argv;
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const ours = read(oursPath);
const theirs = read(theirsPath);

function mergedValue() {
  if (ours == null) return theirs;
  if (theirs == null) return ours;
  // posted.json shape: { posts: [...] } → row union
  if (Array.isArray(ours.posts) || Array.isArray(theirs.posts)) {
    const key = (p) => `${p.slug}|${p.platform || ""}|${p.postId || ""}|${p.whenISO || ""}`;
    const seen = new Set();
    const posts = [];
    for (const p of [...(theirs.posts || []), ...(ours.posts || [])]) {
      const k = key(p);
      if (seen.has(k)) continue;
      seen.add(k);
      posts.push(p);
    }
    return { ...theirs, ...ours, posts };
  }
  // generic object ledgers → key union, ours wins per key
  if (typeof ours === "object" && typeof theirs === "object" && !Array.isArray(ours) && !Array.isArray(theirs)) {
    return { ...theirs, ...ours };
  }
  return ours;
}

fs.writeFileSync(out, JSON.stringify(mergedValue(), null, 2));
console.log(`merged ${out} (ours=${oursPath ? "y" : "n"} theirs=${theirsPath ? "y" : "n"})`);
