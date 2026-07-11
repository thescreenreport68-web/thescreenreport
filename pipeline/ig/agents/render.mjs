// AGENT 17 — ASSEMBLER/RENDERER (plan §2.2 #17, §5.6 premium bar):
// pass 1: video track — eased Ken Burns per shot, xfade transitions, grade + grain +
//         vignette, karaoke subs, native-type wordmark watermark, ≤1s endcard sting.
// pass 2: audio master — voice chain (highpass/presence/comp/limit) + ducked music +
//         two-pass loudnorm to -14 LUFS.
// pass 3: mux, H.264 High, closed GOP, +faststart.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { IG, FFMPEG } from "../config.mjs";
import { workDirFor, outDirFor } from "../job.mjs";

// TEMPLATE ROTATION (plan §5.6): 2-3 visual variants selected deterministically per slug
// so the account never reads as one template (anti-templated-automation defense).
export const TEMPLATES = [
  { snap: "slideleft", snapEvery: 3, watermark: "tr", grain: 5, vignette: "PI/4.6", endTag: "Daily movie news" },
  { snap: "wipeup", snapEvery: 4, watermark: "tl", grain: 7, vignette: "PI/5", endTag: "Hollywood, daily" },
  { snap: "smoothleft", snapEvery: 3, watermark: "tr", grain: 4, vignette: "PI/4.2", endTag: "Movie news in 30 seconds" },
];
export function templateFor(slug) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TEMPLATES[h % TEMPLATES.length];
}

function ff(args, timeout = 900000, cwd = undefined) {
  return execFileSync(FFMPEG, ["-y", "-loglevel", "error", ...args], { timeout, maxBuffer: 32 * 1024 * 1024, cwd });
}

// File paths INSIDE filter graphs (ass=, fontsdir=, drawtext fontfile=) are quoting
// hell when they contain spaces ("Movie News site"). The bulletproof approach: run
// ffmpeg with cwd = the work dir and reference bare RELATIVE names — nothing to quote.
export function ensureFonts(dir) {
  const dst = path.join(dir, "fonts");
  fs.mkdirSync(dst, { recursive: true });
  const f = path.join(dst, "Anton-Regular.ttf");
  if (!fs.existsSync(f)) fs.copyFileSync(path.join(IG.fontsDir, "Anton-Regular.ttf"), f);
  return dst;
}

// eased zoom/pan expressions (never linear-only — premium motion)
function motionExpr(motion, frames) {
  const ease = `pow(on/${frames},0.75)`;
  switch (motion) {
    case "in":  return { z: `1.02+0.13*${ease}`, x: "iw/2-(iw/zoom/2)", y: "ih/2.6-(ih/zoom/2.6)" };
    case "out": return { z: `1.15-0.12*${ease}`, x: "iw/2-(iw/zoom/2)", y: "ih/2.6-(ih/zoom/2.6)" };
    case "panl": return { z: "1.12", x: `(iw-iw/zoom)*(1-${ease})`, y: "ih/3-(ih/zoom/3)" };
    default:     return { z: "1.12", x: `(iw-iw/zoom)*${ease}`, y: "ih/3-(ih/zoom/3)" };
  }
}

const GRADE = {
  celebratory: "eq=contrast=1.06:saturation=1.14:brightness=0.015",
  fun: "eq=contrast=1.05:saturation=1.12",
  epic: "eq=contrast=1.09:saturation=1.02,colorbalance=bs=0.06:ms=0.02",
  tense: "eq=contrast=1.09:saturation=0.92,colorbalance=bs=0.08",
  somber: "eq=contrast=1.03:saturation=0.78",
  neutral: "eq=contrast=1.05:saturation=1.05",
};

