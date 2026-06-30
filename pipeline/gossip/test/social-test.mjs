// STEP 3 — SOCIAL DISCOVERY test. Mocked fetch for each source; verifies parsing, repost/reply skipping,
// Reddit graceful-403, and the merge (freshness + dedup + engagement sort). Run: node pipeline/gossip/test/social-test.mjs
import { discoverSocial } from "../discoverSocial.mjs";

let pass = 0, fail = 0;
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== STEP 3 SOCIAL DISCOVERY TEST ===\n");

const NOW = Date.parse("2026-06-30T12:00:00Z");
const fresh = "2026-06-30T11:00:00Z"; // 1h ago
const stale = "2026-06-25T12:00:00Z"; // 5 days ago

const mockFetch = async (url) => {
  if (url.includes("getAuthorFeed")) return { ok: true, json: async () => ({ feed: [
    { post: { record: { text: "🚨 Selena Gomez sparks engagement rumors after a cozy dinner with her rumored beau!", createdAt: fresh }, likeCount: 5000, repostCount: 200, uri: "at://did:plc:x/app.bsky.feed.post/abc123" } },
    { reason: { repost: true }, post: { record: { text: "a repost should be skipped", createdAt: fresh }, likeCount: 1, uri: "at://x/y/rp" } },
    { post: { record: { text: "This is an old stale post that must be filtered out by freshness", createdAt: stale }, likeCount: 9, uri: "at://x/y/old" } },
  ] }) };
  if (url.includes("twitterapi.io")) return { ok: true, json: async () => ({ tweets: [
    { text: "BREAKING: Taylor Swift announces a brand new world tour", url: "https://x.com/PopBase/status/1", likeCount: 9000, retweetCount: 1000, createdAt: fresh },
    { text: "@fan a reply should be skipped", isReply: true, createdAt: fresh },
  ] }) };
  if (url.includes("reddit.com")) return { ok: false, status: 403 }; // Reddit graceful until OAuth
  return { ok: false, status: 404 };
};

process.env.TWITTERAPI_KEY = "test-key"; // enable the X reader path (mock fetch is used, not the real API)
const cands = await discoverSocial({ fetchImpl: mockFetch, nowMs: NOW });

check("returns candidates from social", cands.length >= 2, `got ${cands.length}`);
const bsky = cands.find((c) => c.outlet.startsWith("Bluesky"));
const x = cands.find((c) => c.outlet.startsWith("X "));
check("Bluesky post parsed (Selena)", !!bsky && /Selena/.test(bsky.title) && bsky.url.includes("bsky.app/profile"), JSON.stringify(bsky)?.slice(0, 90));
check("Bluesky engagement = likes + reposts", bsky?.engagement === 5200);
check("Bluesky ageMin computed (~60)", bsky?.ageMin === 60);
check("X tweet parsed (Taylor)", !!x && /Taylor/.test(x.title) && x.engagement === 10000);
check("reposts are skipped", !cands.some((c) => /repost should be skipped/.test(c.title)));
check("replies are skipped", !cands.some((c) => /reply should be skipped/.test(c.title)));
check("stale posts are filtered by freshness", !cands.some((c) => /old stale post/.test(c.title)));
check("Reddit 403 handled gracefully (no crash, no reddit candidates)", !cands.some((c) => c.outlet.startsWith("Reddit")));
check("sorted by engagement (X 10000 before Bluesky 5200)", cands[0].outlet.startsWith("X "));

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) process.exit(1);
console.log("Step 3 social discovery green. ✅\n");
