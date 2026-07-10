// INSIDE lane — UPDATER TESTS (updater.mjs = the renamed monitor; offline: temp content dir,
// injected getTweet/harvest/store). Covers: dead-embed drop (+ the frontmatter-undefined
// regression), the >=2-new-posts top-up rule with the FULL-harvest fingerprint dedup, one
// straggler = UNCHANGED, parent-missing one-shot cascade, out-of-window article unwatched,
// dry-run byte-identical.
// Run: env -i node site/pipeline/inside/test/updater.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { monitorInside } from "../updater.mjs";
import { norm } from "../reactionFinder.mjs";
import { USAGE } from "../../lib/openrouter.mjs";
import { DATA_DIR } from "../config.inside.mjs";
import { NOW, tmp, Q, fakeTrigger, fakeAngle, TWEET_ID_A, TWEET_ID_B } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");

let pass = 0, fail = 0; const fails = [];
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; fails.push(name); console.log(`  ❌ ${name}  ${String(e?.message || e).slice(0, 220)}`); }
};

console.log("\n=== INSIDE UPDATER TESTS (offline) ===\n");

// Write an inside article .md into `dir`; returns its path.
function writeArticle(dir, over = {}) {
  const ageH = over.ageH ?? 6;
  const fm = {
    title: "The Sable Coast Has Audiences Sharply Divided Over Its Ending",
    slug: over.slug || "the-sable-coast-divided",
    category: "movies",
    subcategory: "news",
    author: "editorial-team",
    date: new Date(NOW - ageH * 36e5).toISOString(),
    formatTag: "inside",
    insideForm: "audience-reaction",
    parentEventSlug: "the-sable-coast-2026",
    ...(over.parentSlug !== undefined ? { parentSlug: over.parentSlug } : {}),
    reactions: over.reactions || [
      { speaker: "A viewer", platform: "Reddit", quote: Q.fanLove },
      { speaker: "A viewer", platform: "X", quote: Q.fanHate },
    ],
    fanConsensus: "Audiences are genuinely divided.",
    ...(over.tweetIds !== undefined ? { tweetIds: over.tweetIds } : {}),
    eventSlug: "the-sable-coast-2026--in-audience-reaction",
    eventType: "discourse",
    dateModified: new Date(NOW - ageH * 36e5).toISOString(),
    ...(over.correction ? { correction: over.correction, robots: "noindex" } : {}),
    ...(over.retracted ? { retracted: true } : {}),
  };
  const md = matter.stringify("\n" + (over.body || "Body of the divided-audiences article.\n\nWith a second paragraph.") + "\n", fm);
  const fp = path.join(dir, fm.slug + ".md");
  fs.writeFileSync(fp, md);
  return fp;
}

// Build a store object (matching store.mjs shape) with one record for the article slug.
function storeWith(slug, { harvestQuoteKeys = [], angle = fakeAngle("audience-reaction"), trigger = fakeTrigger() } = {}) {
  const storeFile = path.join(tmp("inside-upd-store"), "store.json");
  const store = { published: [{ key: "the-sable-coast-2026|audience-reaction", slug, at: new Date(NOW).toISOString(), updatedCount: 0, harvestQuoteKeys, angle, trigger }], parked: [], file: storeFile };
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  fs.writeFileSync(storeFile, JSON.stringify({ published: store.published, parked: [] }, null, 1));
  return store;
}

const key90 = (q) => norm(q).slice(0, 90);

// ── 1) DEAD tweetId dropped from tweetIds AND reactions[].tweetId ──────────────────────────────────
await check("dead tweetId dropped from tweetIds and reactions[].tweetId; no undefined key", async () => {
  const dir = tmp("inside-upd");
  writeArticle(dir, {
    slug: "dead-embed",
    tweetIds: [TWEET_ID_A, TWEET_ID_B],
    reactions: [
      { speaker: "A viewer", platform: "X", quote: Q.fanLove, tweetId: TWEET_ID_A },  // alive
      { speaker: "A viewer", platform: "X", quote: Q.fanHate, tweetId: TWEET_ID_B },  // dead → strip tweetId
    ],
    parentSlug: undefined,
  });
  const store = storeWith("dead-embed", { harvestQuoteKeys: [key90(Q.fanLove), key90(Q.fanHate)] });
  const getTweetImpl = async (id) => (String(id) === TWEET_ID_A ? { text: "alive" } : null);
  const r = await monitorInside({ dir, storeImpl: store, getTweetImpl, harvestImpl: async () => ({ ok: false }), nowMs: NOW });
  assert.equal(r.results[0].action, "UPDATED");
  const { data } = matter.read(path.join(dir, "dead-embed.md"));
  assert.deepEqual(data.tweetIds, [TWEET_ID_A], "only alive id kept");
  const dead = data.reactions.find((x) => x.quote === Q.fanHate);
  assert.ok(!("tweetId" in dead), "dead reaction's tweetId key removed entirely");
  const alive = data.reactions.find((x) => x.quote === Q.fanLove);
  assert.equal(alive.tweetId, TWEET_ID_A, "alive reaction keeps its id");
});