export function renderVideo({ slug, shots, assFile, mood = "neutral", durationSec }) {
  const dir = workDirFor(slug);
  const fps = IG.fps;
  const xfadeSec = 0.34;
  const tpl = templateFor(slug);

  // per-shot clips (zoompan on stills), then chain xfades
  const inputs = [];
  const filters = [];
  shots.forEach((s, i) => {
    const len = Math.max(0.5, s.t1 - s.t0) + (i < shots.length - 1 ? xfadeSec : 0.02);
    const frames = Math.max(2, Math.round(len * fps));
    inputs.push("-loop", "1", "-t", len.toFixed(3), "-i", s.img);
    const m = motionExpr(s.motion, frames);
    filters.push(
      `[${i}:v]scale=${IG.upscale[0]}:${IG.upscale[1]}:force_original_aspect_ratio=increase,crop=${IG.upscale[0]}:${IG.upscale[1]},` +
      `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${frames}:s=${IG.width}x${IG.height}:fps=${fps},setsar=1[v${i}]`
    );
  });
  // xfade chain (rotate fade / quick slide for snap variety).
  // Offset math: every non-last clip is padded by xfadeSec beyond its raw length, so the
  // transition into clip i starts EXACTLY at the cumulative raw sum — clip i's content then
  // lands at its planned t0, keeping visuals locked to the absolute-timed subs/entity sync.
  let prev = "v0";
  let offset = 0;
  for (let i = 1; i < shots.length; i++) {
    offset += Math.max(0.5, shots[i - 1].t1 - shots[i - 1].t0);
    const isSnap = i % tpl.snapEvery === 0;
    const trans = isSnap ? tpl.snap : "fade";
    const dur = isSnap ? 0.22 : xfadeSec;
    const out = i === shots.length - 1 ? "vx" : `x${i}`;
    filters.push(`[${prev}][v${i}]xfade=transition=${trans}:duration=${dur}:offset=${offset.toFixed(3)}[${out}]`);
    prev = out;
  }
  if (shots.length === 1) filters.push(`[v0]null[vx]`);

  // polish: grade → grain → vignette → subs → BRAND LOGO watermark → endcard sting.
  // Owner 2026-07-10: the TSR mark (corner) + "The Screen Report" wordmark (endcard) are
  // the REAL brand logos, overlaid as transparent PNGs — never plain text. ffmpeg runs
  // with cwd=dir (filter-graph refs are bare relative names); the logos are added as -i
  // inputs (absolute paths with spaces are fine outside the filter graph) at indices
  // AFTER the shot inputs.
  ensureFonts(dir);
  const assRel = path.basename(assFile); // subs.ass lives in the work dir
  const grade = GRADE[mood] || GRADE.neutral;
  const endStart = Math.max(0, durationSec - IG.endTailSec).toFixed(2);
  const wmIdx = shots.length, wordIdx = shots.length + 1;
  inputs.push(
    "-loop", "1", "-t", durationSec.toFixed(3), "-i", path.join(IG.assetsDir, "logo-tsr.png"),
    "-loop", "1", "-t", durationSec.toFixed(3), "-i", path.join(IG.assetsDir, "logo-wordmark.png"),
  );
  const wmX = tpl.watermark === "tl" ? `${IG.safe.left + 8}` : `W-w-${IG.safe.right - 40}`;
  filters.push(
    `[vx]${grade},noise=alls=${tpl.grain}:allf=t,vignette=${tpl.vignette},` +
    `ass=${assRel}:fontsdir=fonts,` +
    `drawbox=y=0:h=ih:t=fill:color=black@0.55:enable='gte(t,${endStart})',` +
    `drawtext=fontfile=fonts/Anton-Regular.ttf:text='${tpl.endTag}':fontsize=40:fontcolor=white@0.85:x=(w-tw)/2:y=(h/2)+130:enable='gte(t,${endStart})',` +
    `trim=duration=${durationSec.toFixed(3)},setpts=PTS-STARTPTS[base]`
  );
  // TSR corner mark (persistent, small, brand opacity) + wordmark (endcard only, full)
  filters.push(`[${wmIdx}:v]scale=210:-1,format=rgba,colorchannelmixer=aa=${IG.brand.watermarkOpacity}[wm]`);
  filters.push(`[${wordIdx}:v]scale=840:-1[word]`);
  filters.push(`[base][wm]overlay=x=${wmX}:y=${IG.safe.top + 6}[v1]`);
  filters.push(`[v1][word]overlay=x=(W-w)/2:y=(H-h)/2-70:enable='gte(t,${endStart})'[vout]`);

  const videoOnly = path.join(dir, "video-only.mp4");
  ff([
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[vout]",
    "-c:v", "libx264", "-preset", "medium", "-profile:v", "high", "-crf", String(IG.crf),
    "-g", "60", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-r", String(fps),
    "video-only.mp4",
  ], 900000, dir);
  return videoOnly;
}

