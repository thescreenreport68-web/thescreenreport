// YIF MULTI-AGENT AUTOMATION (YouTube + Instagram + Facebook) — config. (Formerly the IG-only lane;
// folder stays pipeline/ig/ by owner choice.) Plan: /YIF_IMPLEMENTATION_PLAN.md.
// FULLY SELF-CONTAINED + INDEPENDENT (owner 2026-07-13): NOTHING is imported from, read from, or
// written to any other automation (incl. pipeline/video/ and its ledger). This lane takes content
// ONLY from the news + gossip automations and posts ONLY to YouTube/Instagram/Facebook; the old
// video automation keeps Pinterest and must never interact with this one.
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
    // Writer: GPT-4.1-mini primary, Haiku 4.5 fallback (owner 2026-07-12). Haiku wrote the best-QUALITY
    // scripts in the bake-off but proved TOO UNRELIABLE in live runs — it persistently over-writes
    // (17-22w hooks vs the 16 cap, 20-23w sentences, 146-159w totals) and botches the mandatory
    // question+CTA ending, and the mechanical repair CANNOT fix an over-long ending → it HELD 3 straight
    // runs (build rate ~27%). GPT-4.1-mini built 100% of test topics, is faithful + no-fourth-wall, and is
    // ~6x cheaper. Reliability wins for a 24/7 automation; Haiku stays as the fallback. (owner 2026-07-12)
    writer: ["openai/gpt-4.1-mini", "anthropic/claude-haiku-4.5"],
    caption: ["google/gemini-2.5-flash-lite", "inclusionai/ling-2.6-flash"],
    vision: ["google/gemini-2.5-flash-lite", "qwen/qwen3.5-flash-02-23"],
    judge: ["google/gemini-2.5-flash", "google/gemini-2.5-flash-lite"],
    // FULL gpt-audio, marin (owner 2026-07-13): the MINI is a chat model that intermittently CONVERSES
    // ("Got it!…") or RUNS AWAY (100s+ of audio) instead of narrating → constant Kokoro/holds. The full
    // gpt-audio stays reliable (tested: mini 0/3 runaway vs gpt-audio 3/3 clean, same marin voice, same
    // OpenRouter key). Costs ~$0.02/video for the bake-off — reliability wins. Kokoro is last resort.
    voice: "openai/gpt-audio",
    music: "google/lyria-3-clip-preview", // streamed mp3, ~30s, $0.04/clip
  },
  // ── voice quality system (owner feedback 2026-07-10: flow/pauses/engagement were bad).
  // Every take is pause-tightened, then JUDGED BY EAR (audio-input listening agent) before
  // the video may render. First runs bake off candidate voices; the winner persists in
  // weights.json and later runs do single-take + judge floor.
  voice: {
    candidates: [process.env.IG_VOICE, "marin", "ash"].filter(Boolean), // first-run bake-off; marin is owner-locked in weights.json
    // Chunked synthesis DISABLED (bake-off rounds 3-5: every chunk join reads as a
    // momentum break — single-call reads consistently score higher). 0 = single call.
    chunkSentences: 0,
    joinSilenceSec: 0.18,
    takesPerVoice: 3, // delivery variance is high (same voice scored 10 and 22) — best-of-3
    // ADAPTIVE PACE (owner 2026-07-13): gpt-audio-mini reads at a VARYING fast rate (~3.5-4.0 wps) and
    // IGNORES "speak slower" prompts, so a FIXED slowdown can't normalize it (0.95 fixed left one take
    // at 3.4 and another at 3.8). Instead we MEASURE each take's real pace and slow it just enough to
    // hit targetWps (ffmpeg atempo, PITCH-PRESERVED — voice sounds identical, just a touch slower),
    // CLAMPED so it never speeds a slow take up (≤1.0) and never over-slows (≥minTempo: a 4.0-wps read
    // lands at ~3.4, faster reads are capped so it's never too slow). Applied before whisper-align so
    // subtitles/images stay in sync. pace:null = off.
    pace: { targetWps: 3.4, minTempo: 0.85 },
    // calibrated to the owner's ACTUAL bars: every axis ≥6 (his rejected take had
    // pauses=5), the ending MUST land, and the total floor fits 33-42s reads (long
    // reads score structurally lower than the short ones the old floor was tuned on)
    floorPerAxis: 6,
    floorTotal: 18,
    // The ear-judge RANKS takes well but is a NOISY absolute gate (identical marin delivery scores
    // 8-22). marin is the owner's APPROVED voice, so a noisy low score must not HOLD an otherwise-
    // good video — ship the best marin take with a warning and let the owner arbitrate; only a truly
    // broken read (<8) or the owner-rejected Kokoro fallback still holds. (owner 2026-07-12)
    hardFloorScore: 8, // below this = unusable, hold; between hardFloor and floor = ship best + warn
    // -34dB (not -40): TTS breath/room tone sits ~-38dB and must count as silence,
    // or long gaps survive the tightener (bake-off finding 2026-07-10).
    // protectTailSec: the ENDING must breathe — no tightening inside the final beat
    // (owner: the ask needs a natural pause before it, never slammed).
    // keepSilence 0.22 → 0.26: leave inter-sentence pauses a touch longer so the read breathes and
    // is easier to follow (owner 2026-07-12: "reduce the pacing a little"). Paired with the slower
    // delivery prompt; both nudges are small so durations stay inside the 25-44s band.
    tighten: { minSilence: 0.3, keepSilence: 0.26, threshold: "-34dB", protectTailSec: 4.5, floorSec: 30 },
    maxLongGaps: 1, // remaining pauses >0.45s allowed after tightening (outside the tail)
  },
  endTailSec: 1.8, // endcard/audio ease-out after the last word (was 0.9 — too abrupt)

  // ── caps + ramp (plan §1.9/§6.1) — the orchestrator enforces these in code.
  maxPerDay: 7, // owner 2026-07-13: 7 posts/day, one per LA slot (10a/12p/2p/4p/6p/8p/10p)
  hardDailyCap: 20, // absolute (platform quota is 50-100; we stay far under)
  maxRunUsd: 5.0, // kill the run if spend exceeds this — raised for the build-ahead model (7 reels/run)
  maxJobUsd: 0.80, // park a single job if it alone exceeds this
  freshDays: 10, // scout candidate window. Reels REPURPOSE already-published entertainment stories — a gossip/box-office piece from a week ago is still perfectly shareable (it's not breaking news), and a 4-day window left the gossip lane with 0 candidates (56/91 aged out). 10 days keeps a healthy slate. (owner 2026-07-12)
  categories: ["movies", "tv", "celebrity"],
  moviesFirstShare: 0.8, // ~80/20 movies-first bias in slate scoring

  // ── script bounds (owner 2026-07-10: EVERY video ≥30s, target 30-40s; still NO
  // padding — length comes from verified facts, thin stories are skipped by the scout)
  // Length band 25-40s (owner 2026-07-11): 25s is the HARD floor (never below), 30-40s is the
  // TARGET the writer reaches for. minWords clears 25s even at a fast ~3.7wps read; the writer
  // engagingly expands a thin story up to the floor rather than holding. wps = the observed
  // gpt-audio pace after pause-tightening.
  script: { minWords: 88, maxWords: 136, minSec: 25, maxSec: 44, targetSec: [30, 40], wps: 3.4 },

  // Enrichment (owner 2026-07-12): when OUR article yields fewer than `minFacts` verified facts,
  // pull MORE verified facts about the SAME people/event from related news so the reel can reach
  // length — never padding/inventing (every added fact is re-verified). Best-effort; only for thin
  // stories. maxFullFetches caps the deeper Jina article fetches per run (snippets are always used).
  enrich: { minFacts: 7, maxAdd: 5, maxFullFetches: 3 },

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

  // ── slots (owner 2026-07-13): 7 posts/day at fixed LOS ANGELES local times. `timezone` drives
  // slot computation (nextEt) and `postTz` is what Zernio schedules against — both LA now, so the
  // times are DST-correct year-round. Small jitter keeps it human without drifting off the hour.
  // (the `primeET` key name is kept for back-compat; the values are LA times.)
  slots: { primeET: ["10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00"], timezone: "America/Los_Angeles", postTz: "America/Los_Angeles", jitterMin: 4 },

  // ── multi-platform distribution (YIF: YouTube + Instagram + Facebook). One build → all enabled
  // platforms, same LA slots. Instagram + Facebook post via Zernio; YouTube via Buffer. Account IDs
  // live-verified 2026-07-05 (from the old video lane's accounts.mjs). Pinterest is a SEPARATE future
  // automation, deliberately excluded here. Per-platform kill switch: data/ig/PAUSED_<PLATFORM>.
  // This automation OWNS Instagram + Facebook + YouTube (news + gossip content only). Pinterest is
  // handled by the SEPARATE old video automation — this lane never posts there. FB + YouTube were
  // live-proven (a real test posted to both). A run can override with --platforms=... for a targeted
  // test. (owner 2026-07-13)
  platforms: ["instagram", "facebook", "youtube"],
  siteBase: "https://thescreenreport.com", // for the YouTube description's article link

  // ── zernio (bridge; posts via Meta's official API — no reach penalty, verified) → Instagram + Facebook
  zernio: {
    base: "https://zernio.com/api/v1",
    igAccountId: "6a49d2b69d9472faae7e109f", // The Screen Report IG (verified 2026-07-05)
    fbAccountId: "6a49d30b9d9472faae7e1258", // The Screen Report Facebook Page (verified 2026-07-05)
    isAiGenerated: true, // plan §1.8 — Meta requires disclosure for realistic AI audio
    audioName: "The Screen Report",
  },
  // ── buffer (bridge; GraphQL, Periphery plan) → YouTube Shorts
  buffer: {
    base: "https://api.buffer.com",
    youtubeChannel: "6a49d51440483446286f712e", // The Screen Report YouTube channel (verified 2026-07-05)
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
