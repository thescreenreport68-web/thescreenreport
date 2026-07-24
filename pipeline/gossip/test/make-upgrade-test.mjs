// PHASE 2 — MAKE upgrade: anchor cards, token substitution, synthesizer brief (fail-open), word range from
// bundle depth, prompt consistency, headline agent with grounded gates. Offline.
//   node pipeline/gossip/test/make-upgrade-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAnchors, substituteAnchors, synthesize, buildBriefPrompt } from "../synthesizer.mjs";
import { refineHeadline, numbersGrounded, namesGrounded } from "../headline.mjs";
import { buildGossipPrompt, wordRangeFor } from "../writer.mjs";
import { runGossip } from "../run.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
process.env.GOSSIP_STATS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-stats-"));

console.log("\n=== PHASE 2: MAKE UPGRADE ===\n");

const BUNDLE = {
  entity: "Star A",
  sources: [
    { outlet: "Page Six", tier: 6, text: "Star A said the wedding was magical. ".repeat(60), quotes: ["It was the best day of my life", "We wanted it private"] },
    { outlet: "People", tier: 6, text: "corroborating text ".repeat(40), quotes: ["never-usable"], corroborating: true },
  ],
  quotes: ["It was the best day of my life", "We wanted it private"],
  ok: true,
};

// ── 1) anchor cards ──
{
  const a = buildAnchors(BUNDLE);
  check("anchors built from SEED quotes only (corroborators excluded)", a.length === 2 && a[0].id === "Q1" && a[0].outlet === "Page Six" && !a.some((x) => x.text === "never-usable"), JSON.stringify(a));
}
// ── 2) token substitution ──
{
  const anchors = buildAnchors(BUNDLE);
  const art = { body: 'She was thrilled: ⟦Q1⟧. Later she added "⟦Q2⟧" and a stray [Q1] plus a bogus ⟦Q9⟧ token.', pullQuote: "⟦Q1⟧", dek: "d" };
  substituteAnchors(art, anchors);
  check("bare token → quoted text injected", art.body.includes('"It was the best day of my life"'));
  check("writer-quoted token NOT double-quoted", art.body.includes('"We wanted it private"') && !art.body.includes('""We wanted it private""'));
  check("bracket variant [Q1] replaced too", (art.body.match(/It was the best day of my life/g) || []).length === 2);
  check("unknown token ⟦Q9⟧ stripped", !art.body.includes("Q9"));
  check("pullQuote substituted", art.pullQuote === '"It was the best day of my life"');
}
// ── 3) word range from bundle depth ──
{
  // 2026-07-25: the target now scales on a DEPTH score (chars + facts + quotes + background), because
  // 800-word articles are reached by enriching the bundle, not by demanding more words.
  const thin = wordRangeFor({ sources: [{ text: "short text" }] });
  const rich = wordRangeFor({ ...BUNDLE, sources: [{ text: "x".repeat(9000) }],
    details: { facts: Array(25).fill("f"), timeline: [], quotes: [] },
    background: { timeline: Array(8).fill("t"), priorStatements: [] } });
  check("thin bundle → short target; rich → fuller", thin.hi <= 400 && rich.lo >= 800 && rich.hi <= 1000, JSON.stringify({ thin, rich }));
}
// ── 4) prompt consistency + sections ──
{
  const anchors = buildAnchors(BUNDLE);
  const brief = { hook: "the hook", mood: "playful", beats: ["b1", "b2"], useAnchors: ["Q1"], mustInclude: ["July 3"], angle: "the angle" };
  const { user } = buildGossipPrompt(BUNDLE, { writerDirective: "d", uiLabel: "Reported" }, { primaryEntity: "Star A", title: "t" }, null, "scene", brief, anchors);
  const ranges = user.match(/\d{3}–\d{3} words/g) || [];
  check("ONE word range, used consistently in BOTH places (contradiction fixed)", ranges.length === 2 && ranges[0] === ranges[1], JSON.stringify(ranges));
  check("no stale 450–600 contract anywhere", !user.includes("450–600"));
  check("anchor token instruction present", user.includes("⟦Q1⟧") || user.includes("TOKEN"));
  check("brief section present (hook + beats + must-include)", user.includes("the hook") && user.includes("b1") && user.includes("July 3"));
  check("GEO craft rules present (number + outlet-in-text + time-anchor)", /concrete NUMBER/.test(user) && /told PEOPLE/.test(user) && /TIME-ANCHOR/.test(user));
}
// ── 5) synthesizer: valid brief + clamped ids + fail-open ──
{
  const anchors = buildAnchors(BUNDLE);
  const good = await synthesize({ bundle: BUNDLE, frame: { uiLabel: "Reported" }, topic: { primaryEntity: "Star A" }, anchors, chatImpl: async () => ({ data: { hook: "h", mood: "playful", beats: ["a", "b", "c", "d"], useAnchors: ["Q1", "Q7"], mustInclude: ["x"], angle: "y", seoKeyword: "z" }, usage: {} }) });
  check("synthesizer returns the brief; bogus anchor ids clamped", good && good.useAnchors.length === 1 && good.useAnchors[0] === "Q1");
  const bad = await synthesize({ bundle: BUNDLE, frame: {}, topic: {}, anchors, chatImpl: async () => { throw new Error("down"); } });
  check("synthesizer fail-open → null brief (old path)", bad === null);
}
// ── 6) headline agent gates ──
{
  const topic = { primaryEntity: "Star A" };
  const mkArticle = () => ({
    title: "Star A and Star B Say 'I Do' at a Private Malibu Wedding",
    dek: "The couple kept the guest list tiny and the location secret until the last minute.",
    metaTitle: "Star A and Star B Say 'I Do' at a Private Malibu",
    metaDescription: "The couple kept the guest list tiny and the location secret until the last minute. The ceremony took place at a private Malibu estate on July 3.",
    body: "Star A married Star B on July 3 at a private Malibu estate with 40 guests. " + "More verified detail here. ".repeat(20),
  });
  // (a) a good grounded candidate wins
  {
    const art = mkArticle();
    const cand = { metaTitle: "Star A Marries Star B at Private Malibu Wedding", metaDescription: "Star A married Star B at a private Malibu estate on July 3, with just 40 guests in on the secret — here is everything we know about the ceremony.", dek: "Only 40 guests were in on the secret — and the location stayed hidden until vows." };
    const r = await refineHeadline({ article: art, bundle: BUNDLE, topic, chatImpl: async ({ system }) => system.includes("CTR judge") ? { data: { best: 0, scores: [90] }, usage: {} } : { data: { candidates: [cand] }, usage: {} } });
    check("good grounded candidates adopted", r.changed.includes("metaTitle") && r.changed.includes("metaDescription") && art.metaTitle === cand.metaTitle, JSON.stringify(r));
  }
  // (b) an invented NUMBER is rejected → original kept
  {
    const art = mkArticle(); const orig = art.metaDescription;
    const cand = { metaTitle: "Star A Marries Star B at Private Malibu Wedding", metaDescription: "Star A married Star B in front of 300 guests at a private Malibu estate on July 3 — inside the ceremony everyone is talking about this week.", dek: "" };
    const r = await refineHeadline({ article: art, bundle: BUNDLE, topic, chatImpl: async ({ system }) => system.includes("CTR judge") ? { data: { best: 0 }, usage: {} } : { data: { candidates: [cand] }, usage: {} } });
    check("invented number (300 guests) rejected — original metaDescription kept", art.metaDescription === orig && !r.changed.includes("metaDescription"));
  }
  // (c) an invented NAME is rejected
  {
    const art = mkArticle(); const orig = art.metaTitle;
    const cand = { metaTitle: "Star A Weds Star B as Taylor Swift Looks On Live", metaDescription: "", dek: "" };
    await refineHeadline({ article: art, bundle: BUNDLE, topic, chatImpl: async ({ system }) => system.includes("CTR judge") ? { data: { best: 0 }, usage: {} } : { data: { candidates: [cand] }, usage: {} } });
    check("invented name (Taylor Swift) rejected — original metaTitle kept", art.metaTitle === orig);
  }
  // (d) generator outage → clean no-op
  {
    const art = mkArticle(); const snapshot = JSON.stringify(art);
    const r = await refineHeadline({ article: art, bundle: BUNDLE, topic, chatImpl: async () => { throw new Error("down"); } });
    check("headline outage → no-op (fail-open)", JSON.stringify(art) === snapshot && r.changed.length === 0);
  }
  check("grounding primitives sane", numbersGrounded("on July 3 with 40 guests", "July 3 ... 40 guests") && !numbersGrounded("$5 million deal", "no numbers here") && namesGrounded("Star A", "star a wed") && !namesGrounded("Brad Pitt attends", "nobody here"));
}
// ── 7) runGossip: synth+headline flow (injected) — brief reaches the writer; headline runs on PUBLISH ──
{
  let gotBrief = null, headlineRan = 0;
  const bundle = BUNDLE;
  const r = await runGossip({ primaryEntity: "Star A", title: "t", claim: "wedding", subjectType: "actor" }, {
    fetchImpl: async () => { throw new Error("no net"); },
    writeImpl: async ({ brief, anchors }) => { gotBrief = brief; return { title: "Star A Weds", dek: "A wedding to remember for the couple.", body: ("Star A married on July 3. " + "Detail sentence here. ".repeat(30)) + "⟦Q1⟧", keyTakeaways: ["k"], faq: [{ q: "Q?", a: "A." }], whatWeKnow: ["Star A married July 3"], whatWeDont: [], claims: [] }; },
    editorialImpl: async () => ({ isStory: true, category: "celebrity", primaryEntity: "Star A", confirmed: true, official: false, denied: false, angle: "wedding" }),
    synth: true, synthImpl: async () => ({ hook: "h", beats: ["b"], useAnchors: ["Q1"], mustInclude: [], angle: "a" }),
    headline: true, headlineImpl: async ({ article }) => { headlineRan++; return { changed: [], candidates: 3 }; },
    verify: false, judge: false, corroborate: false,
    // gatherBundle needs sources: give the topic an inline text source so Stage 3 passes offline
  }).catch((e) => ({ status: "ERR", err: String(e) }));
  // topic had no sources → BLOCKED is fine; re-run with an inline source topic:
  const r2 = await runGossip({ primaryEntity: "Star A", title: "t", claim: "wedding", subjectType: "actor", sources: [{ outlet: "Page Six", text: "Star A married Star B on July 3 at a Malibu estate. ".repeat(10) }] }, {
    writeImpl: async ({ brief }) => { gotBrief = brief; return { title: "Star A Weds", dek: "A wedding to remember for the couple.", body: "Star A married on July 3. " + "Detail sentence here. ".repeat(30), keyTakeaways: ["k"], faq: [{ q: "Q?", a: "A." }], whatWeKnow: ["Star A married July 3"], whatWeDont: [], claims: [] }; },
    editorialImpl: async () => ({ isStory: true, category: "celebrity", primaryEntity: "Star A", confirmed: true, official: false, denied: false, angle: "wedding" }),
    synth: true, synthImpl: async () => ({ hook: "h", beats: ["b"], useAnchors: [], mustInclude: [], angle: "a" }),
    headline: true, headlineImpl: async () => { headlineRan++; return { changed: ["metaTitle"], candidates: 3 }; },
    verify: false, judge: false, corroborate: false,
  });
  check("brief flows to the writer + headline stage runs on PUBLISH", r2.status === "PUBLISH" && gotBrief?.hook === "h" && headlineRan >= 1 && r2.headline?.candidates === 3, JSON.stringify({ status: r2.status, headlineRan }));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("MAKE upgrade green. ✅\n");