export function masterAudio({ slug, voiceWav, musicFile, durationSec }) {
  const dir = workDirFor(slug);
  const mixRaw = path.join(dir, "mix-raw.wav");
  const voiceChain = "highpass=f=75,equalizer=f=3500:t=q:w=1:g=2.5,acompressor=ratio=3:attack=8:release=200:makeup=2,alimiter=limit=-1.5dB";

  // voice is PADDED to the full render duration (incl. the endcard tail) — otherwise
  // amix duration=first / mux -shortest truncate the video before the endcard shows.
  const pad = `apad=whole_dur=${durationSec.toFixed(3)}`;
  if (musicFile) {
    ff([
      "-i", voiceWav, "-stream_loop", "-1", "-i", musicFile,
      "-filter_complex",
      `[0:a]${voiceChain},aresample=${IG.audio.sr},${pad}[vc];` +
      `[1:a]volume=-${IG.audio.musicDuckDb - 6}dB,aresample=${IG.audio.sr},atrim=duration=${durationSec.toFixed(3)}[mtrim];` +
      `[vc]asplit=2[vmix][vkey];` +
      `[mtrim][vkey]sidechaincompress=threshold=0.02:ratio=10:attack=5:release=350[mduck];` +
      `[vmix][mduck]amix=inputs=2:duration=first:normalize=0,atrim=duration=${durationSec.toFixed(3)}[aout]`,
      "-map", "[aout]", mixRaw,
    ]);
  } else {
    ff(["-i", voiceWav, "-af", `${voiceChain},aresample=${IG.audio.sr},${pad},atrim=duration=${durationSec.toFixed(3)}`, mixRaw]);
  }

  // two-pass loudnorm (single-pass dynamic on TTS pumps — measured, then linear apply).
  // loudnorm's stats print to STDERR even on exit 0 — spawnSync captures both streams.
  let measured = null;
  const meas = spawnSync(
    FFMPEG,
    ["-hide_banner", "-i", mixRaw, "-af", `loudnorm=I=${IG.audio.lufs}:TP=${IG.audio.tp}:LRA=11:print_format=json`, "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  try {
    measured = JSON.parse(String(meas.stderr || meas.stdout || "").match(/\{[\s\S]*?"target_offset"[\s\S]*?\}/)?.[0] || "null");
  } catch { measured = null; }
  const mixWav = path.join(dir, "mix.wav");
  const ln = measured
    ? `loudnorm=I=${IG.audio.lufs}:TP=${IG.audio.tp}:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`
    : `loudnorm=I=${IG.audio.lufs}:TP=${IG.audio.tp}:LRA=11`;
  // gentle ease-out across the endcard tail — the audio breathes out with the video
  const fadeStart = Math.max(0, durationSec - IG.endTailSec * 0.6);
  ff(["-i", mixRaw, "-af", `${ln},afade=t=out:st=${fadeStart.toFixed(2)}:d=${(IG.endTailSec * 0.6).toFixed(2)}`, "-ar", String(IG.audio.sr), mixWav]);
  return mixWav;
}

export function mux({ slug, videoOnly, mixWav }) {
  const out = path.join(outDirFor(), `${slug}.mp4`);
  ff([
    "-i", videoOnly, "-i", mixWav,
    "-map", "0:v", "-map", "1:a",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ar", String(IG.audio.sr),
    "-movflags", "+faststart", "-shortest",
    out,
  ]);
  return out;
}

export function render({ slug, shots, assFile, mood, voiceWav, musicFile, durationSec }) {
  const total = durationSec + IG.endTailSec; // the video breathes OUT (owner: never slam shut)
  const videoOnly = renderVideo({ slug, shots: padShots(shots, total), assFile, mood, durationSec: total });
  const mixWav = masterAudio({ slug, voiceWav, musicFile, durationSec: total });
  return mux({ slug, videoOnly, mixWav });
}

function padShots(shots, total) {
  const out = shots.map((s) => ({ ...s }));
  if (out.length) out[out.length - 1].t1 = Math.max(out[out.length - 1].t1, total);
  return out;
}
