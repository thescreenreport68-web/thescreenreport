// DEV-ONLY end-to-end test of the Step-4 wiring: a REAL gathered content bundle → the bundle-LOCKED writer
// (DeepSeek V3.2) → the gate with the universal verify gate inside it. Confirms the writer stays grounded and the
// integrated gate verifies every claim against the bundle. Uses the saved content finder output (no re-fetch).
import fs from "node:fs";
import { generate } from "../stages/generate.mjs";
import { gate } from "../stages/gate.mjs";

const SCR = "/private/tmp/claude-501/-Users-sivajithcu-Movie-News-site/f8bb6444-dd50-471f-8753-9b4af241679b/scratchpad";
const cb = JSON.parse(fs.readFileSync(SCR + "/content-bundles.json", "utf8"));
const sg = cb.find((x) => /supergirl/i.test(x.label) && !x.blocked && x.sources?.length);
if (!sg) { console.error("no usable Supergirl bundle in content-bundles.json"); process.exit(1); }

// Build the topic exactly as run.mjs would after the content finder fires (bundle stashed + injected into facts).
const topic = {
  id: "e2e-sg", slug: "supergirl-box-office", title: "Supergirl Box Office Opening Weekend",
  primaryEntity: "Supergirl", primaryKeyword: "Supergirl box office", contentType: "box-office",
  category: "movies", subcategory: "box-office", formatTag: "box-office",
  _bundle: { blocked: false, sources: sg.sources }, facts: [],
};
const srcText = sg.sources.map((s) => `[${s.domain} · ${s.tier}]\n${s.text}${s.quotes?.length ? "\nON-THE-RECORD QUOTES: " + s.quotes.map((q) => `"${q}"`).join(" | ") : ""}`).join("\n\n");
topic.facts.unshift({ title: `GATHERED SOURCE REPORTING (${sg.sources.length} outlets · ${sg.independentOwners?.length || 0} independent) — your PRIMARY material; write ONLY what these sources say`, extract: srcText.slice(0, 14000) });

console.log(`bundle: ${sg.sources.length} sources (${sg.sources.map((s) => s.domain).join(", ")}), ${srcText.length} chars of source text`);
console.log("\n=== generate (DeepSeek V3.2 — locked to the bundle, 'well-known' license removed) ===");
const { article } = await generate({ topic, model: "deepseek/deepseek-v3.2" });
console.log("TITLE:", article.title);
console.log("BODY (first 700 chars):\n" + (article.body || "").slice(0, 700));
console.log(`\nclaims[] emitted: ${(article.claims || []).length}`);

console.log("\n=== gate (judge + UNIVERSAL VERIFY GATE inside) ===");
const scored = await gate({ article, topic, judgeModel: "google/gemini-2.5-flash-lite" });
console.log(`score: ${scored.score}  pass: ${scored.pass}`);
console.log(`hardBlocks (${scored.hardBlocks.length}):`);
for (const h of scored.hardBlocks) console.log("   • " + h);
const corr = scored.claimCheck?.corrections || "";
console.log("\nverify-gate / claim corrections (first 800 chars):\n" + (corr ? corr.slice(0, 800) : "(none — everything grounded)"));
