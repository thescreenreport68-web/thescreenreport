// STEP 4 — MULTI-SOURCE CORROBORATION test. Mocks GDELT (the artlist endpoint) + the article extractor so it
// runs with no network/LLM. Verifies: distinct-domain dedup, seed-domain exclusion, the fail-safe paths, the
// min-length drop, the max cap, and that gatherBundle folds corroborating sources into a richer bundle.
// Run: node pipeline/gossip/test/corroborate-test.mjs
import { findCorroboratingUrls, registrableDomain } from "../corroborate.mjs";
import { gatherBundle } from "../contentFinder.mjs";

let pass = 0, fail = 0;
const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== STEP 4 CORROBORATION TEST ===\n");

// A GDELT artlist payload with TWO articles from the same domain (people.com) + three other outlets. The
// distinct-domain rule must collapse the two people.com hits to one and exclude the seed (variety.com).
const GDELT = { articles: [
  { url: "https://variety.com/2026/seed", domain: "variety.com", title: "Variety (the seed — must be excluded)" },
  { url: "https://people.com/a", domain: "people.com", title: "People first" },
  { url: "https://people.com/b", domain: "people.com", title: "People SECOND (same domain — must be dropped)" },
  { url: "https://www.eonline.com/x", domain: "www.eonline.com", title: "E! Online" },
  { url: "https://pagesix.com/y", domain: "pagesix.com", title: "Page Six" },
  { url: "https://justjared.com/z", domain: "justjared.com", title: "Just Jared" },
] };
const okJson = (obj) => ({ ok: true, text: async () => JSON.stringify(obj) });

const TOPIC = { primaryEntity: "Selena Gomez", title: "spotted on a cozy dinner date", sources: [{ outlet: "Variety", url: "https://variety.com/2026/seed" }] };

// ── findCorroboratingUrls ──
{
  const gdeltFetch = async (url) => (url.includes("gdeltproject.org") ? okJson(GDELT) : { ok: false });
  const out = await findCorroboratingUrls(TOPIC, { fetchImpl: gdeltFetch, seedDomain: "variety.com" });
  check("one URL per DISTINCT domain (people.com collapses to 1)", out.filter((o) => o.domain === "people.com").length === 1, JSON.stringify(out).slice(0, 140));
  check("seed domain (variety.com) excluded", !out.some((o) => o.domain === "variety.com"));
  check("max cap respected (default 4)", out.length === 4, `got ${out.length}`);
  check("each result carries url+domain+title", out.every((o) => o.url && o.domain && typeof o.title === "string"));
}

// fail-safe: GDELT returns plain text (a bad query) → []
{
  const badText = async () => ({ ok: true, text: async () => "no results for your query" });
  const out = await findCorroboratingUrls(TOPIC, { fetchImpl: badText, seedDomain: "variety.com" });
  check("non-JSON GDELT body → [] (fail-safe)", Array.isArray(out) && out.length === 0);
}

// fail-safe: GDELT !ok (rate-limited) → []
{
  const down = async () => ({ ok: false, status: 429 });
  const out = await findCorroboratingUrls(TOPIC, { fetchImpl: down });
  check("GDELT 429 → [] (fail-safe)", out.length === 0);
}

// fail-safe: no usable entity → no query → []
{
  const out = await findCorroboratingUrls({ primaryEntity: "", title: "x" }, { fetchImpl: async () => okJson(GDELT) });
  check("empty entity → [] (no query)", out.length === 0);
}

check("registrableDomain strips proto/www/path", registrableDomain("https://www.eonline.com/news/123") === "eonline.com");

// ── gatherBundle with corroboration ──
// A corroborating article about this rumor NAMES the entity — the entity-mention gate (contentFinder) drops any
// "corroborating" source that doesn't, so the fixtures must read like real articles about Selena Gomez.
const LONG = "Selena Gomez and her companion were seen leaving a Los Angeles restaurant together over the weekend, and a source described the evening as relaxed and full of laughter. ".repeat(6);
const extractByDomain = async (url) => ({ content: `<p>${LONG} [${registrableDomain(url)}]</p>`, title: "x" });

// corroborate:true → original (variety, inline) + corroborating outlets from DISTINCT domains, flagged + counted
{
  let urlsCalls = 0;
  const findUrlsImpl = async () => { urlsCalls++; return [
    { url: "https://people.com/a", domain: "people.com", title: "People" },
    { url: "https://variety.com/dupe", domain: "variety.com", title: "Variety dupe (== seed → skip)" },
    { url: "https://pagesix.com/y", domain: "pagesix.com", title: "Page Six" },
  ]; };
  const b = await gatherBundle(
    { primaryEntity: "Selena Gomez", title: "dinner date", sources: [{ outlet: "Variety", url: "https://variety.com/2026/seed" }] },
    { corroborate: true, findUrlsImpl, extractImpl: extractByDomain }
  );
  check("corroboration calls the URL finder once", urlsCalls === 1);
  check("seed-domain corroborating hit (variety dupe) is skipped", b.sources.filter((s) => registrableDomain(s.url) === "variety.com").length === 1);
  check("corroborating sources are flagged", b.sources.some((s) => s.corroborating === true));
  check("bundle now spans 3 distinct outlets (variety+people+pagesix)", b.corroborationCount === 3, `got ${b.corroborationCount}`);
  check("outletCount reflects the richer bundle", b.outletCount === 3, `got ${b.outletCount}`);
}

