// Deterministic gates (plan §1.7 + §5.3 + §2.2 agents 6/9) — the viral rulebook as code.
// Every rule returns a machine-readable violation list; empty list = pass.
import { IG } from "../config.mjs";
import { normWords } from "./util.mjs";

// Meta-documented demotion patterns (engagement bait + watchbait) — hard bans.
const BAIT_RE = [
  /\bwait for it\b/i,
  /\bwatch (till|until) the end\b/i,
  /\byou won'?t believe\b/i,
  /\b(his|her|their) reaction (says|was)\b/i,
  /\bcomment\s+(yes|no|below|if)\b/i,
  /\btag (a|your|someone)\b/i,
  /\blike (this (video|reel|post)|if you)\b/i, // imperative bait only — "movies like this" is fine
  /\bshare (this|if) (to|you)\b/i,
  /\bgiveaway\b/i,
  /\bfollow for more\b/i,
  /\blink in bio\b/i,
];
// Weak/meta hooks (fix D from the old lane, kept as a fresh rule).
const WEAK_HOOK_RE = /^\s*\w+[^.!?]*\b(revealed|teased|talks about|opened? up|discusse[sd]|share[sd]|addresse[sd])\b[^.!?]*[.!?]/i;
const GREETING_RE = /^\s*(hey|hi|hello|welcome|what'?s up|good (morning|evening)|in (recent|today'?s) news|the screen report here)/i;

export function estimateSeconds(words) {
  return words / IG.script.wps;
}

// ── SCRIPT LINT (agent 6) ──────────────────────────────────────────────────────
export function lintScript(script, entities = [], topicText = "") {
  const v = [];
  const sentences = (script.sentences || []).map((s) => (typeof s === "string" ? s : s.text)).filter(Boolean);
  if (!sentences.length) return [{ rule: "empty", detail: "no sentences" }];
  const full = sentences.join(" ");
  const words = normWords(full);
  const hook = sentences[0];
  const hookWords = normWords(hook);

  if (hookWords.length > 14) v.push({ rule: "hook-too-long", detail: `${hookWords.length} words (max 14)` });
  if (GREETING_RE.test(hook)) v.push({ rule: "hook-greeting", detail: hook.slice(0, 60) });
  if (WEAK_HOOK_RE.test(hook) && !/\d/.test(hook)) v.push({ rule: "hook-meta", detail: "process-framing hook without a concrete payoff" });
  const entityTokens = entities.flatMap((e) => normWords(e.name || e)).filter((t) => t.length > 2);
  if (entityTokens.length && !hookWords.some((w) => entityTokens.includes(w)))
    v.push({ rule: "hook-no-entity", detail: "first sentence must name the star/film" });

  for (const re of BAIT_RE) if (re.test(full)) v.push({ rule: "bait", detail: re.source });

  for (const s of sentences) {
    const n = normWords(s).length;
    // a sentence carrying a verbatim QUOTE can't be split without breaking the quote
    const cap = /["“'‘][^"”'’]{10,}["”'’]/.test(s) ? 27 : 20;
    if (n > cap) v.push({ rule: "sentence-too-long", detail: `${n} words — split it: "${s.slice(0, 60)}…"` });
  }

  if (words.length < IG.script.minWords) v.push({ rule: "too-short", detail: `${words.length} words (min ${IG.script.minWords}) — NEVER pad; hold if the story is thin` });
  if (words.length > IG.script.maxWords) v.push({ rule: "too-long", detail: `${words.length} words (max ${IG.script.maxWords})` });
  const sec = estimateSeconds(words.length);
  if (sec > IG.script.maxSec) v.push({ rule: "duration", detail: `~${sec.toFixed(0)}s (max ${IG.script.maxSec})` });

  // repetition: no fact RESTATED. Detector = a qualifying trigram (3 consecutive tokens,
  // ≥2 of them ≥4 chars) appearing in two NON-ADJACENT sentences. Exempt: (a) trigrams
  // made of the story's own TOPIC words (a name-reveal story must say "her full name"
  // more than once — that's the subject, not padding), (b) adjacent sentences building
  // on each other. Distant restatements (the Sandler-officiated case) stay caught.
  const topicTokens = new Set(normWords(topicText).filter((w) => w.length >= 4));
  const seenTrigram = new Map();
  sentences.forEach((s, si) => {
    const toks = normWords(s);
    for (let k = 0; k + 2 < toks.length; k++) {
      const tri = toks.slice(k, k + 3);
      if (tri.filter((w) => w.length >= 4).length < 2) continue;
      if (tri.filter((w) => topicTokens.has(w)).length >= 2) continue; // topic phrase
      const key = tri.join(" ");
      const firstSeen = seenTrigram.get(key);
      if (firstSeen !== undefined && firstSeen !== si && si - firstSeen > 1) {
        v.push({ rule: "repetition", detail: `sentences ${firstSeen + 1} and ${si + 1} repeat "${key}"` });
        return; // one violation per sentence is enough signal
      }
      if (firstSeen === undefined) seenTrigram.set(key, si);
    }
  });
  return v;
}

