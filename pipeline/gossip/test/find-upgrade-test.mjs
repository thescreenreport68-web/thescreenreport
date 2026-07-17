// PHASE 1 — FIND upgrade: thin filter, demand ranker, trending search, heat radar, field plumbing,
// cheap-first corroboration, re-queue-don't-drop. Offline. Run: node pipeline/gossip/test/find-upgrade-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gossipFind, isJunkCandidate, scoreTopic, enqueue, dequeue, loadQueue, saveQueue, QUEUE_PATH } from "../find.mjs";
import { trendingSearch } from "../discover.mjs";
import { entityHeat } from "../heatRadar.mjs";
import { categorizeGossip } from "../categorize.mjs";
import { gatherBundle, corroborateBundle } from "../contentFinder.mjs";
import { gossipRun } from "../gossiprun.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
process.env.GOSSIP_STATS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-stats-")); // keep test stats out of data/gossip

console.log("\n=== PHASE 1: FIND UPGRADE ===\n");

// ── 1) thin filter ──
{
  const junk = [
    { title: "Your Daily Horoscope for July 17" },
    { title: "Happy Birthday to the star!" },
    { title: "Shop these celebrity-loved deals — 40% off" },
    { title: "In Photos: the best red carpet arrivals gallery" },
    { title: "Wordle hints today" },
  ];
  const real = [
    { title: "Star A spotted with Star B" },
    { title: "Star C new album tease" }, // short but real — must survive
    { title: "Taylor and Travis seen leaving a Manhattan restaurant", summary: "The couple…" },
  ];
  check("junk classes filtered", junk.every(isJunkCandidate), JSON.stringify(junk.filter((c) => !isJunkCandidate(c))));
  check("real stories kept (incl. short titles)", real.every((c) => !isJunkCandidate(c)), JSON.stringify(real.filter(isJunkCandidate)));
}
// ── 2) ranker bands ──
{
  const now = Date.now();
  const rssTier6 = { title: "Star spotted at dinner", sources: [{ tier: 6 }], ageMin: 60, queuedAt: null };
  const socialLow = { title: "some minor post", sources: [{ tier: 2 }], engagement: 3, ageMin: 60, queuedAt: null };
  const socialViral = { title: "Star X and Star Y split", sources: [{ tier: 2 }], engagement: 20000, ageMin: 30, queuedAt: null };
  const stale = { title: "old thing", sources: [{ tier: 6 }], queuedAt: new Date(now - 60 * 3600e3).toISOString() };
  const hotHeat = { title: "Star Z engaged", claim: "engagement", sources: [{ tier: 6 }], heat: 6.2, ageMin: 45, queuedAt: null };
  check("RSS tier-6 not starved by a 3-like social post", scoreTopic(rssTier6, now) > scoreTopic(socialLow, now));
  check("viral social outranks plain RSS", scoreTopic(socialViral, now) > scoreTopic(rssTier6, now));
  check("heat-window entity gets a big boost", scoreTopic(hotHeat, now) > scoreTopic(rssTier6, now) + 20);
  check("stale queue entries sink", scoreTopic(stale, now) < scoreTopic(rssTier6, now));
}
// ── 3) trending search: parse + outlet + title strip + decode ──
{
  const xml = `<rss><channel>
    <item><title>Star A files for divorce - Page Six</title><link>https://news.google.com/rss/articles/ABC</link><source url="https://pagesix.com">Page Six</source><pubDate>${new Date().toUTCString()}</pubDate></item>
    <item><title>Old story - TMZ</title><link>https://news.google.com/rss/articles/OLD</link><source>TMZ</source><pubDate>${new Date(Date.now() - 3 * 24 * 3600e3).toUTCString()}</pubDate></item>
  </channel></rss>`;
  const items = await trendingSearch({ fetchImpl: async () => xml, decodeImpl: async () => "https://pagesix.com/real-article/" });
  check("trending: fresh item parsed, outlet from <source>, 48h stale dropped", items.length === 1 && items[0].outlet === "Page Six");
  check("trending: outlet suffix stripped from title", items[0].title === "Star A files for divorce");
  check("trending: gnews link decoded to publisher URL", items[0].url === "https://pagesix.com/real-article/" && items[0].viaTrending === true);
}
// ── 4) heat radar math ──
{
  const mk = (views) => ({ ok: true, json: async () => ({ items: views.map((v) => ({ views: v })) }) });
  const h = await entityHeat("Taylor Swift", { fetchImpl: async () => mk([100, 100, 100, 100, 100, 100, 100, 500]) });
  check("heat = latest ÷ trailing avg (5x spike → 5)", h === 5);
  const flat = await entityHeat("Someone", { fetchImpl: async () => mk([100, 100, 100, 100]) });
  check("flat pageviews ≈ 1", flat === 1);
  check("no article (404) → null", (await entityHeat("Nobody Xyz", { fetchImpl: async () => ({ ok: false }) })) === null);
}
// ── 5) categorize plumbs demand fields ──
{
  const cands = [{ outlet: "Bluesky @popbase", tier: 2, title: "Star A and Star B spotted kissing", engagement: 4321, ageMin: 33, viaTrending: false }];
  const classifyImpl = async (batch) => batch.map((c, i) => ({ i, inScope: true, primaryEntity: "Star A", subjectType: "actor", claim: "kissing" }));
  const topics = await categorizeGossip(cands, { classifyImpl });
  check("engagement/ageMin survive the seam", topics[0].engagement === 4321 && topics[0].ageMin === 33);
}
// ── 6) cheap-first: gather(primary-only) never calls the corroboration finder; corroborateBundle folds in later ──
{
  let findCalled = 0;
  const topic = { primaryEntity: "Star A", claim: "a thing", sources: [{ outlet: "Page Six", text: "Star A did a thing today at the venue, per multiple attendees. The scene was lively and the crowd reacted loudly." }] };
  const bundle = await gatherBundle(topic, { corroborate: false, findUrlsImpl: async () => { findCalled++; return []; } });
  check("corroborate:false → finder never called (cheap-first)", bundle.ok && findCalled === 0);
  await corroborateBundle(topic, bundle, {
    findUrlsImpl: async () => { findCalled++; return [{ outlet: "People", domain: "people.com", url: "https://people.com/x" }]; },
    // extractClean's extractImpl contract = article-extractor shape: { content: <html>, title }
    extractImpl: async () => ({ content: "<p>" + ("Star A did a thing today. ".repeat(30)) + "</p>", title: "x" }),
  });
  check("corroborateBundle folds in the extra outlet + counts", bundle.sources.length === 2 && bundle.corroborationCount === 2 && bundle.coveringOutletCount >= 2);
  check("corroborating source contributes NO quotes", bundle.sources[1].corroborating === true && bundle.quotes.every((q) => !q.includes("nope")));
}
// ── 7) re-queue-don't-drop (frame-HOLD → waitingForMajor; once only) ──
{
  // snapshot + restore the real queue file (gossiprun's re-queue writes to the default path)
  const snapshot = fs.existsSync(QUEUE_PATH) ? fs.readFileSync(QUEUE_PATH, "utf8") : null;
  try {
    saveQueue([], QUEUE_PATH);
    const topic = { id: "extreme-1", primaryEntity: "Star E", title: "serious allegation", subjectType: "actor" };
    const mkRun = (t) => gossipRun({
      fromFind: true,
      dequeueImpl: (() => { let done = false; return () => (done ? [] : (done = true, [t])); })(),
      runImpl: async () => ({ status: "HELD", stage: "frame", reason: "EXTREME w/o established outlet" }),
      dedup: false, limit: 1,
    });
    const r1 = await mkRun(topic);
    const q1 = loadQueue(QUEUE_PATH).topics;
    check("frame-HOLD re-queues once with waitingForMajor", q1.length === 1 && q1[0].waitingForMajor === true && q1[0].requeueCount === 1 && r1.held[0].requeued === true);
    const r2 = await mkRun(q1[0]);
    check("second frame-HOLD drops for real (no infinite retry)", loadQueue(QUEUE_PATH).topics.filter((t) => t.id === "extreme-1").length === 1 && !r2.held[0].requeued);
  } finally {
    if (snapshot != null) fs.writeFileSync(QUEUE_PATH, snapshot); else { try { fs.unlinkSync(QUEUE_PATH); } catch {} }
  }
}
// ── 8) gossipFind: junk never reaches categorize ──
{
  const seen = [];
  const discoverImpl = async () => [
    { outlet: "Page Six", title: "Star A spotted with Star B at the premiere" },
    { outlet: "Us Weekly", title: "Your Daily Horoscope for July 17" },
  ];
  await gossipFind({ discoverImpl, categorizeImpl: async (c) => { seen.push(...c); return []; } });
  check("junk filtered before the classify spend", seen.length === 1 && /premiere/.test(seen[0].title));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("FIND upgrade green. ✅\n");
