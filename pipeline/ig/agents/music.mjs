// AGENT 15 — MUSIC DIRECTOR (plan §2.2 #15, §5.4): score-inspired ORIGINAL beds.
// Style profile (genre/mood/tempo/instrumentation — NEVER a composer/track name) →
// Lyria 3 clip ($0.04) → cached per profile-key forever → owned-library fallback.
// Somber stories get NO music (sensitivity rule).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { IG } from "../config.mjs";
import { llm, music as lyria } from "../models.mjs";
import { ensureDir } from "../lib/util.mjs";
import { appendAudioProvenance } from "../lib/ledger.mjs";

const SYS = `You write a music-generation brief for an ORIGINAL 30-second instrumental bed under a Hollywood entertainment-news voiceover on Instagram Reels. It must sound PREMIUM and CONTEMPORARY — a bed under a top entertainment brand's reel — never generic stock, corporate, or elevator music.
Return STRICT JSON {"styleProfile":string,"cacheKey":string}.
styleProfile: 14-28 words of pure style language — genre, mood, tempo (give a BPM), instrumentation, groove, and an energy ARC that subtly BUILDS (never flat). Match the story: celebrity/gossip => glossy modern pop or confident hip-hop-tinged groove with tasteful bounce; box office/trailer => epic cinematic orchestral with driving percussion; awards => elegant and refined; TV => sleek contemporary. Keep it hooky and forward-driving but MIX-SAFE under a voice — no busy melodic leads, leave a clean mid pocket for the voiceover. e.g. "glossy modern pop-culture groove, ~100 BPM, warm synth bass, crisp finger-snaps and soft claps, tasteful bounce, subtly building, clean space for voiceover".
HARD RULE: never name a film, franchise, composer, artist, or song — style words only.
cacheKey: a short kebab-case genre-mood key (e.g. "gossip-glossy-pop", "epic-superhero-dark", "awards-elegant") so similar stories reuse the same bed family.`;

const BANNED_IN_PROMPT = /\b(john williams|hans zimmer|zimmer|goransson|göransson|elfman|morricone|score of|theme from|soundtrack of)\b/i;

// DETERMINISTIC cache key from segment family + mood (owner audit 2026-07-16): the style-brief LLM
// call used to fire on EVERY reel just to compute the cache key — even when the bed was already
// cached. The key is now derived deterministically FIRST (cache check = zero LLM calls); the LLM
// writes the Lyria prompt only on an actual cache miss.
const SEG_FAMILY = {
  "celebrity wire": "gossip-glossy",
  "box office in 30": "epic-cinematic",
  "trailer take": "epic-cinematic",
  "tv signal": "tv-sleek",
  "casting watch": "news-modern",
};
export function musicCacheKey(segment, mood) {
  const fam = SEG_FAMILY[String(segment || "").toLowerCase().trim()] || "neutral-news";
  return `${fam}-${mood || "neutral"}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export async function pickMusic({ facts, mood, segment }) {
  if (mood === "somber") return { none: true, reason: "somber story — no music" };
  ensureDir(IG.musicDir);

  // cache FIRST — a hit costs zero LLM calls (the beds are committed, so CI runs start warm too)
  const key = musicCacheKey(segment, mood);
  const variants = fs.existsSync(IG.musicDir) ? fs.readdirSync(IG.musicDir).filter((f) => f.startsWith(key + "-") && f.endsWith(".mp3")) : [];
  const storyHash = crypto.createHash("md5").update(facts.storyOneLine || "").digest("hex");
  if (variants.length >= 2) {
    const pickIdx = parseInt(storyHash.slice(0, 6), 16) % variants.length;
    return { file: path.join(IG.musicDir, variants[pickIdx]), engine: "lyria-cache", styleProfile: key, cacheKey: key, cost: 0 };
  }

  // cache miss → the LLM writes the Lyria prompt (style words only; the key stays deterministic)
  let profile;
  try {
    profile = await llm({
      role: "classify",
      system: SYS,
      user: `STORY: ${facts.storyOneLine}\nMOOD: ${mood}\nSEGMENT: ${segment}\nGENRE HINTS: ${facts.entities.map((e) => `${e.name}(${e.kind})`).join(", ")}`,
      temp: 0.3,
      maxTokens: 150,
      json: true,
    });
  } catch {
    profile = { styleProfile: "glossy modern entertainment groove, mid-tempo, warm bass, crisp light percussion, subtly building, clean space for voiceover" };
  }
  if (BANNED_IN_PROMPT.test(profile.styleProfile || "")) {
    profile.styleProfile = "glossy modern entertainment groove, mid-tempo, warm bass, crisp light percussion, subtly building, clean space for voiceover";
  }

  try {
    const { mp3, cost } = await lyria({ prompt: `Instrumental only, no vocals. ${profile.styleProfile}. Clean loop-friendly ending.` });
    const file = path.join(IG.musicDir, `${key}-${variants.length + 1}.mp3`);
    fs.writeFileSync(file, mp3);
    appendAudioProvenance({ file: path.basename(file), engine: "lyria-3-clip", prompt: profile.styleProfile, cacheKey: key, cost });
    return { file, engine: "lyria", styleProfile: profile.styleProfile, cacheKey: key, cost };
  } catch (e) {
    // library fallback: owned/CC beds (legacy dir is read-only asset reuse, no code coupling)
    const lib = fs.existsSync(IG.legacyMusicDir) ? fs.readdirSync(IG.legacyMusicDir).filter((f) => f.endsWith(".mp3")) : [];
    if (!lib.length) return { none: true, reason: `lyria failed (${e.message}) and no library beds` };
    const moodMap = { celebratory: "upbeat", fun: "upbeat", epic: "tense", tense: "tense", neutral: "neutral" };
    const want = moodMap[mood] || "neutral";
    const hit = lib.find((f) => f.includes(want)) || lib[0];
    return { file: path.join(IG.legacyMusicDir, hit), engine: "library", styleProfile: want, cacheKey: "library", cost: 0 };
  }
}
