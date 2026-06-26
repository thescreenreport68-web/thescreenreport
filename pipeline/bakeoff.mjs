// Model bake-off: generate the same topics across candidate models, score each, save outputs.
// Run: cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; node site/pipeline/bakeoff.mjs
import fs from "node:fs";
import { MODELS } from "./config.mjs";
import { gatherFacts } from "./lib/wikipedia.mjs";
import { generate } from "./stages/generate.mjs";
import { gate } from "./stages/gate.mjs";

const OUT = "/Users/sivajithcu/Movie News site/seo-data/bakeoff";
fs.mkdirSync(OUT, { recursive: true });
const costOf = (id) => MODELS.candidates.find((c) => c.id === id)?.cost || [0, 0];

const TOPICS = [
  {
    id: "nolan-ranked",
    title: "Christopher Nolan Movies Ranked",
    contentType: "ranking list",
    category: "movies",
    subcategory: "rankings-lists",
    primaryKeyword: "christopher nolan movies ranked",
    angle: "rank his major features worst to best with a clear, opinionated rationale",
    entities: ["Christopher Nolan", "Oppenheimer (film)", "The Dark Knight", "Inception", "Interstellar (film)", "Dunkirk (2017 film)", "Tenet (film)", "Memento", "The Prestige (film)", "Batman Begins"],
  },
  {
    id: "oppenheimer-ending",
    title: "Oppenheimer Ending Explained",
    contentType: "explainer",
    category: "movies",
    subcategory: "explainers",
    primaryKeyword: "oppenheimer ending explained",
    angle: "explain the final Einstein lake conversation and what it really means",
    entities: ["Oppenheimer (film)", "J. Robert Oppenheimer", "Lewis Strauss", "Albert Einstein"],
  },
];

const rows = [];
for (const topic of TOPICS) {
  console.log(`\n=== TOPIC: ${topic.title} ===`);
  console.log("gathering facts...");
  topic.facts = await gatherFacts(topic.entities);
  console.log(`  ${topic.facts.length} fact blocks`);

  // generate across all candidates in parallel
  const gens = await Promise.allSettled(
    MODELS.candidates.map(async (c) => {
      const t0 = Date.now();
      const { article, usage } = await generate({ topic, model: c.id });
      return { id: c.id, tier: c.tier, article, usage, ms: Date.now() - t0 };
    })
  );

  for (let i = 0; i < gens.length; i++) {
    const c = MODELS.candidates[i];
    const g = gens[i];
    if (g.status !== "fulfilled") {
      console.log(`  ✗ ${c.id}: GEN FAILED ${String(g.reason).slice(0, 80)}`);
      rows.push({ topic: topic.id, id: c.id, tier: c.tier, error: "gen-failed" });
      continue;
    }
    const { article, usage } = g.value;
    let scored;
    try {
      scored = await gate({ article, topic, judgeModel: MODELS.judgeBakeoff });
    } catch (e) {
      console.log(`  ! ${c.id}: judge failed ${String(e).slice(0, 60)}`);
      scored = { score: null, deterministic: {}, hardBlocks: ["judge-failed"], subscores: {} };
    }
    const [ci, co] = costOf(c.id);
    const estCost = ((usage.prompt_tokens || 0) * ci + (usage.completion_tokens || 0) * co) / 1e6;
    const det = scored.deterministic || {};
    rows.push({
      topic: topic.id, id: c.id, tier: c.tier, score: scored.score,
      words: det.words, faq: det.faqCount, ext: det.externalLinks, int: det.internalLinks,
      h2: det.h2s, h2q: det.h2Questions, hb: (scored.hardBlocks || []).length,
      cost: estCost, subscores: scored.subscores,
    });
    const safe = c.id.replace(/[/.]/g, "_");
    fs.writeFileSync(
      `${OUT}/${topic.id}__${safe}.md`,
      `# ${article.title}\n\n_model: ${c.id} (${c.tier}) · score: ${scored.score} · $${estCost.toFixed(4)} · hardBlocks: ${JSON.stringify(scored.hardBlocks)}_\n\n**Dek:** ${article.dek}\n\n**Key Takeaways:**\n${(article.keyTakeaways || []).map((k) => "- " + k).join("\n")}\n\n---\n\n${article.body}\n\n---\n\n## FAQ\n${(article.faq || []).map((f) => `**${f.q}**\n${f.a}`).join("\n\n")}\n\n## Scorecard\nstrengths: ${JSON.stringify(scored.strengths)}\nweaknesses: ${JSON.stringify(scored.weaknesses)}\nsubscores: ${JSON.stringify(scored.subscores)}\n`
    );
    console.log(`  ✓ ${c.id.padEnd(40)} score ${String(scored.score).padStart(3)} | ${det.words}w faq${det.faqCount} ext${det.externalLinks} | $${estCost.toFixed(4)} | hb ${(scored.hardBlocks || []).length}`);
  }
}

// summary: average score + cost per model across topics
console.log("\n\n=== SUMMARY (avg across topics) ===");
const byModel = {};
for (const r of rows) {
  if (r.error) continue;
  (byModel[r.id] = byModel[r.id] || { tier: r.tier, scores: [], costs: [] });
  if (typeof r.score === "number") byModel[r.id].scores.push(r.score);
  if (typeof r.cost === "number") byModel[r.id].costs.push(r.cost);
}
const summary = Object.entries(byModel).map(([id, v]) => ({
  id, tier: v.tier,
  avgScore: v.scores.length ? v.scores.reduce((a, b) => a + b, 0) / v.scores.length : null,
  avgCost: v.costs.length ? v.costs.reduce((a, b) => a + b, 0) / v.costs.length : null,
}));
summary.sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));
for (const s of summary) {
  console.log(`  ${(s.avgScore?.toFixed(1) ?? "—").padStart(5)}  ${("$" + (s.avgCost?.toFixed(4) ?? "?")).padStart(9)}/article  [${s.tier}]  ${s.id}`);
}
fs.writeFileSync(`${OUT}/_summary.json`, JSON.stringify({ rows, summary }, null, 2));
console.log("\nFull outputs in", OUT);
