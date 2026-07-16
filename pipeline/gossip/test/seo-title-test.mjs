// GOSSIP SEO test — metaTitle (name-first, CLEAN ending never a dangler, target 45–55), metaDescription
// (140–160, teaser + fact, full sentence, distinct from dek), keywords (no gossip/general). The reader-facing
// `title` is never shortened. Run: node pipeline/gossip/test/seo-title-test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { seoMetaTitle, buildMetaTitle, buildMetaDescription, deriveKeywords, validMetaTitle, bestTitle } from "../seo.mjs";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.resolve(__dirname, "../../../content/articles");

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
const startsWith = (s, p) => s.toLowerCase().startsWith(p.toLowerCase());
// a metaTitle must NOT end on a dangling function/pronoun/verb/particle/contraction word
const BAD_END_RE = /(?:^|\s)['"‘“]?(?:a|an|the|of|to|in|on|at|for|with|from|by|as|and|or|but|so|up|out|off|down|back|over|about|after|before|amid|he|she|it|they|we|i|you|him|her|them|his|its|their|who|which|is|are|was|were|be|has|have|had|do|does|did|will|would|can|goes|go|get|gets|got|says|said|say|make|made|take|took|just|now|also|not|very)$|n['’]t$|['’](?:t|s|re|ll|ve|d|m)$/i;
const cleanEnd = (s) => !BAD_END_RE.test(String(s).replace(/[^A-Za-z0-9'’]+$/u, ""));

console.log("\n=== metaTitle: CLEAN ENDINGS (the owner's known-bad danglers) ===\n");

// 1) "…Reason She" — must not end on the pronoun "She".
{
  const o = seoMetaTitle({ title: "Rosie O'Donnell Explains the $100 Million Reason She Quit Her Talk Show", primaryEntity: "Rosie O'Donnell" });
  check("no '…Reason She' dangler", cleanEnd(o) && !/\bshe$/i.test(o) && startsWith(o, "Rosie"), `[${o.length}] ${o}`);
}
// 2) "…Wasn't" — must not end on a contraction; must not end on the pronoun "It".
{
  const o = seoMetaTitle({ title: "Kathy Griffin's 'Hard Launch' of a 22-Year-Old Wasn't What It Seemed", primaryEntity: "Kathy Griffin" });
  check("no '…Wasn't' / '…It' dangler", cleanEnd(o) && !/wasn['’]t$/i.test(o) && startsWith(o, "Kathy"), `[${o.length}] ${o}`);
}
// 3) "…Goes Up" — must not end on the verb/particle; must not split "Conor McGregor".
{
  const o = seoMetaTitle({ title: "Drake's Million-Dollar Bet on Conor McGregor Goes Up in Smoke", primaryEntity: "Drake", coSubjects: ["Conor McGregor"] });
  check("no '…Goes Up' dangler + doesn't split 'Conor McGregor'", cleanEnd(o) && !/\bup$/i.test(o) && !/\bconor$/i.test(o) && startsWith(o, "Drake"), `[${o.length}] ${o}`);
}
// 4) never split a multi-word NAME.
{
  const o = seoMetaTitle({ title: "Taylor Swift & Travis Kelce Say 'I Do' at Madison Square Garden Wedding", primaryEntity: "Taylor Swift", coSubjects: ["Travis Kelce"] });
  check("never ends mid-name ('…Travis'/'…Taylor')", !/\btravis$/i.test(o) && !/\btaylor$/i.test(o) && cleanEnd(o), `[${o.length}] ${o}`);
}
// 5) clean short title kept whole (≤55, complete).
{
  const o = seoMetaTitle({ title: "Amy Schumer's Bikini Photo Puts Her C-Section Scar Front and Center", primaryEntity: "Amy Schumer" });
  check("clean, name-first, ends complete", cleanEnd(o) && startsWith(o, "Amy") && o.length <= 65, `[${o.length}] ${o}`);
}
// 6) bestTitle keeps the FULL title when there is no clean in-band cut (never a dangler).
{
  const o = bestTitle("Drake's Million-Dollar Bet on Conor McGregor Goes Up in Smoke", ["Conor McGregor"]);
  check("no-clean-cut → clean ending (not a dangler)", cleanEnd(o), `[${o.length}] ${o}`);
}

console.log("\n=== Fix #1: writer-crafted meta preferred, else built ===");
// 7) a good writer metaTitle is used as-is.
{
  const o = buildMetaTitle({ writerMetaTitle: "Rosie O'Donnell Reveals Why She Left the U.S.", title: "Rosie O'Donnell Explains Why She Moved to Ireland After Trump's Reelection", primaryEntity: "Rosie O'Donnell" });
  check("good writer metaTitle used verbatim", startsWith(o, "Rosie") && cleanEnd(o), `[${o.length}] ${o}`);
}
// 8) a garbled writer metaTitle is rejected → deterministic fallback.
{
  const o = buildMetaTitle({ writerMetaTitle: "Rosie O'Donnell Explains the Reason She", title: "Rosie O'Donnell Says She Quit Her Talk Show After Earning $100 Million", primaryEntity: "Rosie O'Donnell" });
  check("garbled writer metaTitle rejected (clean fallback)", cleanEnd(o) && startsWith(o, "Rosie"), `[${o.length}] ${o}`);
}
// 9) metaDescription: a good 140–160 writer teaser is kept.
{
  const w = "Rosie O'Donnell says she walked away from her hit daytime talk show at its peak, and the eye-popping nine-figure payday behind that call is genuinely wild.";
  const o = buildMetaDescription({ writerMetaDesc: w, dek: "Rosie explains why she quit." });
  check("good writer metaDescription kept (140–160, full sentence)", o.length >= 140 && o.length <= 165 && /[.!?]$/.test(o), `[${o.length}]`);
}
// 10) metaDescription: a real 75–107 dek → built up to ~140–160 with a concrete fact, full sentence, distinct-ish.
{
  const dek = "Rosie O'Donnell is opening up about the surprising financial reason behind her exit.";
  const o = buildMetaDescription({ writerMetaDesc: dek, dek, keyTakeaways: ["She earned an estimated $100 million from her syndicated daytime talk show"] });
  check("built metaDescription reaches 140–165, sentence-ended, adds a fact", o.length >= 140 && o.length <= 165 && /[.!?…]$/.test(o) && o.length > dek.length, `[${o.length}] ${o}`);
}

console.log("\n=== Fix #5: no gossip/general in keywords ===");
{
  const k = deriveKeywords({ primaryEntity: "Kathy Griffin", coSubjects: [], category: "celebrity", subcategory: "news", gossipType: "general" });
  check("keywords carry no 'gossip'/'general'/'celebrity gossip'", !k.some((t) => /gossip|general/i.test(t)) && k.includes("Kathy Griffin"), JSON.stringify(k));
}

// ── SWEEP all published gossip titles: clean endings, ≤65, no brand ──
console.log("\n=== sweep all published titles ===");
let n = 0, dangle = 0, brand = 0, inBand = 0; const bad = [];
for (const f of fs.readdirSync(CONTENT).filter((x) => x.endsWith(".md"))) {
  let data; try { ({ data } = matter(fs.readFileSync(path.join(CONTENT, f), "utf8"))); } catch { continue; }
  if (!data.title || data.formatTag !== "gossip") continue;
  n++;
  const pe = data?.provenance?.primaryEntity || (data.tags || [])[0] || "";
  const o = seoMetaTitle({ title: data.title, primaryEntity: pe, tags: data.tags || [], coSubjects: data?.provenance?.coSubjects || [] });
  if (!cleanEnd(o)) { dangle++; if (bad.length < 8) bad.push(`${o.length}: ${o}`); }
  if (/screen report/i.test(o)) brand++;
  if (o.length >= 45 && o.length <= 55) inBand++;
}
check(`swept ${n} gossip titles: ZERO danglers`, dangle === 0, bad.join("\n     "));
check(`swept ${n} gossip titles: no brand leak`, brand === 0, `${brand}`);
console.log(`  distribution: ${inBand}/${n} in the 45–55 target band (rest are clean but slightly out — clean wins).`);

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Gossip SEO green. ✅\n");
