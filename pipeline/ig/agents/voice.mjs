// AGENT 13 — VOICE v2 (owner feedback 2026-07-10: "the flow is bad, pauses kill the
// momentum, no continuation after a pause"). The redesign, fully inside the automation:
//   1. TAKES — candidate voices (marin/cedar/ash…) synthesized with a momentum-focused
//      delivery prompt (verbatim wall unchanged).
//   2. TIGHTEN — every long silence is compressed to a tight natural beat (the pause
//      stays, the flow continues) — deterministic ffmpeg silenceremove.
//   3. JUDGE BY EAR — a listening agent (audio-input) scores flow/energy/pauseQuality
//      per take; deterministic gap stats add a penalty. Best take wins; below-floor
//      takes are rejected and the automation retries harder before ever rendering.
//   4. LEARN — the winning voice persists in weights.json; later runs do single-take +
//      judge floor (bake-off re-runs automatically if the winner starts failing).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { IG, FFMPEG, FFPROBE } from "../config.mjs";
import { speak, listen } from "../models.mjs";
import { normWords, tokenDiff } from "../lib/util.mjs";
import { workDirFor } from "../job.mjs";
import { loadWeights, saveWeights } from "../lib/ledger.mjs";

// quick verbatim precheck on the provider transcript (authoritative check = whisper, agent 14)
// tolerance 0.18: provider transcripts format numbers/dates differently (8-12% token
// 'drift' on perfect audio) — conversation-mode failures drift 50%+; the ad-lib run
// detector + whisper wall + ear-judge are the true fabrication guards
export function transcriptMatches(scriptText, transcript, tolerance = 0.18) {
  const a = normWords(scriptText);
  const b = normWords(transcript);
  if (!a.length || !b.length) return false;
  return tokenDiff(a, b) / a.length <= tolerance;
}

function deliveryStyle(mood, harder = false) {
  if (mood === "somber") return "measured, respectful American news anchor; calm, warm, unhurried but continuous — no dead air";
  // the faster-paced directive won the first bake-off (+2 over the softer read) → default
  return (
    "energetic American entertainment-news anchor delivering ONE continuous, driving story at a bright, fast clip. " +
    "Momentum is everything: near-zero gaps between sentences, pauses are tight purposeful beats only, and after every pause come back IN with MORE energy — " +
    "never let a sentence die with a flat falling ending; each line hands off to the next like live breaking news. " +
    "Punch the names and numbers, vary your pace, sound genuinely thrilled by the story. " +
    "THE ENDING: the last two sentences are a question to the viewer and then the ask — take a natural beat before them, " +
    "deliver the question warm and direct, and the final ask calm and inviting, like signing off to a friend — it must LAND, never feel cut off." +
    (harder ? " MAXIMUM urgency in the body: read it like the story just broke seconds ago — breathless, gripping, zero dead air (but still let the ending land)." : "")
  );
}

// ── deterministic pause work ─────────────────────────────────────────────────────
// Compress every silence longer than minSilence down to keepSilence (the pause survives
// as a tight beat; the dead air goes) — EXCEPT inside the protected TAIL (the ending must
// breathe: a natural beat before the final ask, owner rule) and never below the duration
// floor. Implemented as segment cuts so position-aware rules are possible.
export function detectSilences(wav, { threshold = IG.voice.tighten.threshold, minDur = IG.voice.tighten.minSilence } = {}) {
  const res = spawnSync(FFMPEG, ["-hide_banner", "-i", wav, "-af", `silencedetect=noise=${threshold}:d=${minDur}`, "-f", "null", "-"], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
  const text = String(res.stderr || "");
  const starts = [...text.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...text.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  return starts.map((s, i) => ({ start: s, end: ends[i] ?? s })).filter((x) => x.end > x.start);
}

export function tightenPauses(inWav, outWav, { protectTail } = {}) {
  const t = IG.voice.tighten;
  const total = wavDuration(inWav);
  const protectedFrom = total - (protectTail ?? t.protectTailSec ?? 0);
  let sils = detectSilences(inWav).filter((s) => s.start > 0.05 && s.start < protectedFrom);
  // duration floor: trim the longest silences first, stop before dropping under floorSec
  sils.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const cuts = [];
  let removed = 0;
  for (const s of sils) {
    const cut = (s.end - s.start) - t.keepSilence;
    if (cut <= 0) continue;
    if (t.floorSec && total - removed - cut < t.floorSec) continue;
    cuts.push({ from: s.start + t.keepSilence, to: s.end });
    removed += cut;
  }
  if (!cuts.length) {
    fs.copyFileSync(inWav, outWav);
    return outWav;
  }
  cuts.sort((a, b) => a.from - b.from);
  // keep-segments between the cuts → atrim+concat
  const keeps = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.from - cursor > 0.02) keeps.push([cursor, c.from]);
    cursor = c.to;
  }
  keeps.push([cursor, total]);
  const parts = keeps.map((k, i) => `[0:a]atrim=start=${k[0].toFixed(3)}:end=${k[1].toFixed(3)},asetpts=PTS-STARTPTS[k${i}]`);
  const graph = `${parts.join(";")};${keeps.map((_, i) => `[k${i}]`).join("")}concat=n=${keeps.length}:v=0:a=1[out]`;
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", inWav, "-filter_complex", graph, "-map", "[out]", outWav], { timeout: 120000 });
  return outWav;
}

