#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// THE ORCHESTRATOR (plan §2.2 #27, §6) — deterministic Node, no LLM in the control
// path. Drives the work-file through every agent with per-stage watchdogs, resumable
// jobs, ledgers, caps, kill switch, and cost metering. One bad story never kills a run.
//
// USAGE (from site/):
//   node pipeline/ig/igrun.mjs --dry                    # scout only — what WOULD run
//   node pipeline/ig/igrun.mjs --limit=1                # build video(s), publish as DRAFT
//   node pipeline/ig/igrun.mjs --slug=<slug>            # force one article
//   node pipeline/ig/igrun.mjs --limit=1 --no-publish   # build only, nothing sent anywhere
//   node pipeline/ig/igrun.mjs --limit=3 --live         # REAL scheduled posts (cron mode)
//   node pipeline/ig/igrun.mjs --analytics              # collect insights
//   node pipeline/ig/igrun.mjs --learn                  # weekly strategy learner
// Secrets: loaded from the parent .env automatically when run locally.
// ═══════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import { IG, SITE } from "./config.mjs";
import { costSpent, costCalls, costReset } from "./models.mjs";
import { newJob, loadJob, saveJob, jlog, holdJob, stageDone, workDirFor } from "./job.mjs";
import { ensureDir, todayInTz, normWords, parseFrontmatter, stripMarkdown } from "./lib/util.mjs";
import { isPaused, recordPosted, recordBuilt, topicKey, postedToday, scheduledSlotsToday, isPosted, recordHold, isHeld, loadPosted, savePosted } from "./lib/ledger.mjs";
import { lintManifest } from "./lib/lint.mjs";
import { estimateSeconds } from "./lib/lint.mjs";

import { scout, listCandidates } from "./agents/scout.mjs";
import { gather } from "./agents/gather.mjs";
import { verify } from "./agents/verify.mjs";
import { enrich } from "./agents/enrich.mjs";
import { sensitiveGate } from "./agents/sensitive.mjs";
import { writeScript } from "./agents/script.mjs";
import { pronounce } from "./agents/pronounce.mjs";
import { writeCaption, assembleFull } from "./agents/caption.mjs";
import { writePlatformMeta } from "./agents/platformMeta.mjs";
import { pickGoal, ASK_FAMILIES } from "./agents/engage.mjs";
import { buildBeats } from "./agents/scenes.mjs";
import { synthVoice, kokoroFallback, judgeTake, gapStats, scoreTake, passesFloor } from "./agents/voice.mjs";
import { align, sentenceWindows as sentenceWindowsSafe, alignDisplayWords as alignDisplayWordsSafe } from "./agents/align.mjs";
import { buildShots } from "./agents/shots.mjs";
import { pickMusic } from "./agents/music.mjs";
import { styleEmphasis, buildAss } from "./agents/subs.mjs";
import { render } from "./agents/render.mjs";
import { makeCover } from "./agents/cover.mjs";
import { watchQC } from "./agents/watchqc.mjs";
import { publish, verifyLive } from "./agents/publish.mjs";
import { planSlots, upcomingSlotsToday } from "./agents/slots.mjs";
import { collect } from "./agents/analytics.mjs";
import { learn } from "./agents/learner.mjs";

