// REELS VIDEO AUTOMATION — config (see /Users/sivajithcu/Movie News site/REELS_AUTOMATION_PLAN.md).
// Self-contained on purpose: the article pipeline's config.mjs is NOT touched (owner: no damage to the
// article automation). Same conventions: absolute paths, cheap-models-only hard rule.
const ROOT = "/Users/sivajithcu/Movie News site";

export const VIDEO = {
  // ── models (cheap-only hard rule; both already in the article pipeline's allowlist family)
  scriptModel: "google/gemini-2.5-flash", // best natural spoken-hook copy among cheap models (research 2026-07-02)
  scriptModelFallback: "deepseek/deepseek-v3.2",
  visionModel: "google/gemini-2.5-flash-lite", // image identity/event/watermark gate (~$0.0002/check)

  // ── voice (Kokoro-82M via kokoro-onnx: $0 forever, runs on CPU; af_heart = grade-A energetic narrator)
  voice: "af_heart",
  speed: 1.0, // owner 2026-07-03: 1.08 read too fast — natural pace so every word lands (still energetic via af_heart)
  python: `${ROOT}/video-venv/bin/python`,
  modelDir: `${ROOT}/video-models`, // kokoro-v1.0.onnx (310MB) + voices-v1.0.bin — outside the repo; CI restores from release URL + actions/cache

  // ── SENSITIVITY POLICY (Phase 2, owner-approved plan): death stories "block" (default) or "somber"
  // (proceed with forced somber register + no music). Legal/minor-involved stories are ALWAYS blocked.
  sensitivePolicy: "block",

  // ── daily throughput
  dailyCount: 10, // videos per day at full speed (test runs pass --count)
  windowHours: 24, // pick from articles published in this window

  // ── output (v2, owner 2026-07-03: 30-40s detailed scripts, snappier premium transitions)
  width: 1080,
  height: 1920,
  fps: 30,
  minSec: 25,
  maxSec: 45, // hard ceiling; the script word-count guard (65-125 words) keeps us ~30-40s
  crossfadeSec: 0.45,
  minImageWidth: 700, // code-side floor — vision models can't judge original resolution (providers downscale)

  // ── dirs (data/video/* mirrors data/find/* conventions: plain inspectable JSON + artifacts)
  workDir: `${ROOT}/site/data/video/work`,
  outDir: `${ROOT}/site/data/video/out`, // finished MP4s + caption sidecars; the X/YouTube manual OUTBOX for now
  assetsDir: `${ROOT}/site/pipeline/video/assets`, // logo-white.png, endcard.mp4, fonts/, music/
  fontsDir: `${ROOT}/site/pipeline/video/assets/fonts`, // Anton (captions) — shipped with the repo
  musicDir: `${ROOT}/site/pipeline/video/assets/music`, // optional CC/royalty-free beds; auto-ducked under the voice
};
