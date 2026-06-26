// Pipeline orchestrator. Runs each topic through every stage in strict order; nothing is written
// unless it passes the rank-#1 gate (>=80, no hard-block) AND has a legal >=1200px image.
// Run:  cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; node site/pipeline/run.mjs [--dry-run] [--only=<id>]
import fs from "node:fs";
import path from "node:path";
import { MODELS } from "./config.mjs";
import { gatherFacts } from "./lib/wikipedia.mjs";
import { generate } from "./stages/generate.mjs";
import { classify } from "./stages/classify.mjs";
import { sourceImage, downloadImage } from "./stages/image.mjs";
import { gate } from "./stages/gate.mjs";
import { assemble } from "./stages/assemble.mjs";
import { TOPICS } from "./topics.mjs";

const ART = "/Users/sivajithcu/Movie News site/site/content/articles";
const STATE = "/Users/sivajithcu/Movie News site/site/data/state";
fs.mkdirSync(STATE, { recursive: true });
const DRY = process.argv.includes("--dry-run");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
const topics = ONLY ? TOPICS.filter((t) => t.id === ONLY) : TOPICS;
const BASE = new Date("2026-06-26T16:00:00Z").getTime();
const judge = MODELS.judgeBakeoff; // accurate gate for the validation run

let pub = 0, review = 0, err = 0;
for (let i = 0; i < topics.length; i++) {
  const topic = topics[i];
  const dateISO = new Date(BASE - i * 3 * 3600 * 1000).toISOString();
  const rec = { id: topic.id, slug: topic.slug, status: "started", stages: {} };
  const t0 = Date.now();
  try {
    console.log(`\n=== [${i + 1}/${topics.length}] ${topic.title} ===`);
    topic.facts = await gatherFacts([topic.primaryEntity, ...(topic.entities || [])].filter(Boolean));
    console.log(`  facts: ${topic.facts.length} blocks`);

    let article, classification, image, scored, src, pass = false;
    for (let attempt = 1; attempt <= 2 && !pass; attempt++) {
      ({ article } = await generate({ topic, model: MODELS.generator }));
      classification = await classify({ article, model: MODELS.classifier });
      const q = article.imageQuery || topic.primaryEntity || topic.title;
      src = await sourceImage(q);
      if (!src && topic.primaryEntity && topic.primaryEntity !== q) src = await sourceImage(topic.primaryEntity);
      image = src ? await downloadImage({ url: src.downloadUrl, slug: topic.slug }) : null;
      if (image && src) image.credit = src.credit;
      scored = await gate({ article, topic, judgeModel: judge });
      if (!image) scored.hardBlocks.push("no >=1200px image sourced");
      pass = scored.score >= 80 && scored.hardBlocks.length === 0;
      rec.stages[`attempt${attempt}`] = { score: scored.score, cat: `${classification.category}/${classification.subcategory}`, img: image?.image || null, hardBlocks: scored.hardBlocks };
      console.log(`  attempt ${attempt}: score ${scored.score} [${classification.category}/${classification.subcategory}] img:${image ? "yes" : "NO"} ${pass ? "PASS ✅" : "blocks:" + JSON.stringify(scored.hardBlocks)}`);
    }
    rec.scorecard = { score: scored.score, subscores: scored.subscores, strengths: scored.strengths, weaknesses: scored.weaknesses, deterministic: scored.deterministic, hardBlocks: scored.hardBlocks };
    if (pass) {
      const { slug, md } = assemble({ article, classification, image, topic, dateISO });
      if (!DRY) fs.writeFileSync(path.join(ART, slug + ".md"), md);
      rec.status = "published"; rec.score = scored.score; rec.category = classification.category; rec.subcategory = classification.subcategory; pub++;
      console.log(`  ✓ ${DRY ? "DRY (md not written)" : "WROTE " + slug + ".md"} [${classification.category}/${classification.subcategory}] score ${scored.score}`);
    } else {
      rec.status = "needs_review"; review++;
      console.log(`  → REVIEW QUEUE (score ${scored.score})`);
    }
    rec.ms = Date.now() - t0;
  } catch (e) {
    rec.status = "error"; rec.error = String(e?.stack || e).slice(0, 300); err++;
    console.log("  ERROR", rec.error);
  }
  fs.writeFileSync(path.join(STATE, topic.id + ".json"), JSON.stringify(rec, null, 2));
}
console.log(`\nDONE. published:${pub} review:${review} error:${err}. State in ${STATE}`);
