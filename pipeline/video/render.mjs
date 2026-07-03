// STAGE: RENDER v2 — "big channel" pass (owner 2026-07-03): slower/classier Ken Burns, premium rotating
// transitions (not plain fade), cinematic fade-to-black into the ANIMATED end-card (endcard.mp4), and a
// broadcast audio chain: voice EQ+compression, optional auto-ducked music bed, loudnorm to -14 LUFS.
// Anti-jitter rules kept: single-frame input, >=2.5x upscale BEFORE zoompan, expressions on 'on'.
// Output stays spec-locked for Meta (error 2207026 guard): SDR yuv420p H.264 + AAC 128k 48kHz, moov front.
import { execFile } from "node:child_process";
import path from "node:path";
import { VIDEO } from "./config.mjs";

const run = (args, timeout = 600000) =>
  new Promise((res, rej) =>
    execFile("ffmpeg", args, { maxBuffer: 16 * 1024 * 1024, timeout }, (e, so, se) =>
      e ? rej(new Error(`ffmpeg: ${e.message}\n${String(se).slice(-1200)}`)) : res(String(se))
    )
  );

// Slow, premium Ken Burns (v2: 12% travel — half the v1 speed) alternating in/out + pan anchors.
const kb = (i, D) => {
  const pats = [
    `z='1+0.12*on/${D}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
    `z='1.12-0.12*on/${D}':x='iw/2-(iw/zoom/2)':y='0'`,
    `z='1+0.12*on/${D}':x='(iw/zoom/2)*on/${D}':y='ih/2-(ih/zoom/2)'`,
    `z='1.12-0.12*on/${D}':x='iw/2-(iw/zoom/2)':y='ih-(ih/zoom)'`,
  ];
  return pats[i % pats.length];
};
// Rotating premium transition set for content beats (endcard entry is always fadeblack).
const XF = ["smoothleft", "zoomin", "smoothright", "smoothup"];

export async function renderVideo({ images, audio, assFile, out, duration, watermark = null, endcard = null, music = null }) {
  const N = images.length, X = VIDEO.crossfadeSec, fps = VIDEO.fps;
  const T = Math.min(duration + 0.4, VIDEO.maxSec); // content length: small tail after the voice ends
  const EC_X = 0.5, EC_LEN = endcard ? 3.4 : 0;
  const total = endcard ? T - EC_X + EC_LEN : T;
  // STORYBOARD TIMING (v3): each image's visible length tracks its narration beat's weight, so what's
  // on screen matches what's being SAID. Segments sum to T + X*(N-1) (xfades overlap); min 1.3s each.
  const need = T + X * (N - 1);
  const wts = images.map((im) => Math.max(im.weight || 1, 0.0001));
  const sumW = wts.reduce((a, b) => a + b, 0);
  let Ls = wts.map((w) => (w / sumW) * need);
  const MIN_L = Math.max(X + 0.4, 1.3);
  const fixed = Ls.map((l) => l < MIN_L);
  const fixedSum = Ls.reduce((a, l, i) => a + (fixed[i] ? MIN_L : 0), 0);
  const freeSum = Ls.reduce((a, l, i) => a + (fixed[i] ? 0 : l), 0);
  Ls = Ls.map((l, i) => (fixed[i] ? MIN_L : (l / freeSum) * (need - fixedSum)));
  const args = ["-y", "-loglevel", "error"];
  for (const img of images) args.push("-i", img.file || img);
  args.push("-i", audio); // input N (voice wav)
  let idx = N + 1;
  let ecIdx = -1, wmIdx = -1, musIdx = -1;
  if (endcard) { args.push("-i", endcard); ecIdx = idx++; } // pre-animated endcard.mp4
  if (watermark) { args.push("-i", watermark); wmIdx = idx++; }
  if (music) { args.push("-stream_loop", "-1", "-i", music); musIdx = idx++; }

  let g = "";
  for (let i = 0; i < N; i++) {
    const D = Math.max(Math.round(Ls[i] * fps), Math.round(MIN_L * fps));
    // cast composites are already busy layouts — barely-there zoom so faces/labels stay whole
    const motion = /^(grid|hero):/.test(String(images[i].visual || ""))
      ? `z='1+0.04*on/${D}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`
      : kb(i, D);
    g += `[${i}:v]scale=2700:4800:force_original_aspect_ratio=increase,crop=2700:4800,setsar=1,zoompan=${motion}:d=${D}:s=${VIDEO.width}x${VIDEO.height}:fps=${fps},format=yuv420p[v${i}];`;
  }
  let last = "[v0]", acc = 0;
  for (let i = 1; i < N; i++) {
    acc += Ls[i - 1];
    const off = (acc - i * X).toFixed(2);
    g += `${last}[v${i}]xfade=transition=${XF[(i - 1) % XF.length]}:duration=${X}:offset=${off}[x${i}];`;
    last = `[x${i}]`;
  }
  // captions (fontsdir = repo-shipped Anton) + low-opacity brand watermark on the CONTENT…
  const fesc = (s) => s.replace(/([\\:'])/g, "\\$1");
  g += `${last}ass=${fesc(assFile)}:fontsdir=${fesc(VIDEO.fontsDir)}[sub];`;
  if (watermark) g += `[${wmIdx}:v]scale=350:-1,format=rgba,colorchannelmixer=aa=0.45[wm];[sub][wm]overlay=W-w-38:46[br];`;
  else g += `[sub]null[br];`;
  // …then FADE TO BLACK into the animated end-card
  if (endcard) {
    g += `[${ecIdx}:v]fps=${fps},scale=${VIDEO.width}:${VIDEO.height},setsar=1,format=yuv420p[ec];`;
    g += `[br][ec]xfade=transition=fadeblack:duration=${EC_X}:offset=${(T - EC_X).toFixed(2)}[vout];`;
  } else g += `[br]null[vout];`;
  // AUDIO: voice clean-up -> (optional music bed, ducked under the voice) -> broadcast loudness -> tail fade
  g += `[${N}:a]highpass=f=75,acompressor=threshold=-20dB:ratio=2.8:attack=8:release=140[vc];`;
  if (music) {
    g += `[vc]asplit=2[vmix][vduck];`; // a labeled pad is consumed once — split for ducker + mixer
    // owner 2026-07-03: bed was drowning the voice — pre-cut to 0.8, duck harder, mix at 0.12 (subtle presence)
    g += `[${musIdx}:a]atrim=0:${total.toFixed(2)},volume=0.8[mus];`;
    g += `[mus][vduck]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=380[md];`;
    g += `[vmix][md]amix=inputs=2:duration=first:normalize=0:weights='1 0.17',apad[mix];`;
  } else g += `[vc]apad[mix];`;
  g += `[mix]loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=${(total - 0.8).toFixed(2)}:d=0.8[aout]`;

  args.push(
    "-filter_complex", g, "-map", "[vout]", "-map", "[aout]", "-t", total.toFixed(2),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", out
  );
  await run(args);
  return { out, seconds: total, images: N };
}
