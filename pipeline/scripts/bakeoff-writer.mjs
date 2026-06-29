// DEV-ONLY writer bake-off (Step 1 of the 2026-06-29 rebuild). Runs each candidate WRITER through the REAL
// generate.mjs prompt path on the prepared verified bundles, then scores: quality (blind judge), cost, latency,
// one-pass JSON, and FABRICATIONS (programmatic receipt check + a judge audit vs ground truth). Not wired to runtime.
import fs from "node:fs";
import { generate } from "../stages/generate.mjs";
import { chat, USAGE } from "../lib/openrouter.mjs";

const BUNDLES = process.env.BUNDLES || "/private/tmp/claude-501/-Users-sivajithcu-Movie-News-site/f8bb6444-dd50-471f-8753-9b4af241679b/scratchpad/bundles.json";
const OUT = process.env.OUT || "/private/tmp/claude-501/-Users-sivajithcu-Movie-News-site/f8bb6444-dd50-471f-8753-9b4af241679b/scratchpad/bakeoff-results.json";
const RUNS = Number(process.env.RUNS || 2);

// live OpenRouter $/M [in, out] (confirmed 2026-06-29)
const RATE = {
  "deepseek/deepseek-v3.2": [0.229, 0.343],
  "deepseek/deepseek-v4-flash": [0.09, 0.18],
  "qwen/qwen3-235b-a22b-2507": [0.09, 0.10],
  "openai/gpt-4o-mini": [0.15, 0.60],
  "google/gemini-2.5-flash-lite": [0.10, 0.40],
};
const WRITERS = process.env.MODELS ? process.env.MODELS.split(",") : ["deepseek/deepseek-v3.2", "deepseek/deepseek-v4-flash", "qwen/qwen3-235b-a22b-2507"];
const JUDGE = "google/gemini-2.5-flash-lite";

const norm = (s) => String(s || "").toLowerCase().replace(/[‘’“”]/g, "'").replace(/\s+/g, " ").trim();

// Build a production-shaped topic from a prepared bundle.
function toTopic(b) {
  const map = {
    "Supergirl": { category: "movies", subcategory: "box-office", contentType: "box-office", primaryKeyword: "Supergirl box office" },
  };
  const isSupergirl = /supergirl/i.test(b.topic);
  const m = isSupergirl
    ? { category: "movies", subcategory: "box-office", contentType: "box-office", primaryKeyword: "Supergirl box office" }
    : { category: "movies", subcategory: "news", contentType: "news", primaryKeyword: "The Drama Zendaya Robert Pattinson" };
  const facts = [];
  for (const s of b.sources) {
    facts.push({ title: `${s.publisher} (${s.tier})`, extract: `${s.fullTextExcerpt} ${(s.quotes || []).join(" / ")}`.trim() });
  }
  facts.push({ title: "VERIFIED FACTS", extract: b.groundTruthFacts.map((f) => `${f.fact} [${f.confirmedBy}]`).join("; ") });
  return {
    topic: { ...m, title: b.topic, angle: b.whyTrending, facts },
    groundTruth: b.groundTruthFacts.map((f) => f.fact),
    factsText: norm(facts.map((f) => `${f.title} ${f.extract}`).join(" ")),
  };
}