// ── env: load the parent .env locally (CI provides real env vars) ───────────────
function loadEnv() {
  const envPath = path.join(path.dirname(SITE), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

// ── per-stage watchdog: promise timeout + park-not-crash ────────────────────────
async function stageRun(job, stage, fn, timeoutMs) {
  const t0 = Date.now();
  let timer;
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`watchdog ${timeoutMs}ms`)), timeoutMs); }),
    ]);
    jlog(job, stage, `ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return { ok: true, result };
  } catch (e) {
    jlog(job, stage, `FAIL: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// per-JOB cost attribution + both cap tiers. JOB cap = park THIS job (distinct error kind
// caught by processJob → holdJob → continue). RUN cap = stop the whole run. (audit 2026-07-11)
class JobCapError extends Error {}
class RunCapError extends Error {}
function costGuard(job) {
  const jobUsd = costSpent() - (job.costs.baseline ?? 0);
  job.costs.usd = +jobUsd.toFixed(4);
  job.costs.calls = costCalls().length;
  if (jobUsd > IG.maxJobUsd) throw new JobCapError(`job cost $${jobUsd.toFixed(3)} > $${IG.maxJobUsd}`);
  if (costSpent() > IG.maxRunUsd) throw new RunCapError(`RUN COST CAP $${costSpent().toFixed(3)} > $${IG.maxRunUsd}`);
}

// ── one job through the whole line ──────────────────────────────────────────────
async function processJob(article, { skipStages = new Set() } = {}) {
  let job = loadJob(article.slug);
  if (job?.hold) return job; // parked previously — operator decision to clear
  if (!job) job = saveJob(newJob(article));
  job.article = { ...job.article, ...article };
  job.costs.baseline = costSpent() - (job.costs.usd || 0); // cumulative across resumes
  const doneSet = new Set(job.done);
  const need = (s) => !doneSet.has(s) && !skipStages.has(s);

  // 2 GATHER
  if (need("gather")) {
    const r = await stageRun(job, "gather", () => gather(job.article), 120000);
    if (!r.ok) return holdJob(job, "gather", r.error);
    job.facts = r.result;
    stageDone(job, "gather");
  }
  // 3 VERIFY
  if (need("verify")) {
    const r = await stageRun(job, "verify", async () => {
      let result = await verify(job.facts);
      // ENRICH thin stories (owner 2026-07-12): if OUR article alone yields too few verified facts
      // to fill a reel, pull MORE verified facts about the SAME people/event from related news, then
      // RE-VERIFY (the added facts are entailment-checked against the coverage they came from, so
      // nothing unsupported survives). Only runs when thin; fully best-effort (never throws).
      if (result.facts.length < (IG.enrich?.minFacts ?? 6)) {
        const added = await enrich(job.facts);
        if (added.count) {
          jlog(job, "verify", `thin (${result.facts.length}) → enrich +${added.count} related facts → re-verify`);
          result = await verify(job.facts);
          job.enrich = { added: added.count, kept: result.facts.length, queries: added.queries };
        }
      }
      return result;
    }, 200000);
    if (!r.ok) return holdJob(job, "verify", r.error);
    if (r.result.hold) return holdJob(job, "verify", r.result.hold);
    job.facts.facts = r.result.facts;
    job.verify = { cuts: r.result.cuts.length };
    stageDone(job, "verify");
  }
  // 4 SENSITIVITY
  if (need("sensitive")) {
    const r = await stageRun(job, "sensitive", () => sensitiveGate(job.article, job.facts), 60000);
    if (!r.ok) return holdJob(job, "sensitive", r.error);
    if (r.result.decision === "block") return holdJob(job, "sensitive", r.result.reason);
    job.sensitive = r.result;
    stageDone(job, "sensitive");
  }
  const mood = job.sensitive?.decision === "somber" ? "somber" : job.facts.mood || "neutral";
  // ENGAGE v2 (runs BEFORE the writer): pick the goal; the WRITER crafts the ending
  if (need("engage")) {
    const r = await stageRun(job, "engage", () => pickGoal({ facts: job.facts, segment: job.scout?.segment }), 90000);
    job.engage = r.ok ? r.result : { goal: "comments", family: ASK_FAMILIES.comments, cta: "", firstComment: "" };
    jlog(job, "engage", `goal=${job.engage.goal}${job.engage.why ? ` (${job.engage.why})` : ""}`);
    stageDone(job, "engage");
  }
  // 5+6 SCRIPT (writer + lint incl. the ending gate: question → matching ask, one beat)
  if (need("script")) {
    const r = await stageRun(job, "script", () => writeScript({ article: job.article, facts: job.facts, segment: job.scout?.segment, engage: job.engage }), 240000);
    if (!r.ok) return holdJob(job, "script", r.error);
    if (r.result.hold) return holdJob(job, "script", r.result.hold);
    job.script = r.result.script;
    stageDone(job, "script");
  }
  costGuard(job);
  // 8+9 CAPTION (writer + lint loop inside; CTA + firstComment align to the goal)
  if (need("caption")) {
    const ctaIndex = normWords(job.id).length % 3;
    const r = await stageRun(job, "caption", () => writeCaption({ facts: job.facts, segment: job.scout?.segment, ctaIndex, engage: job.engage }), 120000);
    if (!r.ok) return holdJob(job, "caption", r.error);
    if (r.result.hold) return holdJob(job, "caption", r.result.hold);
    job.caption = r.result.caption;
    if (job.engage?.cta) job.caption.cta = job.engage.cta;
    if (job.engage?.firstComment) job.caption.firstComment = job.engage.firstComment;
    job.caption.full = assembleFull(job.caption); // shared assembler — keeps the AI-assisted disclosure
    stageDone(job, "caption");
  }
  // 8b PLATFORM METADATA — Facebook + YouTube copy (Instagram keeps its own caption above). One call,
  // two platform-native outputs. Best-effort: a failure just skips FB/YT for this story, never holds
  // and never touches the IG path. (multi-platform 2026-07-13)
  if (need("platformMeta")) {
    const cat = job.article?.category;
    const articleUrl = cat ? `${IG.siteBase}/${cat}/${job.id}/` : "";
    const r = await stageRun(job, "platformMeta", () => writePlatformMeta({ facts: job.facts, segment: job.scout?.segment, engage: job.engage, articleUrl }), 90000);
    if (r.ok && r.result?.meta) job.platformMeta = r.result.meta;
    else { job.platformMeta = null; jlog(job, "platformMeta", `⚠ ${r.error || r.result?.hold || "no metadata"} — FB/YT skipped for this story`); }
    stageDone(job, "platformMeta");
  }
  // 7 PRONOUNCE
  if (need("pronounce")) {
    const r = await stageRun(job, "pronounce", () => pronounce(job.script.sentences, job.facts.entities), 90000);
    if (!r.ok) return holdJob(job, "pronounce", r.error);
    job.script.speakable = r.result.speakable;
    stageDone(job, "pronounce");
  }
  costGuard(job);
  // 13 VOICE (before shots — timestamps drive the shot plan). v2: bake-off + pause
  // tightening + the listening judge; the take must clear the delivery floor.
  if (need("voice")) {
    const r = await stageRun(job, "voice", () => synthVoice({ slug: job.id, speakable: job.script.speakable, mood }), 1800000);
    if (!r.ok) return holdJob(job, "voice", r.error);
    job.audio.voice = r.result;
    if (r.result.judge)
      jlog(job, "voice", `${r.result.voice} score ${r.result.score}/30 (flow ${r.result.judge.flow} energy ${r.result.judge.energy} pauses ${r.result.judge.pauseQuality}, gaps ${r.result.gaps.count})${r.result.belowFloor ? " — BELOW FLOOR (best available)" : ""}`);
    if (r.result.belowFloor) {
      // the listening judge is a reliable RANKER but a noisy absolute gate (same setup
      // scored 14-22 across takes today). Truly bad takes still hold; a best-take in
      // the noise band ships with a loud warning — the final watch-QC and the owner
      // remain the last gates. Kokoro never gets this leniency (owner rejected it).
      const tooBad = (r.result.score ?? 0) < (IG.voice.hardFloorScore ?? 12) || r.result.engine === "kokoro";
      if (tooBad) return holdJob(job, "voice", `no take cleared the delivery floor (best: ${r.result.voice} ${r.result.score}/30 — ${r.result.judge?.worstMoment || ""})`);
      const w = `voice below floor: best take ${r.result.voice} ${r.result.score}/30 shipped (${r.result.judge?.worstMoment || ""})`;
      job.warnings = [...(job.warnings || []), w];
      jlog(job, "voice", `⚠ ${w}`);
      console.warn(`  ⚠ ${w}`);
    }
    // total-API-outage fallback (engine=kokoro straight from synthVoice) must ALSO pass
    // the ear — the flat voice never ships unjudged (owner rule, no compromises)
    if (r.result.engine === "kokoro" && !r.result.judge) {
      const kj = await judgeTake(r.result.wav).catch(() => null);
      const kg = gapStats(r.result.wav);
      if (kj && !passesFloor(kj, kg))
        return holdJob(job, "voice", `speech API unavailable and Kokoro fallback scores ${scoreTake(kj, kg)}/30 — below the delivery floor`);
      job.audio.voice.judge = kj || undefined;
    }
    stageDone(job, "voice");
  }
  // 14 VERBATIM + ALIGN (whisper wall).
  // Pure whisper DRIFT on a take that already passed the provider-transcript check AND
  // the ear-judge is transcription noise (hard names), NOT an ad-lib — accept with a
  // warning. Only ad-lib/length/empty verdicts force the Kokoro fallback, and a Kokoro
  // fallback must itself clear the delivery floor (never silently ship the flat voice).
  if (need("align")) {
    const r = await stageRun(job, "align", async () => {
      // the voice bake-off already whisper-verified the winner — reuse that transcription
      let a = align({ wav: job.audio.voice.wav, speakable: job.script.speakable, displaySentences: job.script.sentences, preWhisper: job.audio.voice.whisper || null });
      // Pure DRIFT (kind==="drift", not insert/length) is whisper mishearing, never a
      // fabrication: accept it for a gpt take (provider transcript was verbatim) AND for a
      // Kokoro take (deterministic TTS reads the exact words — it CANNOT ad-lib). (audit)
      if (!a.verdict.pass && a.verdict.kind === "drift" && (job.audio.voice.verbatimPre === "pass" || job.audio.voice.engine === "kokoro")) {
        jlog(job, "align", `whisper ${a.verdict.reason} ACCEPTED (${job.audio.voice.engine}: not an ad-lib)`);
        a.verdict = { ...a.verdict, pass: true, accepted: "drift-noise" };
        a.windows = sentenceWindowsSafe(job.script.sentences, a.whisper.words);
        a.displayWords = alignDisplayWordsSafe(job.script.sentences, a.whisper.words);
      }
      if (!a.verdict.pass && job.audio.voice.engine !== "kokoro") {
        jlog(job, "align", `verbatim FAIL on ${job.audio.voice.engine} (${a.verdict.reason}) → Kokoro fallback`);
        job.audio.voice = kokoroFallback({ slug: job.id, text: job.script.speakable.join(" ") });
        const kj = await judgeTake(job.audio.voice.wav).catch(() => null);
        const kg = gapStats(job.audio.voice.wav);
        if (kj && !passesFloor(kj, kg))
          throw new Error(`gpt take failed verbatim (${a.verdict.reason}) and Kokoro scores ${scoreTake(kj, kg)}/30 — below the delivery floor`);
        a = align({ wav: job.audio.voice.wav, speakable: job.script.speakable, displaySentences: job.script.sentences });
      }
      if (!a.verdict.pass) throw new Error(`verbatim wall failed on both engines: ${a.verdict.reason}`);
      return a;
    }, 600000);
    if (!r.ok) return holdJob(job, "align", r.error);
    // canonical word stream = SCRIPT spelling + whisper timing (subs are machine-read;
    // whisper mishears names — "Kelce"→"Kelsey" — and entity-sync must match the script)
    job.audio.words = r.result.displayWords?.length ? r.result.displayWords : r.result.whisper.words;
    job.audio.durationSec = r.result.whisper.duration;
    job.audio.windows = r.result.windows;
    job.audio.verbatim = r.result.verdict.reason;
    // owner floor: ~25s minimum. Kept 1s below minSec so a fast read of a floor-length script
    // (90 words ≈ 24.3s at the fast ~3.7wps pace) SHIPS rather than passing the word floor and
    // then dying here — the two floors must agree. Typical reads land 25-40s. (2026-07-11)
    if (job.audio.durationSec < IG.script.minSec - 1)
      return holdJob(job, "align", `spoken duration ${job.audio.durationSec.toFixed(1)}s < ${IG.script.minSec}s floor (script ${normWords(job.script.sentences.join(" ")).length} words)`);
    stageDone(job, "align");
  }
  const durationSec = job.audio.durationSec || estimateSeconds(normWords(job.script.sentences.join(" ")).length);
  // 10-12 SHOTS (+ image gate + framing) — beat-driven (Scene Director), composite-capable
  if (need("shots")) {
    const beats = buildBeats({ sentences: job.script.sentences, windows: job.audio.windows || [], entities: job.facts.entities });
    let articleBodyRaw = "";
    try {
      articleBodyRaw = fs.readFileSync(path.join(IG.articlesDir, `${job.id}.md`), "utf8");
    } catch {}
    const r = await stageRun(job, "shots", () => buildShots({ job, words: job.audio.words, duration: durationSec, beats, articleBodyRaw }), 480000);
    if (!r.ok) return holdJob(job, "shots", r.error);
    if (r.result.hold) return holdJob(job, "shots", r.result.hold);
    job.shots = r.result.shots;
    job.shotsMeta = { primary: r.result.primary, imageCount: r.result.imageCount, sourcing: r.result.sourcing };
    job.warnings = [...(job.warnings || []), ...(r.result.warnings || [])];
    for (const w of r.result.warnings || []) { jlog(job, "shots", `⚠ ${w}`); console.warn(`  ⚠ ${w}`); }
    stageDone(job, "shots");
  }
  costGuard(job);
  // 15 MUSIC
  if (need("music")) {
    const r = await stageRun(job, "music", () => pickMusic({ facts: job.facts, mood, segment: job.scout?.segment }), 240000);
    if (!r.ok) job.audio.music = { none: true, reason: r.error };
    else job.audio.music = r.result;
    stageDone(job, "music"); // music is garnish — never a hold
  }
  // 16 SUBS
  if (need("subs")) {
    const r = await stageRun(job, "subs", async () => {
      const emphasis = await styleEmphasis(job.script.sentences, job.facts.entities);
      return buildAss({ slug: job.id, words: job.audio.words, sentenceWindows: job.audio.windows, emphasisSets: emphasis });
    }, 120000);
    if (!r.ok) return holdJob(job, "subs", r.error);
    job.render.assFile = r.result;
    stageDone(job, "subs");
  }
  // 17 RENDER
  if (need("render")) {
    const r = await stageRun(job, "render", async () =>
      render({
        slug: job.id,
        shots: job.shots,
        assFile: job.render.assFile,
        mood,
        voiceWav: job.audio.voice.wav,
        musicFile: job.audio.music?.file || null,
        durationSec,
      }), 900000);
    if (!r.ok) return holdJob(job, "render", r.error);
    job.render.mp4 = r.result;
    stageDone(job, "render");
  }
  // 18 SYNC CHECK — no-shots/coverage always hard; entity-sync hard when systematic (≥3)
  if (need("synccheck")) {
    const violations = lintManifest(job.shots, job.audio.words, durationSec, job.facts.entities);
    const hard = violations.filter((v) => ["no-shots", "coverage"].includes(v.rule));
    const syncViolations = violations.filter((v) => v.rule === "entity-sync");
    // Count DISTINCT spoken beats, not raw mentions: one sentence that names several people
    // at the same instant (a family roster, a cast list) is ONE unavoidable miss, not a
    // systematic composer failure — it should never HOLD a fully-rendered video. Hold only
    // when ≥3 SEPARATE beats miss their subject (a genuinely broken manifest). (2026-07-11)
    const syncBeats = new Set(syncViolations.map((v) => (v.detail.match(/at ([\d.]+)s/) || [, ""])[1]));
    if (syncBeats.size >= 3) hard.push(...syncViolations);
    job.qc.sync = { violations, pass: hard.length === 0 };
    jlog(job, "synccheck", violations.length ? violations.map((v) => v.rule).join(",") : "clean");
    if (hard.length) return holdJob(job, "synccheck", hard.map((v) => `${v.rule}: ${v.detail}`).join("; "));
    stageDone(job, "synccheck");
  }
  // 19 COVER
  if (need("cover")) {
    const r = await stageRun(job, "cover", () => makeCover({ job, shots: job.shots }), 120000);
    if (r.ok) job.render.cover = r.result.file, (job.render.coverHeadline = r.result.headline);
    else job.render.cover = null; // garnish — publisher falls back to thumb offset
    stageDone(job, "cover");
  }
  // 20 WATCH-QC (fix loop = re-render once on fixable issues, then hold)
  if (need("watchqc")) {
    const r = await stageRun(job, "watchqc", () => watchQC({ job, mp4: job.render.mp4, expectedSec: durationSec + 1.0 }), 300000);
    if (!r.ok) return holdJob(job, "watchqc", r.error);
    job.qc.watch = r.result;
    if (r.result.verdict !== "publish") return holdJob(job, "watchqc", `QC ${r.result.verdict}: ${r.result.reasons.join("; ")} (score ${r.result.score})`);
    stageDone(job, "watchqc");
  }
  costGuard(job);
  return saveJob(job);
}

// ── the run ─────────────────────────────────────────────────────────────────────
async function main() {
  loadEnv();
  costReset();
  ensureDir(IG.dataDir); ensureDir(IG.workDir); ensureDir(IG.outDir); ensureDir(IG.runsDir);

  if (isPaused()) { console.log("⏸  PAUSED file present — exiting."); return; }

  if (args.analytics) { const rows = await collect(); console.log(`analytics: ${rows.length} rows collected`); return; }
  if (args.learn) { const res = learn(); console.log("learner:", JSON.stringify(res.updated ? res.weights.accountMedians : res.reason)); return; }
  if (args.verify) {
    // post-slot live verification for EVERY scheduled post (plan agent 21) — cron-able
    const ledger = loadPosted();
    let failures = 0;
    for (const p of ledger.posts) {
      if (p.mode !== "scheduled" || p.verifiedLive || !p.zernioId) continue;
      const due = p.whenISO && new Date(p.whenISO).getTime() + 10 * 60000 < Date.now();
      if (!due) continue;
      const v = await verifyLive(p.zernioId, { timeoutMin: 2, everySec: 30 });
      if (v.live) { p.verifiedLive = true; p.permalink = v.permalink; console.log(`  ✔ live: ${p.slug} ${v.permalink || ""}`); }
      else { p.verifyFailures = (p.verifyFailures || 0) + 1; failures++; console.error(`  ✖ NOT live: ${p.slug} (${JSON.stringify(v).slice(0, 120)})`); }
    }
    savePosted(ledger);
    if (failures) process.exitCode = 1; // GH Actions notifies the owner
    console.log(`verify: done (${failures} failures)`);
    return;
  }

  const live = Boolean(args.live);
  const noPublish = Boolean(args["no-publish"]);
  // --now: publish the built reel ~immediately (a few minutes out) instead of the next LA slot. For a
  // manual "prove it posts" test only; the scheduled crons never pass it. (owner 2026-07-13)
  const publishNow = Boolean(args.now);
  // --platforms=instagram,facebook,youtube overrides the enabled set for THIS run only (in-memory) —
  // for owner-approved test posts to Facebook/YouTube before flipping the config default. (2026-07-13)
  if (args.platforms) { IG.platforms = String(args.platforms).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean); console.log(`  platforms override: ${IG.platforms.join(", ")}`); }
  // limit = candidates to ATTEMPT (capped at the hard daily cap, NOT maxPerDay) — a build-ahead run
  // needs to try MORE than 7 to actually SHIP 7 when some hold. targetPosts below is what caps at 7.
  const limit = Math.min(parseInt(args.limit || "1", 10), IG.hardDailyCap);
  // --posts = how many videos this run should actually BUILD+schedule (stop after N successes even if
  // the slate is larger — a per-slot cron uses --limit=4 --posts=1: attempt up to 4 candidates, ship
  // the first that builds). Defaults to --limit for back-compat. (owner 2026-07-13)
  const targetPosts = Math.min(parseInt(args.posts || String(limit), 10), IG.maxPerDay);

  // slate
  let slate;
  if (args.slug) {
    // --slug NEVER bypasses the never-repost ledger (require --force to override),
    // and metadata always comes from the REAL article file — never fabricated.
    if (isPosted(args.slug) && !args.force) {
      console.log(`⛔ ${args.slug} is already in a posted ledger — refusing (use --force to override).`);
      return;
    }
    const artPath = path.join(IG.articlesDir, `${args.slug}.md`);
    if (!fs.existsSync(artPath)) { console.log(`⛔ no such article: ${args.slug}`); return; }
    const { data } = parseFrontmatter(fs.readFileSync(artPath, "utf8"));
    const cand = {
      slug: args.slug,
      title: stripMarkdown(data.title || args.slug),
      category: String(data.category || "movies").toLowerCase(),
      date: data.date || new Date().toISOString(),
      heroImage: data.heroImage || data.image || null,
      sourceUrls: Array.isArray(data.sourceUrls) ? data.sourceUrls : [],
    };
    slate = [{ ...cand, score: 100, sendability: 8, breaking: false, segment: "Casting Watch" }];
  } else {
    // a momentary OpenRouter/discovery outage must NOT crash the unattended workflow —
    // treat a scout failure as "no candidates today" (the run exits cleanly). (audit 2026-07-11)
    try {
      slate = await scout({ limit, lane: args.lane });
    } catch (e) {
      console.error(`scout failed (${e.message}) — no slate this run`);
      return;
    }
  }
  if (args.dry) {
    console.log(JSON.stringify(slate.map((s) => ({ slug: s.slug, score: s.score, sendability: s.sendability, segment: s.segment, breaking: s.breaking })), null, 2));
    return;
  }
  if (!slate.length) { console.log("scout: no viable candidates today"); return; }

  // caps + per-slot guard (live only). 7-runs-per-day model (owner 2026-07-13): each run fills the
  // NEXT EMPTY slot, so the guard is per-SLOT (never double-fill a taken slot) + a daily count — NOT
  // the old one-whole-day flag, which would have made runs 2-7 exit as "already scheduled".
  const day = todayInTz(IG.slots.postTz);
  let filledSlots = [];
  let effectivePosts = targetPosts; // no-publish/--now: no slot capping
  if (live && !publishNow) {
    filledSlots = scheduledSlotsToday(day);
    if (filledSlots.length >= IG.slots.primeET.length) { console.log(`all ${IG.slots.primeET.length} slots for ${day} already filled — exiting (double-post guard)`); return; }
    if (postedToday() >= IG.hardDailyCap) { console.log("daily hard cap reached — exiting"); return; }
    // BUILD-AHEAD cap: only build as many reels as there are slots still UPCOMING today so a run never
    // spills into tomorrow's slots (which would record the wrong scheduledDay). (owner 2026-07-14)
    const slotsLeftToday = upcomingSlotsToday(new Date(), filledSlots).length;
    if (slotsLeftToday < 1) { console.log(`no slots left upcoming today (${day}) — exiting`); return; }
    effectivePosts = Math.min(targetPosts, slotsLeftToday);
  }

  // build every job
  const built = [];
  for (const cand of slate) {
    console.log(`\n━━ ${cand.slug} (${cand.segment}, score ${cand.score})`);
    let job = loadJob(cand.slug) || saveJob(newJob(cand));
    job.scout = { score: cand.score, sendability: cand.sendability, breaking: cand.breaking, segment: cand.segment };
    saveJob(job);
    try {
      job = await processJob(cand);
    } catch (e) {
      if (e instanceof RunCapError) { console.error(`  ${e.message} — stopping the run`); break; }
      if (e instanceof JobCapError) {
        // park THIS job (recorded so scout skips it next run) and keep going — one
        // expensive story must never kill the run or silently re-charge every run
        console.error(`  ${e.message} — parking this story`);
        holdJob(loadJob(cand.slug) || saveJob(newJob(cand)), "cost", e.message);
        continue;
      }
      console.error(`  run-level error: ${e.message}`);
      continue;
    }
    if (job.hold) { console.log(`  ⏸ HOLD at ${job.hold.stage}: ${job.hold.reason}`); continue; }
    console.log(`  ✅ built: ${job.render.mp4} (QC ${job.qc.watch?.score})`);
    // never rebuild this story, and record its TOPIC (title + real entity names) so the scout
    // skips other reels about the SAME event next run (topic dedup, not just slug dedup)
    recordBuilt(job.id, topicKey(`${job.article?.title || job.id} ${(job.facts?.entities || []).map((e) => e.name).join(" ")}`));
    built.push(job);
    if (built.length >= effectivePosts) break; // built enough for today's remaining slots — stop, don't over-build
  }

  // publish
  let anyPublished = false;
  if (built.length && !noPublish) {
    const slots = publishNow ? [] : planSlots(built, { filledSlots });
    for (const job of built) {
      const slot = slots.find((s) => s.slug === job.id);
      // --now overrides the slot with ~3 minutes from now (computed HERE, after the long build, so it
      // is still in the future when Zernio receives it); otherwise use the assigned LA slot.
      const whenISO = publishNow ? new Date(Date.now() + 3 * 60000).toISOString() : slot?.whenISO;
      const slotLabel = publishNow ? "now" : slot?.slot;
      if (!publishNow && !slot) { console.log(`  ⏸ no open slot left today for ${job.id} — not scheduling`); continue; }
      try {
        const pub = await publish({ job, mp4: job.render.mp4, cover: job.render.cover, whenISO, live });
        job.publish = { ...pub, slot: slotLabel };
        saveJob(job);
        // ONE ledger row per platform. Build-once dedup keys on slug (any row); the daily/slot guards
        // count DISTINCT slugs/slots (see ledger.mjs), so 3 rows for one story = one slot/one story.
        for (const r of pub.results) {
          recordPosted({
            slug: job.id, platform: r.platform, postId: r.id ?? null, published: !!r.ok, error: r.error || null,
            mode: pub.mode, slot: slotLabel, scheduledDay: day, whenISO: live ? whenISO : null,
            hookStyle: job.script.hookStyle, segment: job.scout.segment,
            goal: job.engage?.goal || null, // the learner correlates engagement asks per niche
            videoUrl: pub.videoUrl,
          });
        }
        const ok = pub.results.filter((r) => r.ok).map((r) => r.platform);
        const bad = pub.results.filter((r) => !r.ok);
        if (ok.length) anyPublished = true;
        console.log(`  📤 ${pub.mode} → ${slotLabel} ${live ? whenISO : "(draft)"} · ok:[${ok.join(", ") || "none"}]${bad.length ? ` · FAILED:[${bad.map((b) => `${b.platform}: ${(b.error || "?").slice(0, 45)}`).join("; ")}]` : ""}`);
        if (live && (slotLabel === "breaking" || publishNow)) {
          const ig = pub.results.find((r) => r.platform === "instagram" && r.ok);
          if (ig) { const v = await verifyLive(ig.id, { timeoutMin: 15 }); console.log(`  🔎 IG live-verify: ${v.live ? `LIVE ${v.permalink}` : JSON.stringify(v)}`); }
        }
      } catch (e) {
        console.error(`  📛 publish failed for ${job.id}: ${e.message}`);
      }
    }
  }

  // run report (cost honesty: spend ÷ PUBLISHED)
  const report = {
    at: new Date().toISOString(),
    slate: slate.map((s) => s.slug),
    built: built.map((j) => j.id),
    holds: slate.filter((s) => loadJob(s.slug)?.hold).map((s) => ({ slug: s.slug, ...loadJob(s.slug).hold })),
    usd: +costSpent().toFixed(4),
    usdPerPublished: built.length ? +(costSpent() / built.length).toFixed(4) : null,
    calls: costCalls().length,
    live,
  };
  fs.writeFileSync(path.join(IG.runsDir, `${Date.now()}.json`), JSON.stringify(report, null, 2));
  console.log(`\n═ run: ${built.length}/${slate.length} built · $${report.usd} total · $${report.usdPerPublished ?? "—"}/published · ${report.calls} calls`);
}

// Always terminate explicitly: a lingering keep-alive socket (or any un-refd handle)
// must never hang the unattended CI step after the work is done. (audit 2026-07-11)
main().then(
  () => process.exit(0),
  (e) => { console.error("FATAL:", e); process.exit(1); },
);