// Remaining long-gap stats (should be ~zero after tightening) — judge penalty input.
// The protected TAIL is exempt: the deliberate beat before the final ask is a feature.
export function gapStats(wav, { noise = "-38dB", minGap = 0.45 } = {}) {
  const total = wavDuration(wav);
  const cutoff = total - (IG.voice.tighten.protectTailSec || 0);
  const sils = detectSilences(wav, { threshold: noise, minDur: minGap }).filter((s) => s.start < cutoff);
  const durs = sils.map((s) => s.end - s.start);
  return { count: durs.length, max: durs.length ? Math.max(...durs) : 0 };
}

function wavDuration(wav) {
  return parseFloat(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]).toString());
}

// ── the listening judge (the automation's own ear) ──────────────────────────────
const JUDGE_SYS =
  'You are a strict broadcast voice director for a premium entertainment-news brand. Listen to this Instagram-reel voiceover and judge DELIVERY only (not content). STRICT JSON {"flow":0-10,"energy":0-10,"pauseQuality":0-10,"endingLands":boolean,"soundsRobotic":boolean,"worstMoment":string} — ' +
  "flow: does it drive forward as ONE continuous story, every sentence handing off to the next, or does it die between sentences? " +
  "energy: does it sound genuinely excited and alive throughout, including AFTER pauses? " +
  "pauseQuality: are pauses tight, purposeful beats with an energetic pickup after — or momentum killers? " +
  "endingLands: does the ending BREATHE and land its final question/ask naturally and warmly (true), or does it feel abrupt, rushed, cut off, or bolted-on (false)? " +
  "Hold a HIGH bar (an average automated read scores 5-6; only a genuinely engaging anchor read scores 8+).";

export async function judgeTake(wavPath) {
  const j = await listen({ system: JUDGE_SYS, user: "Judge this voiceover delivery.", wavBuffer: fs.readFileSync(wavPath) });
  const flow = Number(j.flow) || 0, energy = Number(j.energy) || 0, pauseQuality = Number(j.pauseQuality) || 0;
  return {
    flow, energy, pauseQuality,
    endingLands: j.endingLands !== false, // absent = benefit of the doubt
    soundsRobotic: Boolean(j.soundsRobotic),
    worstMoment: String(j.worstMoment || ""),
  };
}

export function scoreTake(judge, gaps) {
  let total = judge.flow + judge.energy + judge.pauseQuality; // 0-30
  // the judge already prices pauses into pauseQuality — the deterministic gap penalty
  // is a tie-breaker between takes, capped so it can't double-punish one flagged pause
  total -= Math.min(2, Math.max(0, gaps.count - IG.voice.maxLongGaps) * 2);
  if (judge.soundsRobotic) total -= 5;
  if (judge.endingLands === false) total -= 4; // an abrupt/bolted ending is a real defect (owner rule)
  return total;
}

