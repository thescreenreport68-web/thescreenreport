// The work-file (plan §3) — one job travels down the agent line; each agent fills its
// slice. Persisted after every stage so a crashed run resumes with zero re-spend.
import path from "node:path";
import { IG } from "./config.mjs";
import { readJson, writeJson, ensureDir } from "./lib/util.mjs";
import { recordHold } from "./lib/ledger.mjs";

export const STAGES = [
  "scout", "gather", "verify", "sensitive", "engage", "script", "caption", "pronounce",
  "voice", "align", "shots", "framing", "music", "subs", "render",
  "synccheck", "cover", "watchqc", "publish",
]; // engage runs BEFORE script: the writer crafts the ending around the chosen ask

export function jobPath(slug) {
  return path.join(IG.workDir, slug, "job.json");
}

export function newJob(article) {
  return {
    id: article.slug,
    createdAt: new Date().toISOString(),
    article,
    stage: "scout",
    done: [],
    hold: null, // { stage, reason } — machine-readable, never silent
    scout: null, facts: null, verify: null, sensitive: null,
    script: null, caption: null, shots: null, audio: {}, render: {}, qc: {},
    publish: null,
    costs: { usd: 0, calls: [] },
    log: [],
  };
}

export function loadJob(slug) {
  return readJson(jobPath(slug), null);
}

export function saveJob(job) {
  ensureDir(path.dirname(jobPath(job.id)));
  writeJson(jobPath(job.id), job);
  return job;
}

export function jlog(job, stage, note) {
  job.log.push(`${new Date().toISOString()} ${stage}: ${note}`);
  if (job.log.length > 400) job.log = job.log.slice(-400);
}

export function holdJob(job, stage, reason) {
  job.hold = { stage, reason, at: new Date().toISOString() };
  jlog(job, stage, `HOLD — ${reason}`);
  recordHold(job.id, stage, reason); // holds ledger persists across CI runs (work/ does not)
  return saveJob(job);
}

export function stageDone(job, stage) {
  if (!job.done.includes(stage)) job.done.push(stage);
  const idx = STAGES.indexOf(stage);
  job.stage = STAGES[idx + 1] || "done";
  return saveJob(job);
}

export function workDirFor(slug) {
  return ensureDir(path.join(IG.workDir, slug));
}
export function outDirFor() {
  return ensureDir(IG.outDir);
}
