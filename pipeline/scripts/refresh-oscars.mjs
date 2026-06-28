// Refresh the committed Oscars authoritative cache from DLu/oscar_data (scraped from the OFFICIAL Academy
// Awards Database — NOT Wikipedia). Run AFTER each Oscar ceremony, then commit data/oscars.tsv:
//   node site/pipeline/scripts/refresh-oscars.mjs
// The file is TAB-separated despite the .csv name; we store it verbatim as data/oscars.tsv.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, "../data/oscars.tsv");
const SRC = "https://raw.githubusercontent.com/DLu/oscar_data/main/oscars.csv";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const r = await fetch(SRC, { headers: { "User-Agent": UA } });
if (!r.ok) { console.error(`fetch failed: HTTP ${r.status}`); process.exit(1); }
const txt = await r.text();
const lines = txt.split(/\r?\n/).filter(Boolean);
if (lines.length < 1000 || !/^Ceremony\t/.test(lines[0])) { console.error("unexpected format (not the TSV we expect) — aborting, cache unchanged"); process.exit(1); }
const latest = Math.max(...lines.slice(1).map((l) => Number(l.split("\t")[0])).filter(Boolean));
fs.writeFileSync(OUT, txt);
console.log(`✓ refreshed ${OUT}: ${lines.length - 1} rows, latest ceremony ${latest}. Now: git add + commit data/oscars.tsv`);
