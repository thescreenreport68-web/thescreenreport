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

const SYS = `You write a music-generation brief for an ORIGINAL 30-second instrumental bed under a Hollywood news voiceover.
Return STRICT JSON {"styleProfile":string,"cacheKey":string}.
styleProfile: 12-25 words of pure style language — genre, mood, tempo, instrumentation, energy arc (e.g. "dark heroic cinematic orchestral, driving low brass, taiko percussion, rising tension, blockbuster trailer energy").
HARD RULE: never name a film, franchise, composer, artist, or song — style words only.
cacheKey: a short kebab-case genre-mood key (e.g. "epic-superhero-dark", "romcom-light", "awards-elegant") so similar stories reuse the same bed family.`;

const BANNED_IN_PROMPT = /\b(john williams|hans zimmer|zimmer|goransson|göransson|elfman|morricone|score of|theme from|soundtrack of)\b/i;

export async function pickMusic({ facts, mood, segment }) {
  if (mood === "somber") return { none: true, reason: "somber story — no music" };
  ensureDir(IG.musicDir);

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
    profile = { styleProfile: "modern cinematic underscore, mid-tempo pulse, neutral tension, clean percussion", cacheKey: "neutral-news" };
  }
  if (BANNED_IN_PROMPT.test(profile.styleProfile || "")) {
    profile.styleProfile = "modern cinematic underscore, mid-tempo pulse, neutral tension, clean percussion";
    profile.cacheKey = "neutral-news";
  }

  const key = (profile.cacheKey || "neutral-news").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  // cache: up to 3 variants per key, rotate deterministically by story hash
  const variants = fs.existsSync(IG.musicDir) ? fs.readdirSync(IG.musicDir).filter((f) => f.startsWith(key + "-") && f.endsWith(".mp3")) : [];
  const storyHash = crypto.createHash("md5").update(facts.storyOneLine || "").digest("hex");
  if (variants.length >= 2) {
    const pickIdx = parseInt(storyHash.slice(0, 6), 16) % variants.length;
    return { file: path.join(IG.musicDir, variants[pickIdx]), engine: "lyria-cache", styleProfile: profile.styleProfile, cacheKey: key, cost: 0 };
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
