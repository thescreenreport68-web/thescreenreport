// AGENT 20 — FINAL WATCH-QC (plan §2.2 #20): the last gate before publish.
// ffprobe conformance + vision spot-check of sampled frames + one capped judge score
// vs the viral rubric (incl. the premium-look check). fix-loop is the orchestrator's
// job; this agent only renders verdicts. A broken/cheap-looking video = hold, never publish.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { IG, FFMPEG, FFPROBE } from "../config.mjs";
import { vision, llm } from "../models.mjs";
import { workDirFor } from "../job.mjs";

export function probeSpec(mp4, expectedSec) {
  const out = execFileSync(FFPROBE, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate:format=duration",
    "-of", "json", mp4,
  ]).toString();
  const j = JSON.parse(out);
  const st = j.streams?.[0] || {};
  const dur = parseFloat(j.format?.duration || 0);
  const issues = [];
  if (st.width !== IG.width || st.height !== IG.height) issues.push(`resolution ${st.width}x${st.height}`);
  const fps = st.r_frame_rate?.includes("/") ? +st.r_frame_rate.split("/")[0] / +st.r_frame_rate.split("/")[1] : +st.r_frame_rate;
  if (Math.abs(fps - IG.fps) > 1) issues.push(`fps ${fps}`);
  if (Math.abs(dur - expectedSec) > 2.0) issues.push(`duration ${dur.toFixed(1)} vs expected ${expectedSec.toFixed(1)}`);
  if (dur > IG.script.maxSec + 3) issues.push(`over max length`);
  const audio = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", mp4]).toString().trim();
  if (!audio) issues.push("NO AUDIO STREAM (official downrank: muted reels)");
  return { issues, duration: dur };
}

export function sampleFrames(slug, mp4, n = 4) {
  const dir = workDirFor(slug);
  const files = [];
  const dur = parseFloat(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4]).toString());
  for (let i = 0; i < n; i++) {
    const t = Math.max(0.2, (dur * (i + 0.5)) / n);
    const f = path.join(dir, `qc-frame-${i}.jpg`);
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-ss", t.toFixed(2), "-i", mp4, "-frames:v", "1", "-q:v", "4", f], { timeout: 60000 });
    files.push(f);
  }
  return files;
}

