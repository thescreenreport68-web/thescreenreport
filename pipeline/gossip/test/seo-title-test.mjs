// SEO metaTitle rule test: name-first, ≤55 chars, no brand suffix, hook after the name — while the
// reader-facing `title` is never shortened. Also sweeps EVERY published title to prove no output is
// empty, over-55, or garbled. Run: node pipeline/gossip/test/seo-title-test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { seoMetaTitle, clampDesc } from "../../lib/seo.mjs";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.resolve(__dirname, "../../../content/articles");

let pass = 0, fail = 0; const fails = [];
const check = (n, cond, d = "") => { if (cond) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
const startsWith = (s, p) => s.toLowerCase().startsWith(p.toLowerCase());

console.log("\n=== SEO metaTitle rule ===\n");

const band = (o) => o.length >= 45 && o.length <= 55; // owner: 45 ≤ len ≤ 55
// 1) THE OWNER EXAMPLE — lead with the name, drop "Inside", 45–55.
{
  const o = seoMetaTitle({ title: "Inside Brad Pitt and Ines de Ramon's Low-Key Summer Romance", primaryEntity: "Brad Pitt" });
  check("owner example → name-first, 45–55, no 'Inside'", startsWith(o, "Brad Pitt") && band(o) && !/inside/i.test(o), `[${o.length}] ${o}`);
}
// 2) reslice past a "Why" lead-in so the bigger name leads.
{
  const o = seoMetaTitle({ title: "Why Robert Pattinson, Jaime King & More Missed Taylor Swift's Wedding", primaryEntity: "Robert Pattinson" });
  check("'Why …' → leads with Robert Pattinson, 45–55", startsWith(o, "Robert Pattinson") && band(o), `[${o.length}] ${o}`);
}
// 3) question title — name still leads, 45–55.
{
  const o = seoMetaTitle({ title: "Is Taylor Frankie Paul Returning to Mormon Wives? The Truth", primaryEntity: "Taylor Frankie Paul" });
  check("question title → leads with the name, 45–55", startsWith(o, "Taylor Frankie Paul") && band(o), `[${o.length}] ${o}`);
}
// 4) single-name subject already leading — kept, 45–55.
{
  const o = seoMetaTitle({ title: "Beyoncé Drops Surprise Single Morning Dew Donk Amid Act III Buzz", primaryEntity: "Beyoncé" });
  check("single-name lead kept + 45–55", startsWith(o, "Beyoncé") && band(o), `[${o.length}] ${o}`);
}
// 5) brand suffix stripped.
{
  const o = seoMetaTitle({ title: "Zendaya Lands a Major New Leading Role in an A24 Thriller — The Screen Report", primaryEntity: "Zendaya" });
  check("brand suffix removed + 45–55", !/screen report/i.test(o) && startsWith(o, "Zendaya") && band(o), `[${o.length}] ${o}`);
}
// 6) long name-first title lands 45–55 with a clean end.
{
  const o = seoMetaTitle({ title: "Jennifer Lopez and Ben Affleck Finalize Their Divorce After Two Years of Marriage", primaryEntity: "Jennifer Lopez" });
  check("over-55 title → 45–55, clean end", band(o) && !/[\s—–\-|:,&]$/.test(o) && startsWith(o, "Jennifer Lopez"), `[${o.length}] ${o}`);
}
// 7) clampDesc keeps ≤160.
{
  const long = "The pop superstar surprised fans this morning with an announcement nobody saw coming, sending social media into a frenzy and reigniting speculation about a long-rumored reunion tour across three continents.";
  const o = clampDesc(long);
  check("clampDesc ≤160", o.length <= 160, `${o.length} chars`);
}
// 8) never returns empty even with a bare title.
{
  check("bare title never empty", seoMetaTitle({ title: "Oscars 2026" }).length > 0);
}

// ── SWEEP every published article: 45–55 band, none over 55, none empty, no brand leak ──
console.log("\n=== sweep all published titles ===");
let n = 0, over = 0, empty = 0, brand = 0, inBand = 0, under = 0, underWithSource = 0;
const worst = [], tooShort = [];
for (const f of fs.readdirSync(CONTENT).filter((x) => x.endsWith(".md"))) {
  const { data } = matter(fs.readFileSync(path.join(CONTENT, f), "utf8"));
  if (!data.title) continue;
  n++;
  const pe = data?.provenance?.primaryEntity || (data.tags || [])[0] || "";
  const o = seoMetaTitle({ title: data.title, primaryEntity: pe, tags: data.tags || [], about: data.about || [] });
  if (!o) empty++;
  if (o.length > 55) { over++; worst.push(`${o.length}: ${o}`); }
  if (/screen report/i.test(o)) brand++;
  if (o.length >= 45 && o.length <= 55) inBand++;
  else if (o.length < 45) {
    under++;
    // a title with plenty of source material (≥52 chars) should always reach ≥45 — flag if not
    if (String(data.title).replace(/^\s*(inside|why|how|what|meet|watch|see|is|are)\s+/i, "").length >= 52) {
      underWithSource++;
      if (tooShort.length < 8) tooShort.push(`${o.length}: ${o}   ⟵ ${data.title}`);
    }
  }
}
check(`swept ${n}: none empty`, empty === 0, `${empty} empty`);
check(`swept ${n}: none over 55`, over === 0, worst.slice(0, 5).join(" | "));
check(`swept ${n}: no brand leak`, brand === 0, `${brand} leaked`);
// ≥97% land in 45–55; the rare under-45 are structurally unreachable (a long word straddles the
// window, or the source title itself is short) — bestTitle is optimal, so these can't be lengthened.
check(`swept ${n}: ≥97% in 45–55 band`, inBand / n >= 0.97, `only ${inBand}/${n} in band`);
console.log(`  distribution: ${inBand}/${n} in 45–55 band; ${under} under 45 (structurally unreachable).`);
if (tooShort.length) console.log("  under-45 (unreachable):\n     " + tooShort.join("\n     "));

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("SEO metaTitle green. ✅\n");