// ── 2) TOP-UP appends >=2 new posts (deduped vs harvestQuoteKeys ∪ current), bumps counters ───────
await check("top-up appends >=2 new posts, dedups vs harvestQuoteKeys ∪ current, bumps counters", async () => {
  const dir = tmp("inside-upd2");
  writeArticle(dir, {
    slug: "topup",
    reactions: [{ speaker: "A viewer", platform: "Reddit", quote: Q.fanLove }],
    parentSlug: undefined,
  });
  // harvest returns: the already-known fanLove (dedup) + 3 genuinely new posts (named + audience).
  const harvestImpl = async () => ({
    ok: true,
    factBlock: {
      reactions: [{ speaker: "Priya Anand", connection: "director of The Sable Coast", platform: "interview", quote: Q.director, stance: "positive" }],
      aggregateFans: [
        { speaker: "", platform: "Reddit", quote: Q.fanLove, stance: "positive" }, // already have → dedup
        { speaker: "", platform: "X", quote: Q.fanHate, stance: "negative" },
        { speaker: "", platform: "Reddit", quote: Q.fanSplit, stance: "mixed" },
      ],
      tweetIds: [], sources: [], stats: {},
    },
  });
  const store = storeWith("topup", { harvestQuoteKeys: [key90(Q.fanLove)] });
  const before = matter.read(path.join(dir, "topup.md")).data.reactions.length;
  const r = await monitorInside({ dir, storeImpl: store, harvestImpl, getTweetImpl: async () => ({ text: "x" }), nowMs: NOW });
  assert.equal(r.results[0].action, "UPDATED");
  const { data } = matter.read(path.join(dir, "topup.md"));
  assert.equal(data.reactions.length, before + 3, "3 new posts appended (named + audience)");
  assert.ok(data.reactions.some((x) => x.speaker === "Priya Anand"), "named voice appended with name");
  assert.ok(data.reactions.every((x) => x.speaker), "audience appends default 'A viewer'");
  assert.equal(data.updatedCount, 1, "updatedCount bumped");
  assert.equal(data.dateModified, new Date(NOW).toISOString(), "dateModified bumped");
  const rec = store.published[0];
  assert.ok(rec.harvestQuoteKeys.includes(key90(Q.fanSplit)), "fingerprint extended with the new keys");
});

// ── 3) ONE straggler = UNCHANGED (a single new post isn't an update) ──────────────────────────────
await check("one straggler new post → UNCHANGED, file untouched", async () => {
  const dir = tmp("inside-upd3");
  writeArticle(dir, { slug: "one-new", reactions: [{ speaker: "A viewer", platform: "Reddit", quote: Q.fanLove }], parentSlug: undefined });
  const harvestImpl = async () => ({
    ok: true,
    factBlock: { reactions: [], aggregateFans: [{ speaker: "", quote: Q.fanLove }, { speaker: "", quote: Q.fanHate }], tweetIds: [], sources: [], stats: {} },
  });
  const store = storeWith("one-new", { harvestQuoteKeys: [key90(Q.fanLove)] }); // only fanHate is new → 1 straggler
  const before = fs.readFileSync(path.join(dir, "one-new.md"), "utf8");
  const r = await monitorInside({ dir, storeImpl: store, harvestImpl, getTweetImpl: async () => ({ text: "x" }), nowMs: NOW });
  assert.equal(r.results[0].action, "UNCHANGED");
  assert.equal(fs.readFileSync(path.join(dir, "one-new.md"), "utf8"), before, "file untouched");
});

