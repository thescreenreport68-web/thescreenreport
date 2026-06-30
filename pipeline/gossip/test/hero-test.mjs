// STEP 6 — HERO IMAGE PICKER. Offline: TMDB image-getters + the vision gate are injected. Proves the priority
// (receipt embed / cinematic still / vision-ranked), the fail-safes, the credit-line, and the NEUTRAL caption
// (an image caption must never restate an unconfirmed claim as fact). Run: node pipeline/gossip/test/hero-test.mjs
import { pickHero, detectEmbed, collectUrls } from "../heroImage.mjs";

let pass = 0, fail = 0;
const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== STEP 6 HERO IMAGE PICKER ===\n");

const personSet = { id: 1, name: "Selena Gomez", profiles: [{ url: "https://image.tmdb.org/t/p/h632/prof1.jpg", w: 632, h: 948, vote: 8 }], backdrop: { url: "https://image.tmdb.org/t/p/w1280/pback.jpg", title: "Only Murders in the Building" } };
const titleSet = { id: 2, type: "tv", title: "Only Murders in the Building", backdrops: ["https://image.tmdb.org/t/p/w1280/tb1.jpg", "https://image.tmdb.org/t/p/w1280/tb2.jpg"], poster: "https://image.tmdb.org/t/p/w780/poster.jpg" };
const getPersonImagesImpl = async () => personSet;
const getTitleImagesImpl = async () => titleSet;

// ── collectUrls + detectEmbed (pure) ──
{
  const urls = collectUrls({ url: "https://a.com/1", sources: [{ url: "https://a.com/1" }, { url: "https://youtu.be/abcdefghijk" }] }, { sources: [{ url: "https://x.com/PopBase/status/1789" }] });
  check("collectUrls dedups + gathers topic+bundle urls", urls.length === 3 && urls.includes("https://youtu.be/abcdefghijk"));
  check("detectEmbed → YouTube id", detectEmbed(["https://youtu.be/abcdefghijk"]).videoId === "abcdefghijk");
  check("detectEmbed → X status", detectEmbed(["https://x.com/PopBase/status/1789"]).tweetId === "1789");
  check("detectEmbed → Bluesky post", detectEmbed(["https://bsky.app/profile/popcrave.com/post/abc123"]).platform === "bluesky");
  check("detectEmbed → Instagram is DEFERRED (needs Meta setup)", detectEmbed(["https://instagram.com/p/Cxyz_123/"]).deferred === true);
  check("detectEmbed priority: YouTube beats X when both present", detectEmbed(["https://x.com/a/status/1", "https://youtu.be/abcdefghijk"]).platform === "youtube");
  check("detectEmbed → none", detectEmbed(["https://variety.com/article"]) === null);
}

const TOPIC = { primaryEntity: "Selena Gomez", title: 'Selena Gomez spotted on the "Only Murders in the Building" set', gossipType: "spotted", sources: [] };

// ── vision-ranked still among ≥2 candidates ──
{
  let visionCalls = 0;
  const visionImpl = async (imgs) => { visionCalls++; return { ranked: [
    { index: 1, identityMatch: true, impact: 9, fit: 9, why: "striking on-set still" },
    { index: 0, identityMatch: true, impact: 6, fit: 6 },
  ] }; };
  const h = await pickHero({ topic: TOPIC, article: { title: TOPIC.title } }, { getPersonImagesImpl, getTitleImagesImpl, visionImpl });
  check("vision gate fired (≥2 candidates)", visionCalls === 1);
  check("hero picks the vision-ranked still (index 1 = tb2)", h.kind === "image" && h.src === "https://image.tmdb.org/t/p/w1280/tb2.jpg", h.src);
  check("credit line is TMDB", h.credit === "Image: The Movie Database (TMDB)");
  check("caption is NEUTRAL (no claim restated as fact)", /^Pictured: Selena Gomez/.test(h.caption) && !/spotted|dating|split/i.test(h.caption), h.caption);
  check("alt text describes the subject", /Selena Gomez/.test(h.alt));
  check("vision score + reason carried through", h.score >= 100 && /striking/.test(h.why));
}

// ── vision fail-safe: a throwing vision impl → deterministic top candidate ──
{
  const visionImpl = async () => { throw new Error("vision down"); };
  const h = await pickHero({ topic: TOPIC, article: { title: TOPIC.title } }, { getPersonImagesImpl, getTitleImagesImpl, visionImpl });
  check("vision error → deterministic top still (title backdrop tb1)", h.kind === "image" && h.src === "https://image.tmdb.org/t/p/w1280/tb1.jpg", h.src);
}

