// DEV-ONLY: prove the Step-3 universal verify gate PASSES a bundle-written article and CATCHES planted
// fabrications (fail-closed). Uses a real bake-off article + the Supergirl content bundle. Not wired to runtime.
import fs from "node:fs";
import { verifyGate } from "../lib/verifyGate.mjs";

const SCR = "/private/tmp/claude-501/-Users-sivajithcu-Movie-News-site/f8bb6444-dd50-471f-8753-9b4af241679b/scratchpad";
const bakeoff = JSON.parse(fs.readFileSync(SCR + "/bakeoff-results.json", "utf8"));
const bundles = JSON.parse(fs.readFileSync(SCR + "/bundles.json", "utf8")).topics;

// Build a verifyGate bundle from the prepared Supergirl bundle (source excerpts + quotes + the ground-truth facts).
const sgB = bundles.find((b) => /supergirl/i.test(b.topic));
const isMajor = (p) => /hollywood reporter|variety|deadline|forbes|the ?wrap|screen ?daily|screenrant/i.test(p);
const bundle = {
  blocked: false,
  sources: sgB.sources.map((s) => ({
    domain: s.publisher.toLowerCase().replace(/[^a-z]/g, "") + ".com", owner: s.publisher,
    tier: isMajor(s.publisher) ? "major" : "other",
    text: `${s.fullTextExcerpt} ${(s.quotes || []).join(" ")}`, quotes: s.quotes || [],
  })).concat([{ domain: "groundtruth", owner: "GT", tier: "major", text: sgB.groundTruthFacts.map((f) => f.fact).join(". "), quotes: [] }]),
};

// The CLEAN article: deepseek-v3.2 Supergirl run2 (written entirely from this bundle).
const c = bakeoff.find((x) => x.model === "deepseek/deepseek-v3.2" && /supergirl/i.test(x.bundle) && x.run === 2);
const cleanArticle = c._article || { title: c.title, body: c.body };

console.log("=== CLEAN article (written from the bundle) — expect PASS/CUT, high support ===");
const v1 = await verifyGate({ article: cleanArticle, bundle });
console.log(`  verdict=${v1.verdict}  support=${(v1.supportRate * 100).toFixed(0)}%  claims=${v1.claimCount}  unsupported=${v1.unsupported.length}`);
for (const u of v1.unsupported.slice(0, 8)) console.log(`    · ${u.status} [${u.via}]: ${u.claim.slice(0, 95)}`);

console.log("\n=== TAMPERED article (4 planted fabrications) — expect BLOCK, all caught ===");
const tampered = { ...cleanArticle, body: (cleanArticle.body || "") +
  "\n\n## Awards and Streaming\n" +
  "Supergirl also won the Academy Award for Best Picture this year, a historic first for the DCU. " +
  "The film grossed an astonishing $912 million worldwide in its opening weekend alone. " +
  `Director Craig Gillespie said, "This is the single biggest opening in Warner Bros. history." ` +
  "It is now streaming exclusively on Netflix as of this week." };
const v2 = await verifyGate({ article: tampered, bundle });
console.log(`  verdict=${v2.verdict}  support=${(v2.supportRate * 100).toFixed(0)}%  claims=${v2.claimCount}  unsupported=${v2.unsupported.length}`);
for (const u of v2.unsupported.slice(0, 14)) console.log(`    ✗ ${u.status} [${u.via}]: ${u.claim.slice(0, 95)}`);

const planted = [["best picture", /best picture|academy award|oscar/i], ["$912M", /912|opening weekend.*million|astonishing/i], ["fake quote", /biggest opening|warner bros\.? history/i], ["netflix", /netflix/i]];
const caught = planted.filter(([, re]) => v2.unsupported.some((u) => re.test(u.claim)));
console.log(`\n--- RESULT ---`);
console.log(`  CLEAN:    verdict=${v1.verdict} (${(v1.supportRate * 100).toFixed(0)}% supported)  ${["PASS", "CUT"].includes(v1.verdict) ? "✅ not blocked" : "⚠ unexpectedly blocked"}`);
console.log(`  TAMPERED: verdict=${v2.verdict}  fabrications caught: ${caught.map((c) => c[0]).join(", ") || "NONE"}  ${v2.verdict === "BLOCK" && caught.length >= 3 ? "✅ blocked + caught" : "⚠ check"}`);