// ── 4) PARENT-MISSING → noindex + one-shot Editor's note; second run UNCHANGED (no double banner) ──
await check("parent missing → noindex + one-shot Editor's note; second run UNCHANGED", async () => {
  const dir = tmp("inside-upd4");
  writeArticle(dir, { slug: "orphan-child", parentSlug: "the-parent-that-vanished" }); // parent file absent
  const store = storeWith("orphan-child");
  const r1 = await monitorInside({ dir, storeImpl: store, harvestImpl: async () => ({ ok: false }), getTweetImpl: async () => null, nowMs: NOW });
  assert.equal(r1.results[0].action, "PARENT-CASCADE");
  const { data, content } = matter.read(path.join(dir, "orphan-child.md"));
  assert.equal(data.robots, "noindex", "noindexed");
  assert.ok(data.correction, "correction banner set");
  assert.equal((content.match(/Editor's note/g) || []).length, 1, "exactly one banner");
  const r2 = await monitorInside({ dir, storeImpl: store, harvestImpl: async () => ({ ok: false }), getTweetImpl: async () => null, nowMs: NOW });
  assert.equal(r2.results[0].action, "UNCHANGED", "second run leaves it alone");
  assert.equal((matter.read(path.join(dir, "orphan-child.md")).content.match(/Editor's note/g) || []).length, 1, "no double banner");
});

// ── 5) OUT-OF-WINDOW (80h old) article is UNWATCHED ───────────────────────────────────────────────
await check("80h-old article is out of the monitor window (unwatched)", async () => {
  const dir = tmp("inside-upd5");
  writeArticle(dir, { slug: "too-old", ageH: 80, parentSlug: undefined });
  const store = storeWith("too-old");
  const r = await monitorInside({ dir, storeImpl: store, harvestImpl: async () => ({ ok: true, factBlock: { reactions: [], aggregateFans: [{ speaker: "", quote: Q.fanHate }, { speaker: "", quote: Q.fanSplit }, { speaker: "", quote: Q.fanBuzz }], tweetIds: [], sources: [], stats: {} } }), getTweetImpl: async () => null, nowMs: NOW });
  assert.equal(r.watched, 0, "not watched");
  assert.equal(r.results.length, 0);
});

// ── 6) DRY-RUN byte-identical ──────────────────────────────────────────────────────────────────────
await check("dry-run leaves the file byte-identical even when a top-up would apply", async () => {
  const dir = tmp("inside-upd6");
  writeArticle(dir, {
    slug: "dry", tweetIds: [TWEET_ID_A, TWEET_ID_B],
    reactions: [{ speaker: "A viewer", platform: "Reddit", quote: Q.fanLove, tweetId: TWEET_ID_A }],
    parentSlug: undefined,
  });
  const harvestImpl = async () => ({ ok: true, factBlock: { reactions: [], aggregateFans: [{ speaker: "", quote: Q.fanHate }, { speaker: "", quote: Q.fanSplit }, { speaker: "", quote: Q.fanBuzz }], tweetIds: [], sources: [], stats: {} } });
  const store = storeWith("dry", { harvestQuoteKeys: [key90(Q.fanLove)] });
  const before = fs.readFileSync(path.join(dir, "dry.md"), "utf8");
  const r = await monitorInside({ dir, storeImpl: store, harvestImpl, getTweetImpl: async () => null, dryRun: true, nowMs: NOW });
  assert.equal(r.results[0].action, "UPDATED", "reports update in dry-run");
  assert.equal(fs.readFileSync(path.join(dir, "dry.md"), "utf8"), before, "file byte-identical in dry-run");
});

// ── 7) PAUSED kill-switch (2026-07-10): DATA_DIR/PAUSED stops the pass before any work ────────────
await check("PAUSED file → {watched:0, results:[], paused:true}", async () => {
  const PAUSED_FILE = path.join(DATA_DIR, "PAUSED");
  assert.ok(!fs.existsSync(PAUSED_FILE), "pre-existing PAUSED — the lane is paused for real; refusing to test over it");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PAUSED_FILE, "test");
  try {
    const dir = tmp("inside-upd7");
    writeArticle(dir, { slug: "would-update", parentSlug: undefined });
    let harvested = false;
    const r = await monitorInside({ dir, storeImpl: storeWith("would-update"), harvestImpl: async () => { harvested = true; return { ok: false }; }, getTweetImpl: async () => null, nowMs: NOW });
    assert.equal(r.paused, true);
    assert.equal(r.watched, 0);
    assert.deepEqual(r.results, []);
    assert.equal(harvested, false, "no work attempted while paused");
  } finally { fs.unlinkSync(PAUSED_FILE); }
});

// ── 8) PER-PASS BUDGET (2026-07-10): cost budget reached → BUDGET-STOP + break ─────────────────────
await check("cost budget reached → BUDGET-STOP result, remaining articles left for the next pass", async () => {
  // 1M output tokens on gemini-2.5-flash = $2.50 > the $0.50 default cap (openrouter USAGE ledger).
  USAGE.push({ model: "google/gemini-2.5-flash", prompt_tokens: 0, completion_tokens: 1e6 });
  try {
    const dir = tmp("inside-upd8");
    writeArticle(dir, { slug: "budget-a", parentSlug: undefined });
    writeArticle(dir, { slug: "budget-b", parentSlug: undefined });
    let harvested = 0;
    const r = await monitorInside({ dir, storeImpl: storeWith("budget-a"), harvestImpl: async () => { harvested++; return { ok: false }; }, getTweetImpl: async () => null, nowMs: NOW });
    assert.equal(r.watched, 2, "articles were loaded");
    assert.equal(r.results.length, 1, "stopped on the first budget check");
    assert.equal(r.results[0].action, "BUDGET-STOP");
    assert.ok(/budget reached/.test(r.results[0].reason));
    assert.equal(harvested, 0, "no article was processed past the stop");
  } finally { USAGE.length = 0; } // never leak the fake spend into later tests
});

console.log(`\n=== UPDATER: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log("FAILED: " + fails.join(", ")); process.exit(1); }
