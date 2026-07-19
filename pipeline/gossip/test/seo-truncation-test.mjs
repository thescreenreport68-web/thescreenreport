// 2026-07-19 Batch B — SEO truncation. Every case measured on live articles by the deep dive:
// 146/194 shipped a mid-clause metaDescription, 35/194 a chopped metaTitle, 21/194 a description
// identical to the dek.  node pipeline/gossip/test/seo-truncation-test.mjs
import { buildMetaDescription, bestTitle, validMetaDesc, validMetaTitle } from "../seo.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
console.log("\n=== BATCH B: SEO TRUNCATION ===\n");

// ── #13 the appended fact must never be a mid-clause fragment given a period ──
{
  const d = buildMetaDescription({
    dek: "The singer confirmed the split in a short statement.",
    keyTakeaways: ["She filed in Los Angeles Superior Court on Tuesday citing irreconcilable differences after nine years"],
    names: ["Los Angeles Superior Court"],
  });
  check("no mid-clause fragment shipped as a sentence", !/\b(in|of|at|on|the|a|to|for|and|Los|Angeles|Superior)\.$/.test(d.trim()), d);
  check("description within the render contract", d.length <= 160, String(d.length));
  // a fact that cannot fit cleanly must be omitted entirely rather than chopped
  const d2 = buildMetaDescription({
    dek: "A fairly long dek that already consumes a large part of the available snippet room here.",
    keyTakeaways: ["The settlement was filed in the Superior Court of the State of California for the County of Los Angeles on Tuesday"],
  });
  check("an unfittable fact is omitted, not chopped", d2.length <= 160 && !/\b(in|of|the|for|County|State)\.$/.test(d2.trim()), d2);
}
// ── #40 metaDescription must never be byte-identical to the dek ──
{
  const longDek = "The couple kept the guest list tiny and the location secret until the very last minute of the ceremony day.";
  const d = buildMetaDescription({ dek: longDek, keyTakeaways: ["They married on July 3"] });
  check("long dek + a distinct fact ⇒ description differs from the dek", d !== longDek && d.length <= 160, d);
  check("and it passes validMetaDesc", validMetaDesc(d, longDek), d);
}
// ── #39 no double period after an abbreviation ──
{
  const d = buildMetaDescription({ dek: "A short dek here.", keyTakeaways: ["The deal was signed in the U.S."] });
  check("no double period after an abbreviation", !/\.\.$/.test(d.trim()), d.slice(-40));
}
// ── #14/#17 a headline the renderer would ship verbatim must NOT be cut ──
{
  const cases = [
    ["Star Alpha and Star Beta Say I Do at a Malibu Estate Bash", ["Star Alpha", "Star Beta"]],
    ["Kathie Lee Gifford Corrects the Record on Frank Giffords Affair", ["Kathie Lee Gifford", "Frank Gifford"]],
    ["Jelly Roll and Bunnie Xo Finalize Divorce After Nearly a Decade", ["Jelly Roll", "Bunnie Xo"]],
  ];
  let cut = 0;
  for (const [t, names] of cases) { const r = bestTitle(t, names); if (r !== t) { cut++; console.log("      chopped: " + t.length + " → " + r); } }
  check("56–65 char headlines ship WHOLE (render honors 30–65)", cut === 0, cut + " chopped");
  // a genuinely over-long headline must still be cut, and cleanly
  const long = "Star Alpha and Star Beta Say I Do at a Private Malibu Estate Wedding With Every Famous Friend They Have";
  const r = bestTitle(long, ["Star Alpha", "Star Beta"]);
  check("an over-long headline is still cut, and cleanly", r.length < long.length && r.length <= 65 && validMetaTitle(r, ["Star Alpha"]), r);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Batch B green — no more truncated SEO fields. ✅\n");
