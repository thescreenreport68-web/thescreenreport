// STEP 1 INFRA TEST — embeddings + the JSON store (the shared foundation for dedup + internal-links).
// Run: node pipeline/gossip/test/store-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { embed, cosine } from "../embed.mjs";
import { openStore } from "../vecStore.mjs";

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n); } };

console.log("\n=== STEP 1 INFRA TEST (embeddings + store) ===\n");

// ── embeddings ──
const a = await embed("Selena Gomez sparks engagement rumors with a new ring");
const b = await embed("Selena Gomez spotted with an engagement ring, fueling wedding talk"); // reworded SAME story
const c = await embed("Taylor Swift announces a brand new studio album"); // DIFFERENT story
check("embed returns a 384-dim vector", a.length === 384);
check("reworded-same-story scores higher than a different story", cosine(a, b) > cosine(a, c));
console.log(`     (same=${cosine(a, b).toFixed(3)}  different=${cosine(a, c).toFixed(3)})`);

// ── store ──
const tmp = path.join(os.tmpdir(), "gossip-store-" + Date.now() + ".json");
const store = openStore(tmp);
store.upsert({ key: "s1", urlHash: "h1", eventKey: "selena-gomez|engagement|2026-06", entities: ["Selena Gomez"], summary: "Selena engagement rumor", embedding: a });
store.upsert({ key: "s2", urlHash: "h2", eventKey: "selena-gomez|engagement|2026-06", entities: ["Selena Gomez"], summary: "Selena ring spotted", embedding: b });
store.upsert({ key: "t1", urlHash: "h3", eventKey: "taylor-swift|album|2026-06", entities: ["Taylor Swift"], summary: "Taylor album", embedding: c });

check("count is 3 after 3 upserts", store.count() === 3);
check("upsert dedups by key (no duplicate row)", (store.upsert({ key: "s1", urlHash: "h1", entities: ["Selena Gomez"], summary: "updated", embedding: a }), store.count() === 3));
check("byUrlHash finds the exact record", store.byUrlHash("h1")?.key === "s1");
check("byEventKey groups same-event records", store.byEventKey("selena-gomez|engagement|2026-06").length === 2);

const res = store.search(a, { k: 3 });
check("search ranks the two Selena stories above the Taylor one", res[0].entities.includes("Selena Gomez") && res[1].entities.includes("Selena Gomez") && res[2].key === "t1");
check("search entity filter restricts results", store.search(a, { entity: "Taylor Swift" }).every((r) => r.entities.includes("Taylor Swift")));

// ── persistence ──
const store2 = openStore(tmp);
check("store persists across reopen", store2.count() === 3 && store2.byUrlHash("h1")?.key === "s1");
fs.rmSync(tmp, { force: true });

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) process.exit(1);
console.log("Step 1 infra green. ✅\n");