export function passesFloor(judge, gaps) {
  // pass/fail belongs to the JUDGE's own scores (axes + ending); the deterministic
  // penalties in scoreTake only RANK passing takes — double-dipping them into the
  // floor was failing takes the judge itself rated 6+ on every axis
  const rawSum = judge.flow + judge.energy + judge.pauseQuality;
  return (
    judge.flow >= IG.voice.floorPerAxis &&
    judge.energy >= IG.voice.floorPerAxis &&
    judge.pauseQuality >= IG.voice.floorPerAxis &&
    judge.endingLands !== false && // the ending landing is non-negotiable (owner rule)
    rawSum >= IG.voice.floorTotal
  );
}

// ── chunked synthesis: every chunk starts at FULL energy (energy decays across a
// long single read — two bake-off rounds proved it). Hook = its own chunk (max punch),
// then pairs; joins are tight beats.
export function buildChunks(sentences, pairSize = IG.voice.chunkSentences) {
  if (!pairSize || pairSize <= 0 || sentences.length <= 2) return [sentences.join(" ")]; // single-call mode
  const chunks = [sentences[0]];
  for (let i = 1; i < sentences.length; i += pairSize) chunks.push(sentences.slice(i, i + pairSize).join(" "));
  return chunks.filter(Boolean);
}

const SILENCE_JOIN = () => Buffer.alloc(Math.round(24000 * IG.voice.joinSilenceSec) * 2); // s16le mono

// ── one candidate take: chunked synth → verbatim precheck → tighten → stats → judge ─
// Chunks run through a small pool (concurrency 2) — order preserved, wall time bounded.
async function pool(items, worker, concurrency = 2) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

async function makeTake({ dir, sentences, voice, mood, harder, model, label }) {
  // BODY in one continuous take (chunking the body kills flow — proven), but the ENDING
  // (final question + ask) is its own take: a deliberate beat, then a warm, slower,
  // signing-off delivery. The one seam that belongs is the one before the ending.
  const parts =
    sentences.length >= 5
      ? [
          { text: sentences.slice(0, -2).join(" "), context: "This is the reel minus its ending — hit the very first word at full energy and drive to the last line without winding down." },
          { text: sentences.slice(-2).join(" "), context: "This is the CLOSING of the SAME take — same room, same breath, same voice register as the story you just told. Do NOT restart with fresh announcer energy: come down naturally from the story's momentum into a warm, personal close. The question lands directly to the viewer; the final ask is calm and easy, like a friend saying it. Let it breathe; never rush it." },
        ]
      : [{ text: sentences.join(" "), context: "This is the OPENING of the reel — hit the very first word at full energy." }];
  // body + ending are independent generations — parallel halves the take's wall time
  const results = await Promise.all(
    parts.map((p) => speak({ text: p.text, voice, model, style: deliveryStyle(mood, harder), context: p.context })),
  );
  const ENDING_BEAT = Buffer.alloc(Math.round(24000 * 0.32) * 2); // the breath before the close
  const pcms = results.flatMap((r, i) => (i < results.length - 1 ? [r.pcm, ENDING_BEAT] : [r.pcm]));
  // the whole ending part + its lead-in beat is sacred — the tightener never touches it
  const endingProtectSec = results.length > 1 ? results[results.length - 1].pcm.length / 2 / 24000 + 0.32 + 0.4 : undefined;
  const transcript = results.map((r) => r.transcript).join(" ");
  const cost = results.reduce((s, r) => s + r.cost, 0);
  const text = sentences.join(" ");
  if (!transcriptMatches(text, transcript)) {
    const a = normWords(text), b = normWords(transcript);
    const drift = (tokenDiff(a, b) / Math.max(1, a.length)).toFixed(3);
    return { voice: label, fail: `verbatim-precheck (drift ${drift}, spoken tail: "${transcript.slice(-70)}")`, cost };
  }
  const raw = path.join(dir, `take-${label}-raw.wav`);
  const pcmPath = raw.replace(".wav", ".pcm");
  fs.writeFileSync(pcmPath, Buffer.concat(pcms));
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcmPath, raw], { timeout: 60000 });
  const tight = tightenPauses(raw, raw.replace("-raw.wav", ".wav"), { protectTail: endingProtectSec });
  const gaps = gapStats(tight);
  const judge = await judgeTake(tight);
  return { voice: label, realVoice: voice, model, wav: tight, transcript, cost, gaps, judge, score: scoreTake(judge, gaps), pass: passesFloor(judge, gaps) };
}