// ── CAPTION LINT (agent 9) ─────────────────────────────────────────────────────
const BANNED_TAGS = new Set(["#fyp", "#viral", "#explore", "#foryou", "#trending", "#reels", "#instagram", "#follow"]);
export function lintCaption(cap, entities = []) {
  const v = [];
  const line1 = cap.line1 || "";
  if (!line1) v.push({ rule: "no-line1", detail: "missing" });
  // hard cap 70 (beyond that even the entity risks truncation); ≤55 is the ideal the
  // prompt aims for, but two long celebrity names legitimately need headroom.
  if (line1.length > 70) v.push({ rule: "line1-too-long", detail: `${line1.length} chars (max 70)` });
  const entityTokens = entities.flatMap((e) => normWords(e.name || e)).filter((t) => t.length > 2);
  if (entityTokens.length && !normWords(line1.slice(0, 58)).some((w) => entityTokens.includes(w)))
    v.push({ rule: "line1-no-entity", detail: "an entity name must appear within the first ~55 visible chars" });

  const tags = (cap.hashtags || []).map((t) => (t.startsWith("#") ? t : `#${t}`).toLowerCase());
  if (tags.length < 3 || tags.length > 5) v.push({ rule: "hashtag-count", detail: `${tags.length} (need 3-5; IG hard-caps at 5)` });
  for (const t of tags) if (BANNED_TAGS.has(t)) v.push({ rule: "generic-tag", detail: t });

  const all = [line1, cap.body || "", cap.cta || ""].join(" ");
  if (/https?:\/\//i.test(all)) v.push({ rule: "link", detail: "no links in captions (Meta caption hygiene)" });
  for (const re of BAIT_RE) if (re.test(all) && !/follow @/i.test(all.match(re)?.[0] || "")) v.push({ rule: "bait", detail: re.source });
  const caps = all.match(/\b[A-Z]{4,}\b/g) || [];
  if (caps.length > 2) v.push({ rule: "all-caps", detail: caps.slice(0, 4).join(",") });
  const total = [line1, cap.body, (cap.hashtags || []).join(" "), cap.cta].filter(Boolean).join("\n").length;
  if (total > 2200) v.push({ rule: "too-long", detail: `${total} chars (API max 2200)` });
  if (/[*_`]+\S/.test(all)) v.push({ rule: "markdown", detail: "raw markdown in caption" });
  if (/#\w/.test(all)) v.push({ rule: "hashtag-in-text", detail: "hashtags belong in the hashtags array (auto-repair should have moved them)" });
  return v;
}

// ── RENDER MANIFEST LINT (agent 18 sync & pacing) ─────────────────────────────
export function lintManifest(shots, words, durationSec, entities = []) {
  const v = [];
  if (!shots?.length) return [{ rule: "no-shots", detail: "empty manifest" }];
  for (const s of shots) {
    const len = s.t1 - s.t0;
    if (len > IG.maxStaticSec + 0.01) v.push({ rule: "static-too-long", detail: `${s.entity || "?"} ${len.toFixed(1)}s at ${s.t0.toFixed(1)}` });
  }
  // visual change cadence: gaps between consecutive shot starts
  for (let i = 1; i < shots.length; i++) {
    const gap = shots[i].t0 - shots[i - 1].t0;
    if (gap > IG.maxShotSec + 0.6) v.push({ rule: "cadence", detail: `${gap.toFixed(1)}s between changes at ${shots[i - 1].t0.toFixed(1)}` });
  }
  if (Math.abs(shots[shots.length - 1].t1 - durationSec) > 0.75)
    v.push({ rule: "coverage", detail: `shots end ${shots[shots.length - 1].t1.toFixed(1)} vs audio ${durationSec.toFixed(1)}` });
  // entity-sync: when a subject is spoken, their image must be on screen within
  // tolerance — EVERY mention checked; a composite counts for ALL its subjects.
  // Subjects with no imagery are flagged SOFTLY (unshowable-mention) — never silent.
  if (words?.length) {
    const covers = (s, name) => (s.subjects || [s.entity]).includes(name);
    for (const e of entities) {
      const tokens = normWords(e.name).filter((t) => t.length > 2);
      if (!tokens.length) continue;
      const anyImageForEntity = shots.some((s) => covers(s, e.name));
      for (const w of words) {
        if (!tokens.includes(normWords(w.w)[0] ?? "")) continue;
        const t = w.t0;
        if (!anyImageForEntity) {
          v.push({ rule: "unshowable-mention", detail: `"${e.name}" spoken at ${t.toFixed(1)}s but has no imagery at all` });
          break; // one flag per imageless entity is enough
        }
        const onScreen = shots.some(
          (s) => covers(s, e.name) && t >= s.t0 - IG.entitySyncTolSec && t <= s.t1 + IG.entitySyncTolSec
        );
        if (!onScreen)
          v.push({ rule: "entity-sync", detail: `"${e.name}" spoken at ${t.toFixed(1)}s without their image (±${IG.entitySyncTolSec}s)` });
      }
    }
  }
  return v;
}
