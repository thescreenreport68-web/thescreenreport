// DEV-ONLY: exercise the Step-2 content finder on real topics and print what it gathered. Not wired to runtime.
import fs from "node:fs";
import { findContent } from "../lib/contentFinder.mjs";

const BUNDLES = process.env.BUNDLES || "/private/tmp/claude-501/-Users-sivajithcu-Movie-News-site/f8bb6444-dd50-471f-8753-9b4af241679b/scratchpad/bundles.json";
const OUT = "/private/tmp/claude-501/-Users-sivajithcu-Movie-News-site/f8bb6444-dd50-471f-8753-9b4af241679b/scratchpad/content-bundles.json";
const seedTopics = JSON.parse(fs.readFileSync(BUNDLES, "utf8")).topics;
const seedsFor = (re) => { const t = seedTopics.find((b) => re.test(b.topic)); return t ? t.sources.map((s) => s.url).filter(Boolean) : []; };

const TOPICS = [
  { label: "Supergirl — seeds + live enumeration", primaryEntity: "Supergirl", query: "Supergirl 2026 box office opening weekend", seedUrls: seedsFor(/supergirl/i) },
  { label: "The Drama (Zendaya/Pattinson) — seeds + live", primaryEntity: "The Drama", query: "The Drama Zendaya Pattinson HBO Max release", seedUrls: seedsFor(/drama/i) },
  { label: "Supergirl — PURE LIVE (no seeds, finder must find sources itself)", primaryEntity: "Supergirl", query: "Supergirl box office opening weekend" },
];

const out = [];
const RUN = process.env.ONLY != null ? [TOPICS[Number(process.env.ONLY)]] : TOPICS;
for (const t of RUN) {
  const t0 = Date.now();
  console.log(`\n${"=".repeat(80)}\n${t.label}\n  query: "${t.query}"  seeds: ${t.seedUrls?.length || 0}`);
  let b;
  try { b = await findContent(t); } catch (e) { console.log("  ERROR:", e.message); out.push({ label: t.label, error: e.message }); continue; }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (b.blocked) {
    console.log(`  🚫 BLOCKED (${b.reason}) — candidatesFound=${b.candidatesFound} tried=${b.triedExtract}  [${secs}s]`);
  } else {
    console.log(`  ✓ ${b.sources.length} sources · ${b.independentOwners.length} independent owners · ${b.majorCount} major · ${b.totalQuotes} quotes · candidatesFound=${b.candidatesFound}  [${secs}s]`);
    for (const s of b.sources) {
      console.log(`     • [${s.tier}/${s.owner}] ${s.domain}  via:${s.via}  text:${s.text.length}ch  quotes:${s.quotes.length}`);
      if (s.quotes[0]) console.log(`         "${s.quotes[0].slice(0, 110)}"`);
    }
    if (b.extractFailures?.length) console.log(`     (extract failed on: ${b.extractFailures.slice(0, 6).join(", ")})`);
  }
  out.push({ label: t.label, ...b });
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\nfull bundles saved: ${OUT}`);
