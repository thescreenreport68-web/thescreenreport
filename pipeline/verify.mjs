// Quick re-score of one model on the two bake-off topics after gate/prompt fixes.
// Run: cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; node site/pipeline/verify.mjs [model]
import { MODELS } from "./config.mjs";
import { gatherFacts } from "./lib/wikipedia.mjs";
import { generate } from "./stages/generate.mjs";
import { gate } from "./stages/gate.mjs";

const MODELS_LIST = (process.argv[2] || "deepseek/deepseek-v3.2").split(",");
const TOPICS = [
  { id: "nolan-ranked", title: "Christopher Nolan Movies Ranked", contentType: "ranking list", category: "movies", subcategory: "rankings-lists", primaryKeyword: "christopher nolan movies ranked", angle: "rank his major features worst to best with a clear, opinionated rationale and a numbered list", entities: ["Christopher Nolan", "Oppenheimer (film)", "The Dark Knight", "Inception", "Interstellar (film)", "Dunkirk (2017 film)", "Tenet (film)", "Memento", "The Prestige (film)", "Batman Begins"] },
  { id: "oppenheimer-ending", title: "Oppenheimer Ending Explained", contentType: "explainer", category: "movies", subcategory: "explainers", primaryKeyword: "oppenheimer ending explained", angle: "explain the final Einstein lake conversation and what it really means", entities: ["Oppenheimer (film)", "J. Robert Oppenheimer", "Lewis Strauss", "Albert Einstein"] },
];

// gather facts once per topic (shared across models)
for (const topic of TOPICS) topic.facts = await gatherFacts(topic.entities);

for (const MODEL of MODELS_LIST) {
  console.log(`\n\n######## MODEL: ${MODEL} ########`);
  for (const topic of TOPICS) {
    try {
      const { article } = await generate({ topic, model: MODEL });
      const g = await gate({ article, topic, judgeModel: MODELS.judgeBakeoff });
      const d = g.deterministic;
      console.log(`\n${topic.id}: SCORE ${g.score} ${g.pass ? "PASS ✅" : "(<80 / hard-block)"}`);
      console.log(`  det: ${d.words}w h2:${d.h2s}(q${d.h2Questions}) faq:${d.faqCount} int:${d.internalLinks} ext:${d.externalLinks} kwTitle:${d.kwInTitle} sources:${d.hasSources}`);
      console.log(`  hardBlocks: ${JSON.stringify(g.hardBlocks)}`);
      console.log(`  subscores: ${JSON.stringify(g.subscores)}`);
    } catch (e) {
      console.log(`\n${topic.id}: ERROR ${String(e).slice(0, 100)}`);
    }
  }
}
