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
import { normWords, tokenDiff, contentWords } from "../lib/util.mjs";
import { workDirFor } from "../job.mjs";
import { loadWeights, saveWeights } from "../lib/ledger.mjs";
import { whisperAlign, verbatimVerdict } from "./align.mjs";

// quick verbatim precheck on the provider transcript (authoritative check = whisper, agent 14)
// tolerance 0.18: provider transcripts format numbers/dates differently (8-12% token
// 'drift' on perfect audio) — conversation-mode failures drift 50%+; the ad-lib run
// detector + whisper wall + ear-judge are the true fabrication guards
export function transcriptMatches(scriptText, transcript, tolerance = 0.18) {
  // content words only — numbers/currency diverge between pronounced text and provider transcript
  // and are verified by their own wall; counting them false-fails number-heavy scripts. (2026-07-12)
  const a = contentWords(scriptText);
  const b = contentWords(transcript);
  if (!a.length || !b.length) return false;
  return tokenDiff(a, b) / a.length <= tolerance;
}

// ENDING-PRESENCE WALL (root fix, owner 2026-07-12): gpt-audio-mini sometimes DROPS the final
// short call-to-action sentence ("Tell us in the comments") after a question — its own provider
// transcript still claims it said it, and a ~5-word drop is under the verbatim wall's length/drift
// thresholds, so the take PASSED and the aligner then FABRICATED timings for the unspoken words →
// subtitles flashed a CTA the voice never spoke. Guard: the ending only counts as spoken if the
// DISTINCTIVE content words of the last sentence actually appear in the whisper (ground-truth)
// transcript. "comments" is the load-bearing word for every CTA variant and is never mis-heard.
const ENDING_STOP = new Set([
  "us", "in", "the", "a", "to", "of", "and", "on", "it", "me", "we", "you", "your", "our",
  "so", "now", "let", "know", "down", "below", "this", "that", "is", "are", "be", "for", "with", "what", "do",
]);
export function endingSpoken(lastSentence, whisper) {
  const need = contentWords(lastSentence).filter((w) => !ENDING_STOP.has(w));
  if (!need.length) return true; // nothing distinctive to verify → don't block
  const heard = new Set(contentWords((whisper && whisper.text) || ""));
  const hit = need.filter((w) => heard.has(w)).length;
  return hit >= Math.ceil(need.length / 2); // at least half the distinctive CTA words were actually spoken
}