// SECURITY: a corroborating source that does NOT name the entity is DROPPED (no off-topic GDELT bleed)
{
  const findUrlsImpl = async () => [{ url: "https://people.com/a", domain: "people.com", title: "x" }];
  const offTopic = async () => ({ content: "<p>An unrelated story about a completely different celebrity at a film premiere, repeated to clear the length floor. ".repeat(6) + "</p>", title: "x" });
  const b = await gatherBundle(
    { primaryEntity: "Selena Gomez", title: "dinner date", sources: [{ outlet: "Variety", url: "https://variety.com/2026/seed", text: LONG }] },
    { corroborate: true, findUrlsImpl, extractImpl: offTopic }
  );
  check("a corroborating source NOT naming the entity is dropped", b.corroborationCount === 1, `got ${b.corroborationCount}`);
}

// SECURITY: corroborating sources contribute NO quotes to the writer's quotable corpus (no misattribution)
{
  const findUrlsImpl = async () => [{ url: "https://people.com/a", domain: "people.com", title: "x" }];
  const withQuote = async (url) => url.includes("people.com")
    ? { content: `<p>Selena Gomez was photographed in Paris last spring. A source said, "they secretly married months ago" in a totally different story. ${"Filler about Selena Gomez to clear the floor. ".repeat(8)}</p>`, title: "x" }
    : { content: `<p>${LONG}</p>`, title: "x" };
  const b = await gatherBundle(
    { primaryEntity: "Selena Gomez", title: "dinner date", sources: [{ outlet: "Variety", url: "https://variety.com/2026/seed", text: LONG }] },
    { corroborate: true, findUrlsImpl, extractImpl: withQuote }
  );
  check("corroborating source admitted (names the entity)", b.sources.some((s) => s.corroborating));
  check("its verbatim quote is NOT offered to the writer (kept out of bundle.quotes)", !b.quotes.some((q) => /secretly married/.test(q)), JSON.stringify(b.quotes).slice(0, 120));
}

// corroborate:false → finder is NOT called, bundle stays single-source
{
  let called = false;
  const findUrlsImpl = async () => { called = true; return [{ url: "https://people.com/a", domain: "people.com", title: "x" }]; };
  const b = await gatherBundle(
    { primaryEntity: "Selena Gomez", title: "dinner date", sources: [{ outlet: "Variety", url: "https://variety.com/2026/seed" }] },
    { corroborate: false, findUrlsImpl, extractImpl: extractByDomain }
  );
  check("corroborate:false never calls the finder", called === false);
  check("corroborate:false stays single-outlet", b.corroborationCount === 1 && !b.sources.some((s) => s.corroborating));
}

// fail-safe: the URL finder throws → swallowed, fall back to just the original source (never blows up the run)
{
  const findUrlsImpl = async () => { throw new Error("GDELT exploded"); };
  let threw = false, b;
  try {
    b = await gatherBundle(
      { primaryEntity: "Selena Gomez", title: "dinner date", sources: [{ outlet: "Variety", url: "https://variety.com/2026/seed" }] },
      { corroborate: true, findUrlsImpl, extractImpl: extractByDomain }
    );
  } catch { threw = true; }
  check("a throwing URL finder is swallowed (corroboration is enrichment-only)", threw === false && b?.ok === true);
  check("after a finder fault, bundle falls back to the single original source", b?.corroborationCount === 1);
}

// thin corroborating article (<400 chars) is dropped. Note: when the extractor returns too-little, extractClean
// falls through to Jina/crude HTTP fallbacks — give them a non-OK fetch so the test never touches the network.
{
  const findUrlsImpl = async () => [{ url: "https://people.com/a", domain: "people.com", title: "x" }];
  const shortExtract = async (url) => (url.includes("people.com") ? { content: "<p>too short</p>", title: "x" } : { content: `<p>${LONG}</p>`, title: "x" });
  const noNetFetch = async () => ({ ok: false, status: 599 });
  const b = await gatherBundle(
    { primaryEntity: "Selena Gomez", title: "dinner date", sources: [{ outlet: "Variety", url: "https://variety.com/2026/seed" }] },
    { corroborate: true, findUrlsImpl, extractImpl: shortExtract, fetchImpl: noNetFetch }
  );
  check("thin (<400 char) corroborating source is dropped", b.corroborationCount === 1, `got ${b.corroborationCount}`);
}

// maxCorroborating cap
{
  const findUrlsImpl = async () => [
    { url: "https://people.com/a", domain: "people.com", title: "x" },
    { url: "https://pagesix.com/y", domain: "pagesix.com", title: "x" },
    { url: "https://eonline.com/z", domain: "eonline.com", title: "x" },
    { url: "https://justjared.com/w", domain: "justjared.com", title: "x" },
  ];
  const b = await gatherBundle(
    { primaryEntity: "Selena Gomez", title: "dinner date", sources: [{ outlet: "Variety", url: "https://variety.com/2026/seed" }] },
    { corroborate: true, findUrlsImpl, extractImpl: extractByDomain, maxCorroborating: 2 }
  );
  check("maxCorroborating caps the corroborating sources (1 seed + 2)", b.corroborationCount === 3, `got ${b.corroborationCount}`);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Step 4 corroboration green. ✅\n");