// ── the stage ────────────────────────────────────────────────────────────────────
export async function synthVoice({ slug, speakable, mood }) {
  const dir = workDirFor(slug);
  const weights = loadWeights();
  const locked = weights.voice || null; // { label, voice, model }
  const prem = IG.voice.premiumCandidate;
  const perVoice = Math.max(1, IG.voice.takesPerVoice || 1);
  const plans = locked
    ? Array.from({ length: perVoice }, (_, i) => ({ label: `${locked.label}${perVoice > 1 ? `-t${i + 1}` : ""}`, voice: locked.voice, model: locked.model || undefined }))
    : [
        // best-of-N per cheap voice (delivery variance is real), single take on premium
        ...IG.voice.candidates.flatMap((v) =>
          Array.from({ length: perVoice }, (_, i) => ({ label: perVoice > 1 ? `${v}-${i + 1}` : v, voice: v, model: undefined })),
        ),
        ...(prem ? [{ label: `${prem.voice}-premium`, voice: prem.voice, model: prem.model }] : []),
      ];
  // pooled (concurrency 3): parallel enough to be fast, gentle enough to avoid aborts
  const takes = await pool(
    plans,
    (p) =>
      makeTake({ dir, sentences: speakable, voice: p.voice, model: p.model, mood, label: p.label })
        .catch((e) => ({ voice: p.label, fail: e.message })),
    2,
  );
  // nothing passed the floor → one harder-directed retry on the best-scoring plan so far
  let usable = takes.filter((t) => t.wav);
  if (!usable.some((t) => t.pass)) {
    const best = usable.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    const plan = plans.find((p) => p.label === best?.voice) || plans[0];
    try {
      const harder = await makeTake({ dir, sentences: speakable, voice: plan.voice, model: plan.model, mood, harder: true, label: `${plan.label}-hard` });
      takes.push(harder);
      usable = takes.filter((t) => t.wav);
    } catch {}
  }
  if (!usable.length) {
    // preserve WHY every take failed — a silent fallback is undiagnosable (bake-off finding)
    const fb = kokoroFallback({ slug, text: speakable.join(" ") });
    fb.takes = takes.map((t) => ({ voice: t.voice, score: t.score ?? null, fail: t.fail || null }));
    return fb;
  }

  const winner = usable.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  // learn: persist/refresh the winning plan; unlock if a locked plan keeps failing
  if (winner.pass) {
    weights.voice = { label: winner.realVoice || winner.voice, voice: winner.realVoice, model: winner.model || null, score: winner.score, at: new Date().toISOString() };
    saveWeights(weights);
  } else if (locked) {
    delete weights.voice; // force a fresh bake-off next run
    saveWeights(weights);
  }
  // canonical output path the rest of the pipeline expects
  const wavPath = path.join(dir, "voice.wav");
  fs.copyFileSync(winner.wav, wavPath);
  return {
    engine: winner.model || "gpt-audio-mini",
    voice: winner.voice,
    wav: wavPath,
    durationSec: wavDuration(wavPath),
    transcript: winner.transcript,
    cost: takes.reduce((s, t) => s + (t.cost || 0), 0),
    verbatimPre: "pass",
    judge: winner.judge,
    gaps: winner.gaps,
    score: winner.score,
    belowFloor: !winner.pass || undefined, // surfaced in the job for the run report
    takes: takes.map((t) => ({ voice: t.voice, score: t.score ?? null, fail: t.fail || null })),
  };
}

// ── Kokoro fallback: fresh, minimal (no imports from the old lane) ─────────────
export function kokoroFallback({ slug, text }) {
  const dir = workDirFor(slug);
  const wavPath = path.join(dir, "voice.wav");
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "py", "kokoro_tts.py");
  execFileSync(IG.python, [script, "--text", text, "--out", wavPath, "--models", IG.kokoroModels], {
    timeout: 240000,
  });
  return { engine: "kokoro", wav: wavPath, durationSec: wavDuration(wavPath), transcript: text, cost: 0, verbatimPre: "kokoro" };
}