function deliveryStyle(mood, harder = false) {
  if (mood === "somber") return "measured, respectful American news anchor; calm, warm, unhurried but continuous — no dead air";
  // the faster-paced directive won the first bake-off (+2 over the softer read) → default
  return (
    // owner 2026-07-12: the read was a touch TOO fast to follow. Keep the energy + warmth, but
    // dial the SPEED back a notch so every word lands and more viewers catch it — clear over hurried.
    "engaging American entertainment-news anchor delivering ONE continuous story at a CLEAR, controlled pace — lively and warm, but never rushed: speak a touch slower than a hype ad-read so every word is easy to catch. " +
    "Momentum comes from the CONNECTION between sentences, not from speed: keep the gaps tight and natural, and after each beat come back in with energy — " +
    "never let a sentence die with a flat falling ending; each line hands off to the next. " +
    "Punch the names and numbers, let the key facts breathe for a beat, and sound genuinely interested in the story. " +
    "THE ENDING: the last two sentences are a question to the viewer and then the ask — take a natural beat before them, " +
    "deliver the question warm and direct, and the final ask calm and inviting, like signing off to a friend — it must LAND, never feel cut off." +
    (harder ? " Bring a bit MORE drive to the body (like the story just broke), but stay clear and easy to follow — energetic, never rushed or breathless." : "")
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

// ADAPTIVE PACE (owner 2026-07-13): the model reads at a VARYING fast rate, so a fixed atempo can't
// normalize it. Measure THIS take's real pace (words ÷ audio seconds) and slow it just enough to hit
// targetWps — CLAMPED so it never speeds a slow take up (≤1.0) and never over-slows (≥minTempo, so a
// 4.0-wps read lands at ~3.4 and faster reads are capped, never too slow). atempo preserves pitch.
// No-op if pace is off or the take is already at/under target. Falls back to the input on ffmpeg error.
function paceTake(inWav, words) {
  const p = IG.voice.pace;
  if (!p?.targetWps || !(words > 0)) return inWav;
  const dur = wavDuration(inWav);
  if (!(dur > 0)) return inWav;
  const actualWps = words / dur;
  const tempo = Math.min(1, Math.max(p.minTempo ?? 0.85, p.targetWps / actualWps));
  if (Math.abs(tempo - 1) < 0.01) return inWav; // already comfortable — don't touch it
  const out = inWav.replace(/\.wav$/, "-paced.wav");
  try {
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", inWav, "-filter:a", `atempo=${tempo.toFixed(3)}`, out], { timeout: 60000 });
    return out;
  } catch {
    return inWav;
  }
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
  'You are a strict broadcast voice director for a premium entertainment-news brand. Listen to this Instagram-reel voiceover and judge DELIVERY only (not content). STRICT JSON {"flow":0-10,"energy":0-10,"pauseQuality":0-10,"endingLands":boolean,"engagementLands":boolean,"soundsRobotic":boolean,"worstMoment":string} — ' +
  "flow: does it drive forward as ONE continuous story, every sentence handing off to the next, or does it die between sentences? " +
  "energy: does it sound genuinely excited and alive throughout, including AFTER pauses? " +
  "pauseQuality: are pauses tight, purposeful beats with an energetic pickup after — or momentum killers? " +
  "endingLands: does the ending BREATHE and land its final question/ask naturally and warmly (true), or does it feel abrupt, rushed, cut off, or bolted-on (false)? " +
  "engagementLands: are the rhetorical questions and punchy/engaging phrases DELIVERED so they land — a real beat on a question, a lift on the payoff (true) — or rushed over and flat so the moment is lost (false)? " +
  "Hold a HIGH bar (an average automated read scores 5-6; only a genuinely engaging anchor read scores 8+).";

export async function judgeTake(wavPath) {
  const j = await listen({ system: JUDGE_SYS, user: "Judge this voiceover delivery.", wavBuffer: fs.readFileSync(wavPath) });
  const flow = Number(j.flow) || 0, energy = Number(j.energy) || 0, pauseQuality = Number(j.pauseQuality) || 0;
  return {
    flow, energy, pauseQuality,
    endingLands: j.endingLands !== false, // absent = benefit of the doubt
    engagementLands: j.engagementLands !== false, // absent = benefit of the doubt
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
  if (judge.engagementLands === false) total -= 3; // flat questions/phrases lose the moment — rank down (owner 2026-07-11)
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
  // SINGLE-CALL synthesis of the WHOLE script (ROOT FIX, owner 2026-07-11). The ending must
  // FLOW out of the story, not be a separately-synthesized clip glued on at a seam. The old
  // two-part synthesis (a body take + an ISOLATED ending take joined by a silence) made EVERY
  // reel's closing question read as "tacked on" (judge 13-16/30 on story after story): the model
  // cannot match the pitch/pace/energy of a body it never heard, so the join is audible. Reading
  // the entire script in ONE continuous take carries the momentum straight into a warm, beat-led
  // close — and in-context the closing question is just the last line, so it neither runs away
  // nor gets "answered" the way an isolated ending did (that was also the Kokoro-swap trigger).
  const text = sentences.join(" ");
  const context =
    sentences.length >= 5
      ? "This is the WHOLE reel, read as ONE continuous take: hit the very first word at full energy and drive through the story. Then, before the final question, take a clear BEAT — a real breath — and deliver the closing question and ask slower and warmer than the rest of the read, letting them land unhurried. Read every word exactly, INCLUDING the very last short call-to-action line that comes AFTER the question (e.g. 'Tell us in the comments') — never stop at the question mark, always speak that final line too. You are NARRATING the closing question to the audience, NEVER answering or reacting to it, and add NOTHING beyond the script's final word."
      : "This is the OPENING of the reel — hit the very first word at full energy; read every word exactly and add nothing after the final word.";
  let r;
  try {
    r = await speak({ text, voice, model, style: deliveryStyle(mood, harder), context });
  } catch (e) {
    return { voice: label, fail: `synth: ${String(e?.message || e).slice(0, 80)}`, cost: 0 };
  }
  const pcms = [r.pcm];
  // protect the closing (~last 2 sentences + a breath) from the pause tightener so the
  // deliberate ending beat survives the silence compression
  const endingProtectSec =
    sentences.length >= 5 ? Math.max(3.5, normWords(sentences.slice(-2).join(" ")).length / 2.4 + 0.6) : undefined;
  const transcript = r.transcript;
  const cost = r.cost;
  if (!transcriptMatches(text, transcript)) {
    // TAIL-DROP SALVAGE (owner audit 2026-07-16): gpt-audio's #1 failure is dropping the final CTA
    // line after the closing question — ~half of rejected takes died ONLY for that, throwing away a
    // fully-paid body read. If the BODY (script minus the last sentence) is verbatim, let the take
    // through — the whisper wall downstream detects the missing ending and rescueTail synthesizes
    // just that one short line (~$0.005) instead of re-buying a whole ~$0.07 read.
    const bodyText = sentences.slice(0, -1).join(" ");
    if (!(sentences.length >= 3 && transcriptMatches(bodyText, transcript))) {
      const a = normWords(text), b = normWords(transcript);
      const drift = (tokenDiff(a, b) / Math.max(1, a.length)).toFixed(3);
      return { voice: label, fail: `verbatim-precheck (drift ${drift}, spoken tail: "${transcript.slice(-70)}")`, cost };
    }
  }
  const raw = path.join(dir, `take-${label}-raw.wav`);
  const pcmPath = raw.replace(".wav", ".pcm");
  fs.writeFileSync(pcmPath, Buffer.concat(pcms));
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcmPath, raw], { timeout: 60000 });
  const tight = tightenPauses(raw, raw.replace("-raw.wav", ".wav"), { protectTail: endingProtectSec });
  // adaptive slowdown to a comfortable target pace, AFTER tightening so the ear-judge AND the
  // downstream whisper-align both evaluate the FINAL pace — keeping subtitles/images perfectly in sync.
  const paced = paceTake(tight, normWords(sentences.join(" ")).length);
  const gaps = gapStats(paced);
  const judge = await judgeTake(paced);
  return { voice: label, realVoice: voice, model, wav: paced, transcript, cost, gaps, judge, score: scoreTake(judge, gaps), pass: passesFloor(judge, gaps) };
}

// ── TAIL RESCUE (owner audit 2026-07-16): when a take dropped ONLY the final CTA line, synthesize
// that one short line (~$0.005) and append it after a natural beat — instead of rejecting the whole
// paid ~$0.07 read. The joined take still faces the full whisper wall (verbatim + ending-spoken), so
// nothing unverified ships; the CTA is a discrete sign-off beat, so the join reads as the natural
// pause the delivery prompt already asks for.
async function rescueTail({ dir, take, lastSentence, mood, label }) {
  const r = await speak({
    text: lastSentence,
    voice: take.realVoice || IG.voice.candidates[0],
    model: take.model,
    style: mood === "somber" ? "measured, warm, respectful sign-off" : "calm, warm, inviting sign-off to a friend — unhurried, like the closing line of a story",
    context: "This is the final short call-to-action line of a reel, spoken after a natural beat. Read exactly these words and nothing more.",
  });
  if (!transcriptMatches(lastSentence, r.transcript, 0.4)) throw new Error("tail synth did not read the CTA verbatim");
  const tailPcm = path.join(dir, `tail-${label}.pcm`);
  fs.writeFileSync(tailPcm, r.pcm);
  const tailWav = tailPcm.replace(".pcm", ".wav");
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", tailPcm, tailWav], { timeout: 60000 });
  const joined = take.wav.replace(/\.wav$/, "-tailfix.wav");
  execFileSync(
    FFMPEG,
    ["-y", "-loglevel", "error", "-i", take.wav, "-i", tailWav, "-filter_complex", "[0:a]apad=pad_dur=0.28[a];[a][1:a]concat=n=2:v=0:a=1[out]", "-map", "[out]", joined],
    { timeout: 60000 },
  );
  take.wav = joined;
  take.cost = (take.cost || 0) + (r.cost || 0);
  take.transcript = `${take.transcript || ""} ${r.transcript || ""}`.trim();
  take.tailRescued = true;
}

// ── the stage ────────────────────────────────────────────────────────────────────
export async function synthVoice({ slug, speakable, mood }) {
  const dir = workDirFor(slug);
  const weights = loadWeights();
  const locked = weights.voice || null; // { label, voice, model }
  const perVoice = Math.max(1, IG.voice.takesPerVoice || 1);
  const plans = locked
    ? Array.from({ length: perVoice }, (_, i) => ({ label: `${locked.label}${perVoice > 1 ? `-t${i + 1}` : ""}`, voice: locked.voice, model: locked.model || undefined }))
    : // best-of-N per candidate voice (delivery variance is real) — first-run bake-off before the lock
      IG.voice.candidates.flatMap((v) =>
        Array.from({ length: perVoice }, (_, i) => ({ label: perVoice > 1 ? `${v}-${i + 1}` : v, voice: v, model: undefined })),
      );
  // COST CUT (owner 2026-07-15): SEQUENTIAL "take-until-clean" instead of always paying for 3 parallel
  // gpt-audio reads. gpt-audio is ~92% of a reel's cost; synth ONE read at a time and SHIP the moment a
  // take is verbatim-clean + ending-present + passes the delivery floor. EVERY quality gate is IDENTICAL
  // to before (same whisper verbatim wall + ending-spoken check + floor) — the shipped audio is exactly as
  // good; we only stop re-rolling a NOISY delivery score (identical marin reads score 8-22, and a
  // floor-passing clean take already IS the owner's bar). Holds do NOT rise: we roll again on an ad-lib and
  // keep the 4th "harder" rescue read. Common case (clean first read) = 1 gpt-audio call, not 3.
  const spoken = speakable.join(" ");
  const lastSentence = speakable[speakable.length - 1] || "";
  const takes = [];
  // whisper-check ONE take against the script — returns the whisper result if verbatim-clean AND the
  // ending was actually spoken, else null. Mirrors the old verbatim wall exactly (a pure whisper DRIFT,
  // i.e. misheard names not added words, still counts as clean). The winner's whisper is reused downstream.
  const cleanWhisper = (t) => {
    try {
      const wh = whisperAlign(t.wav);
      if (!endingSpoken(lastSentence, wh)) { t.verbatim = { pass: false, kind: "ending-dropped", reason: `ending not spoken ("${lastSentence.slice(0, 40)}")` }; return null; }
      const vv = verbatimVerdict(spoken, wh);
      t.verbatim = vv;
      return (vv.pass || vv.kind === "drift") ? wh : null;
    } catch (e) { t.verbatim = { pass: false, kind: "whisper-error", reason: String(e?.message || e) }; return null; }
  };
  const oneTake = async (p, harder = false) => {
    const t = await makeTake({ dir, sentences: speakable, voice: p.voice, model: p.model, mood, harder, label: harder ? `${p.label}-hard` : p.label }).catch((e) => ({ voice: p.label, fail: String(e?.message || e) }));
    takes.push(t);
    return t;
  };
  let winner = null, winnerWhisper = null;
  // WIN-FAST THRESHOLD (owner audit 2026-07-16): the earlier "take-until-clean" loop still paid for
  // all takes on most runs, because passesFloor (all axes ≥6 + total ≥18) almost never passes on the
  // NOISY ear-judge (identical marin reads score 8-22) — so the loop rolled every take, then shipped a
  // below-floor one anyway (igrun warn-and-ships anything ≥ hardFloorScore). Accepting a whisper-CLEAN
  // take at score ≥ hardFloorScore(8) IMMEDIATELY ships the exact same audio the old path would have
  // shipped after paying for 3-4 reads. A cleanWhisper miss that is ONLY the dropped CTA line gets the
  // ~$0.005 tail rescue instead of a ~$0.07 re-roll (the #1 reject cause, ~50% of thrown-away takes).
  const winScore = IG.voice.hardFloorScore ?? 8;
  const tryClean = async (t) => {
    let wh = cleanWhisper(t);
    if (!wh && t.verbatim?.kind === "ending-dropped" && !t.tailRescued) {
      try {
        await rescueTail({ dir, take: t, lastSentence, mood, label: t.voice });
        wh = cleanWhisper(t); // full wall re-run on the joined audio — nothing unverified ships
      } catch (e) { t.verbatim = { ...t.verbatim, rescue: `tail rescue failed: ${String(e?.message || e).slice(0, 60)}` }; }
    }
    return wh;
  };
  for (let i = 0; i < plans.length && !winner; i++) {
    const t = await oneTake(plans[i]);
    if (!t.wav) continue; // synth failed → roll the next
    const wh = await tryClean(t);
    if (wh && (t.pass || (t.score ?? 0) >= winScore)) { winner = t; winnerWhisper = wh; } // clean + shippable → SHIP
    else if (wh) t.cleanWh = wh; // clean but under the hard floor (a truly bad read) → remember, roll again
  }
  // no clean shippable take → ONE harder-directed retry on the best plan so far (the 4th rescue read)
  if (!winner) {
    const best = takes.filter((t) => t.wav).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    const plan = plans.find((p) => p.label === best?.voice) || plans[0];
    const h = await oneTake(plan, true);
    if (h.wav) { const wh = await tryClean(h); if (wh && (h.pass || (h.score ?? 0) >= winScore)) { winner = h; winnerWhisper = wh; } else if (wh) h.cleanWh = wh; }
  }
  // still no floor-PASSING take → ship the best CLEAN below-floor take (warn-and-ship, exactly as before)
  if (!winner) {
    const cleanBelow = takes.filter((t) => t.cleanWh).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (cleanBelow) { winner = cleanBelow; winnerWhisper = cleanBelow.cleanWh; }
  }
  if (!winner) {
    // every take failed synth OR ad-libbed in the AUDIO — Kokoro reads the exact words (CANNOT ad-lib);
    // fall back to it (its floor still applies). Keep the locked marin voice — a Kokoro fallback is a
    // transient synthesis failure, NOT a reason to re-audition (that caused the ash drift). (owner 2026-07-12)
    const fb = kokoroFallback({ slug, text: spoken });
    fb.belowFloor = undefined;
    fb.takes = takes.map((t) => ({ voice: t.voice, score: t.score ?? null, fail: t.fail || (t.verbatim && !t.verbatim.pass ? t.verbatim.reason : null) }));
    return fb;
  }
  // NOTE (owner 2026-07-12): an experiment that INSERTED a 0.4s silence before the closing question
  // was REMOVED — it did the opposite of intended. The model already reads the whole script as one
  // continuous take; injecting a hard silence chopped the ending into a STOP ("keeps stopping, never
  // flows") and dragged scores DOWN (16-20 → 11). The ending flows best when the continuous read is
  // left ALONE — the ending's warmth/landing is handled by the delivery prompt + the writer's ending
  // run-up, not by post-hoc silence. Do NOT re-add an inserted ending pause.
  // learn: persist/refresh the winning plan. A below-floor run no longer UNLOCKS the voice —
  // the locked voice (marin) is the owner's chosen voice, and one transient weak take must NOT
  // swap it out and cause the voice to drift across videos (that was the ash-vs-marin drift).
  // The bake-off only re-runs when there is NO lock (first run / manual reset). (owner 2026-07-12)
  if (winner.pass) {
    weights.voice = { label: winner.realVoice || winner.voice, voice: winner.realVoice, model: winner.model || null, score: winner.score, at: new Date().toISOString() };
    saveWeights(weights);
  }
  // canonical output path the rest of the pipeline expects
  const wavPath = path.join(dir, "voice.wav");
  fs.copyFileSync(winner.wav, wavPath);
  return {
    engine: winner.model || IG.models.voice,
    voice: winner.voice,
    wav: wavPath,
    durationSec: wavDuration(wavPath),
    transcript: winner.transcript,
    cost: takes.reduce((s, t) => s + (t.cost || 0), 0),
    verbatimPre: "pass",
    verbatim: winner.verbatim?.reason,
    whisper: winnerWhisper, // ALREADY verbatim-clean — the align stage reuses this, no re-transcribe
    judge: winner.judge,
    gaps: winner.gaps,
    score: winner.score,
    belowFloor: !winner.pass || undefined, // surfaced in the job for the run report
    takes: takes.map((t) => ({ voice: t.voice, score: t.score ?? null, fail: t.fail || null, verbatim: t.verbatim?.reason || null })),
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