// ── single candidate → vision NOT called ──
{
  let visionCalls = 0;
  const visionImpl = async () => { visionCalls++; return { ranked: [] }; };
  const onlyOne = async () => ({ id: 1, name: "X", profiles: [{ url: "https://image.tmdb.org/t/p/h632/only.jpg", w: 632, h: 948, vote: 7 }], backdrop: null });
  const h = await pickHero({ topic: { primaryEntity: "X", title: "X news", gossipType: "general" }, article: { title: "X news" } }, { getPersonImagesImpl: onlyOne, getTitleImagesImpl: async () => null, visionImpl });
  check("single candidate → vision skipped (credit saved)", visionCalls === 0);
  check("single candidate → that image is the hero", h.src === "https://image.tmdb.org/t/p/h632/only.jpg");
}

// ── YouTube receipt: thumbnail becomes a still candidate + the embed is attached ──
{
  const topic = { primaryEntity: "Selena Gomez", title: "Selena Gomez interview clip goes viral", gossipType: "cryptic", sources: [{ url: "https://youtu.be/abcdefghijk" }] };
  const visionImpl = async (imgs) => ({ ranked: [{ index: 0, identityMatch: true, impact: 9, fit: 9, why: "the actual clip" }] });
  const h = await pickHero({ topic, article: { title: topic.title } }, { getPersonImagesImpl, getTitleImagesImpl: async () => null, visionImpl });
  check("YouTube thumb is a candidate (picked at index 0)", h.src === "https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg", h.src);
  check("source flagged youtube for a video thumb", h.source === "youtube" && h.credit === "Still via YouTube");
  check("the originating embed is attached to the hero", h.embed?.platform === "youtube" && h.embed?.embedUrl.includes("/embed/abcdefghijk"));
}

// ── Instagram receipt is DEFERRED (slot only, not embedded until Meta setup) ──
{
  const topic = { primaryEntity: "Selena Gomez", title: "Selena Gomez post sparks buzz", gossipType: "cryptic", sources: [{ url: "https://instagram.com/p/Cxyz_123/" }] };
  const h = await pickHero({ topic, article: { title: topic.title } }, { getPersonImagesImpl, getTitleImagesImpl: async () => null, visionImpl: async () => ({ ranked: [{ index: 0, identityMatch: true, impact: 7, fit: 7 }] }) });
  check("Instagram embed is held in embedDeferred (not rendered yet)", h.embedDeferred?.platform === "instagram" && h.embed === null);
}

// ── no stills resolve, but a YouTube receipt exists → lead with the embed ──
{
  const topic = { primaryEntity: "Nobody Resolvable", title: "viral clip", gossipType: "general", sources: [{ url: "https://youtu.be/abcdefghijk" }] };
  const h = await pickHero({ topic, article: { title: topic.title } }, { getPersonImagesImpl: async () => null, getTitleImagesImpl: async () => null, visionImpl: async () => ({ ranked: [{ index: 0, identityMatch: true, impact: 8, fit: 8 }] }) });
  // (the youtube thumb is still a candidate, so this resolves to an image hero via that thumb)
  check("with a YouTube receipt, a hero is always produced (its thumb)", h && (h.kind === "image" || h.kind === "embed"));
}

// ── nothing resolves → null (UI must handle a heroless article) ──
{
  const h = await pickHero({ topic: { primaryEntity: "Ghost", title: "x", gossipType: "general", sources: [] }, article: { title: "x" } }, { getPersonImagesImpl: async () => null, getTitleImagesImpl: async () => null, visionImpl: async () => ({ ranked: [] }) });
  check("no candidates + no embed → null (graceful)", h === null);
}

// ── vision disabled → deterministic, no vision call ──
{
  let visionCalls = 0;
  const visionImpl = async () => { visionCalls++; return { ranked: [{ index: 2, identityMatch: true, impact: 9, fit: 9 }] }; };
  const h = await pickHero({ topic: TOPIC, article: { title: TOPIC.title } }, { getPersonImagesImpl, getTitleImagesImpl, visionImpl, vision: false });
  check("vision:false → no vision call, deterministic top", visionCalls === 0 && h.src === "https://image.tmdb.org/t/p/w1280/tb1.jpg");
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Step 6 hero image picker green. ✅\n");