function completeness(a) {
  const body = a?.body || "";
  const words = body.split(/\s+/).filter(Boolean).length;
  const h2 = (body.match(/^##\s+/gm) || []).length;
  const sources = /##\s*Sources/i.test(body);
  return { words, h2, sources, faq: (a?.faq || []).length, ok: (a?.faq || []).length >= 3 && words >= 350 && h2 >= 2 && sources };
}

// programmatic receipt check: every claims[].sourceQuote must be a real substring of the facts.
function receiptCheck(a, factsText) {
  const claims = a?.claims || [];
  let valid = 0, invalid = 0;
  const bad = [];
  for (const c of claims) {
    const q = norm(c?.sourceQuote);
    if (!q || q.length < 8) { invalid++; bad.push(c?.sourceQuote || "(empty)"); continue; }
    if (factsText.includes(q)) valid++; else { invalid++; bad.push(c?.sourceQuote); }
  }
  return { total: claims.length, valid, invalid, badReceipts: bad.slice(0, 6) };
}

async function judgeQuality(a) {
  const sys = `You are a tough magazine editor scoring an entertainment-news article on CRAFT ONLY (not factual accuracy). Score 0-100 on: answer-first lede, human voice (no AI tells/banned filler), varied rhythm, real structure (>=2 H2s incl. a reader question), information gain/POV, readability. 80 = publishable at a top outlet. Return JSON {"quality":<0-100>,"notes":"<=25 words"}. Be blind to who wrote it.`;
  const user = `TITLE: ${a?.title}\nDEK: ${a?.dek}\nKEY TAKEAWAYS: ${(a?.keyTakeaways || []).join(" | ")}\n\nBODY:\n${a?.body}\n\nReturn the JSON.`;
  try { const { data } = await chat({ model: JUDGE, system: sys, user, json: true, maxTokens: 400, temperature: 0 }); return data; }
  catch (e) { return { quality: null, notes: "judge error: " + e.message }; }
}

async function judgeFabrication(a, b) {
  const verified = b.groundTruthFacts.map((f) => `- ${f.fact} (per ${f.confirmedBy})`).join("\n") + "\n\nSOURCE TEXT:\n" +
    b.sources.map((s) => `[${s.publisher}] ${s.fullTextExcerpt} ${(s.quotes || []).join(" / ")}`).join("\n");
  const sys = `You are a STRICT fact-checker. You get the COMPLETE set of verified facts a writer was given, and their article. Find every CHECKABLE SPECIFIC in the article — a number/%, dollar figure, date/year, streaming platform, award win/nomination, chart position, runtime, film/TV credit, or a quoted statement — and mark each SUPPORTED (it appears in or directly restates the verified facts) or FABRICATED (no basis in the verified facts). A rounded restatement of a verified number is SUPPORTED; a specific not present in the verified facts is FABRICATED. Return JSON {"fabricationCount":<int>,"fabrications":["the specific + why it's unsupported", ...],"supportedCount":<int>}.`;
  const user = `VERIFIED FACTS:\n${verified}\n\nARTICLE:\nTITLE: ${a?.title}\nBODY:\n${a?.body}\nKEY TAKEAWAYS: ${(a?.keyTakeaways || []).join(" | ")}\nFAQ: ${(a?.faq || []).map((f) => f.q + " " + f.a).join(" | ")}\n\nReturn the JSON.`;
  try { const { data } = await chat({ model: JUDGE, system: sys, user, json: true, maxTokens: 900, temperature: 0 }); return data; }
  catch (e) { return { fabricationCount: null, fabrications: ["audit error: " + e.message] }; }
}

const results = [];
const bundles = JSON.parse(fs.readFileSync(BUNDLES, "utf8")).topics;
for (const b of bundles) {
  const T = toTopic(b);
  for (const model of WRITERS) {
    for (let run = 0; run < RUNS; run++) {
      const tag = `${model}  |  ${b.topic.slice(0, 28)}  |  run${run + 1}`;
      const before = USAGE.length;
      const t0 = Date.now();
      let rec = { model, bundle: b.topic, run: run + 1 };
      try {
        const { article } = await generate({ topic: T.topic, model });
        const ms = Date.now() - t0;
        const calls = USAGE.length - before; // 1 = one-pass, 2 = needed the completeness retry
        let cost = 0;
        for (const u of USAGE.slice(before)) { const [ri, ro] = RATE[u.model] || [0, 0]; cost += ((u.prompt_tokens || 0) * ri + (u.completion_tokens || 0) * ro) / 1e6; }
        const comp = completeness(article);
        const rc = receiptCheck(article, T.factsText);
        const q = await judgeQuality(article);
        const fab = await judgeFabrication(article, b);
        rec = { ...rec, ms, calls, onePass: calls === 1, cost, completeness: comp, receipts: rc, quality: q?.quality ?? null, qualityNotes: q?.notes, fabricationCount: fab?.fabricationCount ?? null, fabrications: fab?.fabrications || [], title: article?.title, body: article?.body, claimsCount: (article?.claims || []).length, _article: article };
        console.log(`✓ ${tag}  q=${rec.quality} fab=${rec.fabricationCount} badReceipts=${rc.invalid}/${rc.total} ${rec.onePass ? "1pass" : calls + "calls"} ${(ms / 1000).toFixed(1)}s $${cost.toFixed(5)}`);
      } catch (e) {
        rec = { ...rec, error: e.message };
        console.log(`✗ ${tag}  ERROR ${e.message}`);
      }
      results.push(rec);
      fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    }
  }
}

// ── summary ───────────────────────────────────────────────────────────────────────────────────
const byModel = {};
for (const r of results) {
  if (r.error) continue;
  const m = (byModel[r.model] ||= { n: 0, q: 0, fab: 0, badR: 0, onePass: 0, cost: 0, ms: 0 });
  m.n++; m.q += r.quality || 0; m.fab += r.fabricationCount || 0; m.badR += r.receipts.invalid; m.onePass += r.onePass ? 1 : 0; m.cost += r.cost; m.ms += r.ms;
}
console.log("\n===== WRITER BAKE-OFF SUMMARY (avg over runs × bundles) =====");
console.log("model".padEnd(34), "quality", "fab/art", "badRcpt", "1pass", "$/art", "sec/art");
for (const [model, m] of Object.entries(byModel)) {
  console.log(model.padEnd(34), String((m.q / m.n).toFixed(1)).padStart(7), String((m.fab / m.n).toFixed(2)).padStart(7), String((m.badR / m.n).toFixed(2)).padStart(7), `${m.onePass}/${m.n}`.padStart(5), ("$" + (m.cost / m.n).toFixed(5)).padStart(8), String((m.ms / m.n / 1000).toFixed(1)).padStart(7));
}
console.log("\nfull results + article bodies:", OUT);
