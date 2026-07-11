// INSTAGRAM REELS MULTI-AGENT AUTOMATION — config
// Plan: /INSTAGRAM_REELS_MULTI_AGENT_PLAN.md (REV 2). Self-contained lane — NOTHING is imported
// from pipeline/video/ (owner directive 2026-07-10: the old automation must not interfere).
// The ONLY cross-lane touch is READ-ONLY dedup against data/video/posted.json.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SITE = process.env.TSR_SITE || path.resolve(HERE, "..", "..");
const PARENT = path.dirname(SITE);

// ffmpeg/ffprobe resolution: env override → the pinned static full build in the venv
// (homebrew silently swapped in a slim libass-less ffmpeg mid-2026-07-10 and broke
// subtitle rendering — never trust the system binary again) → PATH fallback (CI apt
// ffmpeg is a full build).
function avBin(name) {
  if (process.env[`TSR_${name.toUpperCase()}`]) return process.env[`TSR_${name.toUpperCase()}`];
  const staticBin = path.join(PARENT, "video-venv", "lib", "python3.13", "site-packages", "static_ffmpeg", "bin", "darwin_arm64", name);
  if (fs.existsSync(staticBin)) return staticBin;
  return name;
}
export const FFMPEG = avBin("ffmpeg");
export const FFPROBE = avBin("ffprobe");

