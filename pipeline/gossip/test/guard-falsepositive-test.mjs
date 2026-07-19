// 2026-07-19 Batch A — the guards I added were DELETING GOOD CONTENT and BLOCKING REAL STORIES.
// Each case below was reproduced against production data by the deep-dive audit.
//   node pipeline/gossip/test/guard-falsepositive-test.mjs
import { cutAbsenceClaims } from "../proseGuards.mjs";
import { isEvergreenSource } from "../normalize.mjs";
import { isCrossDup, tokens } from "../crossDedup.mjs";
import { buildAnchors, substituteAnchors } from "../synthesizer.mjs";
import { dedupeSentences } from "../polish.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
console.log("\n=== BATCH A: GUARD FALSE POSITIVES ===\n");

// ── A1/A2: the absence cutter must not delete ATTRIBUTED or QUOTED facts ──
{
  const cases = [
    ['Her lawyers clarified, per the documents, that "Will has not been served a subpoena."', 0, "attributed + quoted court fact"],
    ["A rep for the singer said she has not been reached for comment.", 0, "attributed absence is reporting"],
    ["People reports she has not been seen since Tuesday.", 0, "outlet-attributed"],
    ["Neither has commented on the treatment.", 1, "bare absence still cut"],
    ["The documents do not specify her age.", 1, "invented negative still cut"],
    ["Will Smith has not been publicly drawn into the legal fray.", 1, "bare open-ended still cut"],
    ["The report offers no further details on the timeline.", 1, "pipeline hedge still cut"],
    ["She confirmed the news on July 3.", 0, "normal reporting untouched"],
    ["Neither the album nor the tour was announced with a date.", 0, "not an absence claim"],
  ];
  let wrong = 0;
  for (const [t, want, label] of cases) { const r = cutAbsenceClaims(t); if (r.cut.length !== want) { wrong++; console.log("      mismatch: " + label); } }
  check("absence cutter: 9 attribution/bare cases correct", wrong === 0, wrong + " wrong");
}
// ── A3: abbreviation merge must not widen the CUT ──
{
  const r = cutAbsenceClaims("The suit names her co-star Robert Downey Jr. Neither side has commented on the filing.");
  check("abbreviation: the verified fact SURVIVES, only the absence clause is cut",
    r.body.includes("Robert Downey Jr.") && !/Neither side has commented/.test(r.body), JSON.stringify(r.body));
}
// ── A4: anchor substitution must not double the quotation marks ──
{
  const anchors = buildAnchors({ sources: [{ outlet: "P", tier: 6, text: "x", quotes: ["I have never been more embarrassed in my life"] }] });
  for (const [body, label] of [['"⟦Q1⟧," she told People.', "comma before close"], ['"⟦Q1⟧." She moved on.', "period before close"], ['"⟦Q1⟧"', "no punctuation"]]) {
    const a = { body, dek: "d" };
    substituteAnchors(a, anchors);
    check("no doubled quotes — " + label, !/""|““|””/.test(a.body) && (a.body.match(/"/g) || []).length === 2, a.body);
  }
}
// ── A5: the subject's own surname must not count as shared EVENT evidence ──
{
  const idx = [{ slug: "chris-brown-dog-attack", entity: "chris brown", evt: tokens("Chris Brown Settles Dog Attack Lawsuit for 13 Million") }];
  check("a DIFFERENT Chris Brown story still publishes", !isCrossDup({ primaryEntity: "Chris Brown", title: "Chris Brown Settles Into a New Miami Mansion", claim: "new home" }, idx));
  check("the SAME story reworded is still caught", !!isCrossDup({ primaryEntity: "Chris Brown", title: "Chris Brown Ordered to Pay 13 Million Over Dog Attack", claim: "dog attack lawsuit" }, idx));
}
// ── A6: evergreen markers must not block real breaking news ──
{
  const cases = [
    ["https://people.com/celebrity/travis-barkers-tour-guide-hospitalized/", 0],
    ["https://www.tmz.com/2026/07/18/kanye-west-net-worth-plummets-after-adidas-ruling/", 0],
    ["https://pagesix.com/2026/07/17/celebrity-news/star-a-settles-divorce/", 0],
    ["https://people.com/news/star-a-timeline-of-events-revealed-in-court/", 0],
    ["https://www.usmagazine.com/celebrity-moms/news/jelly-rolls-family-guide-meet-his-two-children/", 1],
    ["https://www.usmagazine.com/celebrity-news/news/inside-x-more-top-stories/", 1],
    ["https://people.com/gallery/best-red-carpet-looks/", 1],
    ["https://people.com/news/who-is-star-a-everything-to-know/", 1],
  ];
  let wrong = 0;
  for (const [u, want] of cases) if ((isEvergreenSource({ url: u }) ? 1 : 0) !== want) { wrong++; console.log("      mismatch: " + u.slice(0, 78)); }
  check("evergreen filter: 8 URL cases correct (4 real news allowed)", wrong === 0, wrong + " wrong");
}
// ── A7: a repeated quote must take its carrier sentence with it ──
{
  const r = dedupeSentences('She said, "I have never felt more supported in my entire life." Later, asked about the wedding, she circled right back: "I have never felt more supported in my entire life."');
  check("repeated quote: no dangling carrier sentence", !/circled right back:\s*$/.test(r.trim()) && (r.match(/never felt more supported/g) || []).length === 1, r);
  const keep = dedupeSentences('She said, "the first quote here is unique." He replied, "a totally different second quote."');
  check("two DISTINCT quotes both survive", (keep.match(/"/g) || []).length === 4, keep);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Batch A green — guards no longer damage good content. ✅\n");
