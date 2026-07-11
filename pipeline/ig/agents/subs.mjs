// AGENT 16 — SUBTITLE STYLIST & BUILDER (plan §2.2 #16, §5.6 "really, really high end"):
// word-timed karaoke ASS from the alignment timestamps. LLM stylist picks 1-2 EMPHASIS
// words per sentence (names, numbers, twist words) → brand-red pop; deterministic builder
// handles layout (center band inside safe zones, ≤2 lines, breath-point breaks).
import fs from "node:fs";
import path from "node:path";
import { IG } from "../config.mjs";
import { llm } from "../models.mjs";
import { normWords } from "../lib/util.mjs";
import { workDirFor } from "../job.mjs";

export async function styleEmphasis(sentences, entities) {
  try {
    const res = await llm({
      role: "caption",
      system:
        'For each numbered sentence pick the 1-2 words a premium news video should visually EMPHASIZE (star/film names, numbers, the twist word). Return STRICT JSON {"emphasis":[[string]]} — one array of exact words per sentence, in order.',
      user: sentences.map((s, i) => `${i}. ${s}`).join("\n"),
      temp: 0.2,
      maxTokens: 300,
      json: true,
    });
    return (res.emphasis || []).map((arr) => new Set((arr || []).flatMap((w) => normWords(w))));
  } catch {
    return sentences.map((s) => new Set(entities.flatMap((e) => normWords(e.name)))); // fallback: entities
  }
}

const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
};
const esc = (s) => String(s).replace(/[{}]/g, "").replace(/\n/g, " ");

// Group aligned words into phrase events: ≤4 words per line, break on gaps > 0.55s.
export function groupPhrases(words, maxWords = 4, gapSec = 0.55) {
  const groups = [];
  let cur = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (cur.length >= maxWords || (prev && w.t0 - prev.t1 > gapSec)) {
      if (cur.length) groups.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

export function buildAss({ slug, words, sentenceWindows, emphasisSets }) {
  const W = IG.width, H = IG.height;
  const yBaseline = H - IG.safe.bottom - 210; // center-low band, well inside safe zones
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,${IG.brand.font},64,&H00FFFFFF,&H60FFFFFF,&H00141414,&H96000000,0,0,0,0,100,100,1.5,0,1,3.2,1.4,2,${IG.safe.left},${IG.safe.right},${H - yBaseline},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  // sentence index per word (for emphasis lookup)
  const sentIdxAt = (t) => {
    for (let i = 0; i < sentenceWindows.length; i++)
      if (t >= sentenceWindows[i].t0 - 0.05 && t <= sentenceWindows[i].t1 + 0.35) return i;
    return Math.max(0, sentenceWindows.length - 1);
  };

  // Karaoke direction (ASS \k): a word shows SecondaryColour (dim white) until sung,
  // then fills to PrimaryColour (white) — emphasis words fill to brand-red + bold.
  // Each word's \k span absorbs the gap to the NEXT word so the highlight never runs
  // ahead of the voice (review finding).
  const events = [];
  for (const group of groupPhrases(words)) {
    const t0 = group[0].t0;
    const t1 = group[group.length - 1].t1 + 0.12;
    const parts = group.map((w, gi) => {
      const next = group[gi + 1];
      const spanEnd = next ? next.t0 : w.t1;
      const durCs = Math.max(4, Math.round((spanEnd - w.t0) * 100));
      const si = sentIdxAt(w.t0);
      const isEmph = emphasisSets[si]?.has(normWords(w.w)[0]);
      const text = esc(w.w.trim());
      return isEmph
        ? `{\\k${durCs}}{\\b1\\fs72\\1c${IG.brand.red}}${text}{\\b0\\fs64\\1c&HFFFFFF&}`
        : `{\\k${durCs}}${text}`;
    });
    events.push(`Dialogue: 0,${assTime(t0)},${assTime(t1)},Karaoke,,0,0,0,,${parts.join(" ")}`);
  }
  const file = path.join(workDirFor(slug), "subs.ass");
  fs.writeFileSync(file, header + events.join("\n") + "\n");
  return file;
}
