// DEV-ONLY: pick the higher-model JUDGE. Run gate.mjs judge() with each candidate on a CLEAN bundle-article and a
// TAMPERED copy (4 planted fabrications) — which catches the most fabrications in its hardBlocks without nuking the
// clean one + scores quality sensibly. The deterministic verifyGate already catches these; the judge is the
// secondary fact-check + quality scorer that drives the rewrite loop.
import fs from "node:fs";
import { judge } from "../stages/gate.mjs";

const SCR = "/private/tmp/claude-501/-Users-sivajithcu-Movie-News-site/f8bb6444-dd50-471f-8753-9b4af241679b/scratchpad";
const bakeoff = JSON.parse(fs.readFileSync(SCR + "/bakeoff-results.json", "utf8"));
const bundles = JSON.parse(fs.readFileSync(SCR + "/bundles.json", "utf8")).topics;
const sgB = bundles.find((b) => /supergirl/i.test(b.topic));

// topic.facts = the bundle (the judge checks claims against these)
const topic = {
  title: "Supergirl Box Office Opening Weekend", primaryKeyword: "Supergirl box office",
  contentType: "box-office", category: "movies", subcategory: "box-office", formatTag: "box-office",
  facts: [
    ...sgB.sources.map((s) => ({ title: `${s.publisher} report`, extract: `${s.fullTextExcerpt} ${(s.quotes || []).join(" ")}` })),
    { title: "VERIFIED FACTS", extract: sgB.groundTruthFacts.map((f) => f.fact).join(". ") },
  ],
};
const c = bakeoff.find((x) => x.model === "deepseek/deepseek-v3.2" && /supergirl/i.test(x.bundle) && x.run === 2);
const clean = c._article;
const tampered = { ...clean, body: (clean.body || "") +
  "\n\n## More\nSupergirl won the Academy Award for Best Picture this year. It grossed $912 million worldwide in its opening weekend. " +
  `Director Craig Gillespie said, "This is the single biggest opening in Warner Bros. history." It is now streaming exclusively on Netflix.` };

const PLANTS = [/best picture|academy award|oscar/i, /912|opening weekend.*(million|\$)/i, /biggest opening|warner bros.* history|fabricat.*quote|invented quote|quote/i, /netflix/i];
const models = ["openai/gpt-4.1-mini", "google/gemini-2.5-flash", "google/gemini-2.5-flash-lite"];

for (const m of models) {
  console.log("\n========== " + m + " ==========");
  for (const [label, art] of [["CLEAN", clean], ["TAMPERED", tampered]]) {
    const t0 = Date.now();
    let j;
    try { j = await judge({ article: art, topic, model: m, metrics: null, groundTruth: { findings: [] } }); }
    catch (e) { console.log(`  ${label}: ERROR ${e.message}`); continue; }
    const hb = (j.hardBlocks || []);
    const hbText = hb.join(" || ");
    const caught = PLANTS.filter((re) => re.test(hbText)).length;
    console.log(`  ${label}: score=${j.score} acc=${j.subscores?.accuracy} hardBlocks=${hb.length}${label === "TAMPERED" ? ` · caught ${caught}/4 planted` : ""} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    if (label === "TAMPERED") for (const h of hb.slice(0, 8)) console.log("      • " + h.slice(0, 95));
  }
}
