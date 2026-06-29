// FIND-engine state + run MONITOR. Everything is plain inspectable JSON under site/data/find/ so the
// whole process can be watched and audited (Cloudflare D1 is the cloud path later). The monitor is
// the observability layer: it records what every stage discovered/decided and verifies each article's
// data is COMPLETE before it is allowed to publish.
import fs from "node:fs";
import path from "node:path";

const DIR = "/Users/sivajithcu/Movie News site/site/data/find";
fs.mkdirSync(path.join(DIR, "runs"), { recursive: true });
const fp = (f) => path.join(DIR, f);

export const readJSON = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(fp(f), "utf8"));
  } catch {
    return d;
  }
};
export const writeJSON = (f, v) => fs.writeFileSync(fp(f), JSON.stringify(v, null, 2));

// A run monitor — the single source of truth for "what the automation did this run".
export function newMonitor(runId) {
  const m = {
    runId,
    startedAt: new Date().toISOString(),
    counts: {},
    stages: [], // { stage, t, msg, data? }
    articles: [], // per-topic: the full lifecycle (find -> research -> write -> gate -> publish)
  };
  const stamp = () => new Date().toISOString().slice(11, 19);
  return {
    raw: m,
    // a pipeline-level event
    stage(stage, msg, data) {
      m.stages.push({ stage, t: stamp(), msg, ...(data !== undefined ? { data } : {}) });
      console.log(`  [${stage}] ${msg}`);
    },
    count(k, v) {
      m.counts[k] = v;
    },
    // begin tracking one topic through the whole pipeline; returns a per-article recorder
    article(topic) {
      const a = {
        id: topic.id,
        slug: topic.slug,
        title: topic.title,
        category: topic.category,
        subcategory: topic.subcategory,
        formatTag: topic.formatTag,
        source: topic.source,
        steps: [],
        checks: {},
        status: "started",
      };
      m.articles.push(a);
      return {
        step(name, msg, data) {
          a.steps.push({ step: name, t: stamp(), msg, ...(data !== undefined ? { data } : {}) });
          console.log(`    ↳ ${topic.id} · ${name}: ${msg}`);
        },
        // record a pre-publish completeness check (true = collected ok)
        check(name, ok, detail) {
          a.checks[name] = { ok: !!ok, detail };
          if (!ok) console.log(`    ⚠ ${topic.id} · check FAILED: ${name}${detail ? " — " + detail : ""}`);
        },
        done(status, extra = {}) {
          a.status = status;
          Object.assign(a, extra);
        },
      };
    },
    finish(queueLen) {
      m.finishedAt = new Date().toISOString();
      m.queueLength = queueLen;
      writeJSON(`runs/${runId}.json`, m);
      writeJSON("runs/latest.json", m);
      return m;
    },
  };
}

// Human-readable one-screen summary of a finished run (the "what happened" view).
export function printRunReport(m) {
  console.log("\n================ FIND-ENGINE RUN REPORT ================");
  console.log(`run ${m.runId}  ·  ${m.startedAt} → ${m.finishedAt || "(unfinished)"}`);
  console.log("counts:", JSON.stringify(m.counts));
  console.log(`\nArticles attempted: ${m.articles.length}`);
  for (const a of m.articles) {
    const failedChecks = Object.entries(a.checks).filter(([, v]) => !v.ok).map(([k]) => k);
    const mark = a.status === "published" ? "✅" : a.status === "needs_review" ? "🟡" : "✗";
    console.log(
      `  ${mark} [${a.formatTag || "?"}] ${a.category}/${a.subcategory}  ${a.id}` +
        (a.score ? `  score ${a.score}` : "") +
        (failedChecks.length ? `  ⚠ incomplete: ${failedChecks.join(",")}` : "")
    );
  }
  console.log("=======================================================\n");
}
