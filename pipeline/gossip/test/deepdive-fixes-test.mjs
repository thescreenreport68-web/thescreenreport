// 2026-07-19 deep-dive fixes. Each test pins a bug that was CONFIRMED live in production code.
//   node pipeline/gossip/test/deepdive-fixes-test.mjs
import { detectGossipType } from "../writer.mjs";
import { buildAnchors, substituteAnchors } from "../synthesizer.mjs";
import { gatherBundle } from "../contentFinder.mjs";
import { eventKey } from "../dedup.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
console.log("\n=== DEEP-DIVE CONFIRMED-BUG FIXES ===\n");

// ── 1) truncated stems inside \b...\b could never match (the duplicate's true origin) ──
{
  const cases = [
    ["jelly roll and bunnie xo finalize their divorce", "breakup"],
    ["the couple are divorcing after a decade", "breakup"],
    ["the pair have separated", "breakup"],
    ["star a is pregnant with her second child", "pregnancy"],
    ["she was hospitalized on tuesday", "pregnancy"],
    ["the studio issued an apology", "controversy"],
    ["he was accused of misconduct", "controversy"],
    ["star a joins the cast of a new series", "career"],
    ["star a spotted grabbing dinner", "spotted"],
    ["star a announces a world tour", "general"],
  ];
  let wrong = 0;
  for (const [t, want] of cases) if (detectGossipType({ title: t }) !== want) wrong++;
  check("gossipType: stems match their own words (10 real phrasings)", wrong === 0, wrong + " wrong");
  // the concrete consequence: both Jelly Roll stories must land in the SAME dedup bucket
  const now = new Date("2026-07-18T09:00:00Z");
  const a = eventKey({ primaryEntity: "Jelly Roll", title: "Jelly Roll and Bunnie Xo Settle Divorce, Keep Baby Plans" }, now);
  const b = eventKey({ primaryEntity: "Jelly Roll", title: "Jelly Roll and Bunnie Xo Finalize Divorce After Nearly a Decade" }, now);
  check("the two duplicate stories now share ONE eventKey bucket", a === b, a + "  vs  " + b);
}

// ── 2) anchor substitution ate $-patterns inside real quotes ──
{
  const bundle = { sources: [{ outlet: "People", tier: 6, text: "x", quotes: ["I paid $1 for it and $2 more later", "It cost $5 & change"] }] };
  const anchors = buildAnchors(bundle);
  const quoted = { body: 'She said "⟦Q1⟧" yesterday.', dek: "d" };
  substituteAnchors(quoted, anchors);
  check("writer-quoted token keeps $1/$2 verbatim", quoted.body.includes("$1 for it and $2 more later"), quoted.body);
  const bare = { body: "She said ⟦Q2⟧ today.", dek: "d" };
  substituteAnchors(bare, anchors);
  check("bare token keeps $ and & verbatim", bare.body.includes("$5 & change"), bare.body);
}

// ── 3) the evergreen filter must actually RUN inside gatherBundle (it was imported, never called) ──
{
  const mkFetch = () => async () => ({ ok: true, text: async () => "<p>" + "Star A did something newsworthy today. ".repeat(30) + "</p>" });
  const topic = (url) => ({ primaryEntity: "Star A", title: "t", claim: "c", sources: [{ outlet: "Us Weekly", url, tier: 6 }] });
  const opts = { fetchImpl: mkFetch(), extractImpl: async () => ({ content: "<p>" + "Star A did something newsworthy today. ".repeat(30) + "</p>", title: "Star A News" }), corroborate: false };

  const ever = await gatherBundle(topic("https://www.usmagazine.com/celebrity-moms/news/jelly-rolls-family-guide-meet-his-two-children-and-wife-bunnie-xo/"), opts);
  check("evergreen 'family guide' page is DROPPED from the bundle", ever.ok === false && ever.evergreenDropped === 1, JSON.stringify({ ok: ever.ok, dropped: ever.evergreenDropped }));
  check("blocked with the biography-page reason", /biography page is not a report/.test(ever.reason || ""), ever.reason);

  const roundup = await gatherBundle(topic("https://www.usmagazine.com/celebrity-news/news/inside-ariana-grandes-rekindled-romance-more-top-stories/"), opts);
  check("multi-story roundup is DROPPED", roundup.ok === false && roundup.evergreenDropped === 1);

  const news = await gatherBundle(topic("https://pagesix.com/2026/07/17/celebrity-news/star-a-and-star-b-settle-divorce/"), opts);
  check("a real news report is KEPT", news.ok === true && news.evergreenDropped === 0 && news.sources.length === 1, JSON.stringify({ ok: news.ok, dropped: news.evergreenDropped, n: news.sources.length }));
}


// ── 4) round 2: fail-closed store, entity decoding everywhere, quote splicing ──
{
  const fs2 = await import("node:fs"); const os2 = await import("node:os"); const p2 = await import("node:path");
  const { openStore } = await import("../vecStore.mjs");
  const { extractQuotes } = await import("../contentFinder.mjs");
  const dir = fs2.mkdtempSync(p2.join(os2.tmpdir(), "vs-"));

  // a MISSING store is a legitimate first run
  let ok1 = true; try { openStore(p2.join(dir, "none.json")); } catch { ok1 = false; }
  check("missing store still opens (first run)", ok1);
  // a PRESENT but corrupt store must THROW so dedup fails closed (HOLD) instead of losing all history
  const bad = p2.join(dir, "corrupt.json"); fs2.writeFileSync(bad, '{"records":[{"key":"a"');
  let threw = false; try { openStore(bad); } catch { threw = true; }
  check("corrupt store FAILS CLOSED (throws, so dedup HOLDs)", threw);

  // AP-style multi-paragraph quotes must not splice into one composite
  const ap = 'She began: "I was completely blindsided by all of it\n\n"and then it got worse," she said. "It was awful."';
  const qs = extractQuotes(ap);
  check("no cross-paragraph composite quote emitted", !qs.some((q) => /\n/.test(q)), JSON.stringify(qs));
  check("an attribution clause is never swallowed into a quote", !qs.some((q) => /,\s*she\s+said/i.test(q)), JSON.stringify(qs));
  check("a normal quote still extracts", extractQuotes('He said "this is a clean verbatim quote here" today.').length === 1);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Deep-dive fixes verified. ✅\n");