export async function watchQC({ job, mp4, expectedSec }) {
  const spec = probeSpec(mp4, expectedSec);
  if (spec.issues.length) return { verdict: "fix", score: 0, reasons: spec.issues, spec };

  const frames = sampleFrames(job.id, mp4);
  const dataUris = frames.map((f) => `data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}`);
  let frameCheck = { frames: [] };
  try {
    frameCheck = await vision({
      system:
        'QC frames from OUR OWN news reel. Expected and CORRECT in every frame: the "THE SCREEN REPORT" corner wordmark and the burned-in subtitle captions — these are OUR branding, never flag them. STRICT JSON {"frames":[{"i":number,"black":boolean,"garbledText":boolean,"thirdPartyWatermark":boolean,"looksPremium":boolean}]} — one per frame in order. thirdPartyWatermark = ONLY a logo/watermark from someone ELSE: photo agencies (Getty, AP, Backgrid, Splash), other outlets/channels, or app UI (TikTok, YouTube). garbledText = broken/corrupted rendering of text, not stylistic choices. looksPremium = professional motion-designed news video (typography, grading), NOT a cheap bot slideshow.',
      user: `Story: ${job.facts.storyOneLine}. Judge each frame.`,
      images: dataUris,
      maxTokens: 400,
    });
  } catch { /* vision outage → judge-only (recorded via frameCheckRan below) */ }
  // models sometimes return a bare array instead of {frames:[...]} — accept both
  const framesArr = Array.isArray(frameCheck) ? frameCheck : frameCheck.frames || [];
  const frameCheckRan = framesArr.length >= 3;
  const reasons = [];
  for (const f of framesArr) {
    if (f.black) reasons.push(`black frame #${f.i ?? f.frame}`);
    if (f.garbledText) reasons.push(`garbled text #${f.i ?? f.frame}`);
    if (f.thirdPartyWatermark) reasons.push(`third-party watermark #${f.i ?? f.frame} (hard fail)`);
  }
  const premiumVotes = framesArr.filter((f) => f.looksPremium).length;
  if (frameCheckRan && premiumVotes < 2) reasons.push("premium-look check failed (bot-slideshow feel)");
  if (reasons.length) return { verdict: "fix", score: 0, reasons, spec, frameCheckRan };

  // capped judge on the full package (the most expensive tokens in the stack — small
  // budget), ANCHORED to our platform rulebook so it never punishes policy compliance:
  // Instagram DEMOTES withholding-style hooks ("you won't believe", "wait for it") —
  // our hooks state the surprise plainly, which is what Mosseri says wins.
  // BOOLEAN DEFECT GATE, majority-of-3 (scalar LLM scores judged the same package
  // 35-68 across calls — noise, not signal; boolean defect questions are reliable).
  // The numeric score is ADVISORY ONLY — logged for the learner, never gating.
  const JUDGE_SYS =
    `You QC an Instagram reel package. SCOPE: every fact has ALREADY been verified against sources upstream — you must NOT judge factual accuracy or plausibility (your world knowledge may be out of date); treat every stated fact as true. Judge CRAFT only. ` +
    `SURFACES: "SPOKEN SCRIPT" is the voiceover — its FIRST SENTENCE is the hook. "CAPTION LINE 1" is a separate written surface with its own rules. Never apply one surface's rules to the other. ` +
    `HOUSE RULES: hooks must state the most surprising fact plainly and immediately; withholding/curiosity-bait phrasing ("you won't believe", "wait for it", "guess who") is BANNED (Instagram demotes it); no engagement bait. ` +
    `Answer these DEFECT CHECKS exactly. STRICT JSON {"hookNamesEntity":boolean,"hookStatesConcreteFact":boolean,"containsBaitPhrasing":boolean,"containsPadding":boolean,"endingWorks":boolean,"score":number,"weakest":string} — ` +
    `hookNamesEntity: does sentence 1 name a person or title? hookStatesConcreteFact: does sentence 1 plainly state a specific fact (not a vague tease)? containsBaitPhrasing: any banned bait phrasing anywhere? containsPadding: any sentence adding NO new information? endingWorks: does the ending land — a genuine audience question and/or one short vetted engagement ask ("tell us in the comments" / "save this for…" / "send this to…" are HOUSE-APPROVED closers, never bait)? score: advisory 0-100 viral-potential estimate.`;
  const JUDGE_USER = `SPOKEN SCRIPT (sentence 1 = the hook):\n${job.script.sentences.join("\n")}\n\nCAPTION LINE 1 (written surface): ${job.caption.line1}\nHASHTAGS: ${job.caption.hashtags.join(" ")}\nCTA: ${job.caption.cta}\nDURATION: ${expectedSec.toFixed(0)}s`;
  const votes = (
    await Promise.all(
      [0, 0.2, 0.4].map((temp) =>
        llm({ role: "judge", system: JUDGE_SYS, user: JUDGE_USER, temp, maxTokens: 300, json: true }).catch(() => null),
      ),
    )
  ).filter(Boolean);
  if (!votes.length) return { verdict: "fix", score: 0, reasons: ["judge unavailable"], spec, frameCheckRan };
  const majority = (key, expect) => votes.filter((v) => Boolean(v[key]) === expect).length > votes.length / 2;
  const defects = [];
  if (majority("hookNamesEntity", false)) defects.push("hook names no entity");
  if (majority("hookStatesConcreteFact", false)) defects.push("hook states no concrete fact");
  if (majority("containsBaitPhrasing", true)) defects.push("bait phrasing");
  if (majority("containsPadding", true)) defects.push("padding sentence");
  if (majority("endingWorks", false)) defects.push("ending neither loops nor asks");
  const sorted = votes.map((v) => Number(v.score) || 0).sort((a, b) => a - b);
  const score = sorted[Math.floor(sorted.length / 2)];
  if (defects.length)
    return { verdict: "fix", score, reasons: [`judge defects (majority of ${votes.length}): ${defects.join("; ")}`], spec, frameCheckRan };
  return { verdict: "publish", score, judgeVotes: sorted, reasons: [], spec, premiumVotes, frameCheckRan };
}