export const IG = {
  // ── prime directive: every knob below exists to make each reel go viral on Instagram.

  // ── model registry (verified live on OpenRouter 2026-07-10; $/M in the plan §2.1).
  // Every role = [primary, fallback]; OpenRouter routes to fallback automatically via `models`.
  // NOTE (review 2026-07-10): amazon/nova-micro-v1 does NOT support response_format on
  // OpenRouter — with json mode it gets filtered out of routing. All json-mode roles use
  // response_format-capable models only.
  models: {
    classify: ["inclusionai/ling-2.6-flash", "google/gemini-2.5-flash-lite"],
    gather: ["qwen/qwen3.5-flash-02-23", "google/gemini-2.5-flash-lite"],
    verify: ["google/gemini-2.5-flash-lite", "openai/gpt-5-nano"],
    writer: ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v3.2"],
    caption: ["google/gemini-2.5-flash-lite", "inclusionai/ling-2.6-flash"],
    vision: ["google/gemini-2.5-flash-lite", "qwen/qwen3.5-flash-02-23"],
    judge: ["google/gemini-2.5-flash", "google/gemini-2.5-flash-lite"],
    voice: "openai/gpt-audio-mini", // streamed pcm16@24kHz; verbatim wall + Kokoro fallback
    music: "google/lyria-3-clip-preview", // streamed mp3, ~30s, $0.04/clip
  },
  // ── voice quality system (owner feedback 2026-07-10: flow/pauses/engagement were bad).
  // Every take is pause-tightened, then JUDGED BY EAR (audio-input listening agent) before
  // the video may render. First runs bake off candidate voices; the winner persists in
  // weights.json and later runs do single-take + judge floor.
  voice: {
    candidates: [process.env.IG_VOICE, "marin", "ash"].filter(Boolean), // cedar-on-mini aborts repeatedly — premium-only
    // premium gpt-audio BANNED from bake-offs: it lost every round tonight (scored
    // 4-17, never beat mini) at 30x the cost
    premiumCandidate: null,
    // Chunked synthesis DISABLED (bake-off rounds 3-5: every chunk join reads as a
    // momentum break — single-call reads consistently score higher). 0 = single call.
    chunkSentences: 0,
    joinSilenceSec: 0.18,
    takesPerVoice: 3, // delivery variance is high (same voice scored 10 and 22) — best-of-3
    // calibrated to the owner's ACTUAL bars: every axis ≥6 (his rejected take had
    // pauses=5), the ending MUST land, and the total floor fits 33-42s reads (long
    // reads score structurally lower than the short ones the old floor was tuned on)
    floorPerAxis: 6,
    floorTotal: 18,
    hardFloorScore: 12, // below this = unusable, hold; between hardFloor and floor = ship best + warn
    // -34dB (not -40): TTS breath/room tone sits ~-38dB and must count as silence,
    // or long gaps survive the tightener (bake-off finding 2026-07-10).
    // protectTailSec: the ENDING must breathe — no tightening inside the final beat
    // (owner: the ask needs a natural pause before it, never slammed).
    tighten: { minSilence: 0.3, keepSilence: 0.22, threshold: "-34dB", protectTailSec: 4.5, floorSec: 30 },
    maxLongGaps: 1, // remaining pauses >0.45s allowed after tightening (outside the tail)
  },
  endTailSec: 1.8, // endcard/audio ease-out after the last word (was 0.9 — too abrupt)

  // ── caps + ramp (plan §1.9/§6.1) — the orchestrator enforces these in code.
  maxPerDay: 4, // ramp ceiling; week-1 operators run --limit=1
  hardDailyCap: 20, // absolute (platform quota is 50-100; we stay far under)
  maxRunUsd: 1.0, // kill the run if LLM+voice+music spend exceeds this
  maxJobUsd: 0.25, // park a single job if it alone exceeds this
  freshDays: 2, // scout candidate window
  categories: ["movies", "tv", "celebrity"],
  moviesFirstShare: 0.8, // ~80/20 movies-first bias in slate scoring

  // ── script bounds (owner 2026-07-10: EVERY video ≥30s, target 30-40s; still NO
  // padding — length comes from verified facts, thin stories are skipped by the scout)
  // wps is the OBSERVED gpt-audio pace after pause-tightening (~3.6, faster than a human read);
  // the word floor is set so even a fast read clears the 30s minimum, and the ceiling gives
  // the writer room (108-144 words ≈ 30-40s) so it doesn't hold by overshooting. (2026-07-11)
  script: { minWords: 108, maxWords: 144, minSec: 30, maxSec: 48, targetSec: [33, 42], wps: 3.4 },

  // ── render spec (plan §1.3 anti-downrank invariants + §5.6 premium bar)
  width: 1080,
  height: 1920,
  fps: 30,
  upscale: [2700, 4800], // pre-zoompan canvas (anti-jitter)
  maxShotSec: 3.5, // visual change at least this often (sync-checker hard rule)
  maxStaticSec: 4.0,
  entitySyncTolSec: 0.7, // entity image on screen within ±this of the spoken name
  crf: 20,
  audio: { lufs: -14, tp: -1.5, musicDuckDb: 18, sr: 48000 },

  // ── safe zones, px on 1080x1920 (community spec; Step-0 empirical check may adjust)
  safe: { top: 130, bottom: 340, left: 64, right: 128, coverBox: [0, 240, 1080, 1680] }, // coverBox = centered 3:4

  // ── brand (site design system: paper/ink/red; wordmark = NATIVE TYPE, never an image logo)
  brand: {
    wordmark: "THE SCREEN REPORT",
    red: "&H2626DC&", // ASS BGR for #DC2626-ish brand red
    white: "&HFFFFFF&",
    ink: "&H1A1512&",
    font: "Anton",
    watermarkOpacity: 0.7,
  },

  // ── slots (plan §1.9): breaking posts immediately; else prime ET slots, jittered
  slots: { primeET: ["12:30", "19:30"], timezone: "America/New_York", postTz: "America/Los_Angeles", jitterMin: 9 },

  // ── zernio (bridge; posts via Meta's official API — no reach penalty, verified)
  zernio: {
    base: "https://zernio.com/api/v1",
    igAccountId: "6a49d2b69d9472faae7e109f", // The Screen Report IG (verified 2026-07-05)
    isAiGenerated: true, // plan §1.8 — Meta requires disclosure for realistic AI audio
    audioName: "The Screen Report",
  },
  // public hosting for the mp4/cover (bridges fetch by URL) — the tsr-media public repo
  host: { repo: "thescreenreport68-web/tsr-media", dir: "ig", pruneDays: 14 },

  // ── paths (state lives ONLY under site/data/ig/)
  dataDir: `${SITE}/data/ig`,
  workDir: `${SITE}/data/ig/work`,
  outDir: `${SITE}/data/ig/out`,
  musicDir: `${SITE}/data/ig/music`, // the Lyria bed cache
  runsDir: `${SITE}/data/ig/runs`,
  articlesDir: `${SITE}/content/articles`,
  oldVideoLedger: `${SITE}/data/video/posted.json`, // READ-ONLY cross-lane dedup
  assetsDir: `${HERE}/assets`,
  fontsDir: `${HERE}/assets/fonts`,
  legacyMusicDir: `${SITE}/pipeline/video/assets/music`, // read-only fallback beds if Lyria is down

  // ── python (whisper align, face crop, kokoro fallback)
  python: process.env.TSR_PYTHON || `${PARENT}/video-venv/bin/python`,
  kokoroModels: process.env.TSR_MODELS || `${PARENT}/video-models`,

  // ── kill switch
  pausedFile: `${SITE}/data/ig/PAUSED`,
};
export default IG;
