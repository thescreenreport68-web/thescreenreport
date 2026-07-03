// STAGE: SUBTITLES v2 — the "big channel" caption system (owner 2026-07-03: v1 looked basic).
// Design: ANTON heavy uppercase (the standard for high-end news/docu reels) · spoken words light up
// WHITE from soft gray (karaoke) · EMPHASIS words locked to brand red · the HOOK renders extra-large
// at center-screen with a pop-in · kicker = red news chip (BorderStyle=4 opaque box) top-center.
// Colors are &HAABBGGRR (BGR): red #D92128 -> &H002821D9 · ink #101010 -> &H00101010.
// v1 timing kept: proportional allocation of measured audio duration (CI upgrade: true token stamps).
import { sanitizeForDisplay } from "./lexicon.mjs";

const STYLE = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Anton,92,&H00FFFFFF,&H00B9B9B9,&H00101010,&HA0000000,0,0,0,0,100,100,1,0,1,4,2,2,70,70,330,1
Style: Hook,Anton,120,&H00FFFFFF,&H00CFCFCF,&H00101010,&HA0000000,0,0,0,0,100,100,1,0,1,5,3,5,70,70,0,1
Style: KickText,Anton,40,&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,0,0,0,0,100,100,4,0,1,0,0,5,0,0,0,1
Style: KickDraw,Anton,40,&H002821D9,&H002821D9,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

const RED = "\\1c&H2821D9&";
const ts = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${sec}`;
};
const esc = (t) => sanitizeForDisplay(String(t)).replace(/[{}\\]/g, "");
const strip = (w) => w.replace(/[^a-z0-9']/gi, "").toLowerCase();

// lines = [{show, emphasis?:[words]}] — first entry is the HOOK. Weighted proportional timing.
export function buildAss({ lines, duration, kicker = "" }) {
  const weight = (w) => w.length + 2;
  // hook phrases = 2-3 words (huge, center); body phrases = 3 words (bottom third)
  const phrases = [];
  lines.forEach((l, li) => {
    const emph = new Set((l.emphasis || []).map(strip));
    const words = esc(l.show).toUpperCase().split(/\s+/).filter(Boolean).map((w) => ({ w, red: emph.has(strip(w)) }));
    const size = li === 0 ? 3 : 3;
    for (let i = 0; i < words.length; i += size) phrases.push({ words: words.slice(i, i + size), hook: li === 0 });
  });
  const total = phrases.flatMap((p) => p.words).reduce((a, x) => a + weight(x.w), 0);
  const usable = Math.max(duration - 0.25, 1);
  let t = 0.05, out = STYLE;
  // PREMIUM KICKER CHIP (owner 2026-07-03: the flat box read basic) — three layers, all fading together:
  // soft blurred drop-shadow → rounded red panel (\p vector with bezier corners) → letterspaced Anton text.
  if (kicker) {
    const K = esc(kicker).toUpperCase();
    const end = ts(Math.min(6.5, duration));
    // Anton @40px w/ spacing 4 ≈ 25px average advance; +12% safety so the panel never crowds the text
    const w = Math.min(Math.round(K.length * 25 * 1.12) + 72, 1000), h = 88, r = 18;
    const cx = 540, y0 = 118;
    const rect = `m ${r} 0 l ${w - r} 0 b ${w} 0 ${w} 0 ${w} ${r} l ${w} ${h - r} b ${w} ${h} ${w} ${h} ${w - r} ${h} l ${r} ${h} b 0 ${h} 0 ${h} 0 ${h - r} l 0 ${r} b 0 0 0 0 ${r} 0`;
    out += `Dialogue: 0,${ts(0.12)},${end},KickDraw,,0,0,0,,{\\fad(140,120)\\pos(${cx - w / 2 + 6},${y0 + 8})\\1c&H000000&\\1a&H78&\\blur6\\p1}${rect}{\\p0}\n`;
    out += `Dialogue: 1,${ts(0.12)},${end},KickDraw,,0,0,0,,{\\fad(140,120)\\pos(${cx - w / 2},${y0})\\p1}${rect}{\\p0}\n`;
    out += `Dialogue: 2,${ts(0.12)},${end},KickText,,0,0,0,,{\\fad(140,120)\\pos(${cx},${y0 + h / 2 + 1})}${K}\n`;
  }
  for (const ph of phrases) {
    const phW = ph.words.reduce((a, x) => a + weight(x.w), 0);
    const phDur = (phW / total) * usable;
    // per-word karaoke (\k in centiseconds); emphasis words locked red via inline primary override
    const ks = ph.words
      .map((x) => `{\\k${Math.max(8, Math.round(((weight(x.w) / phW) * phDur) * 100))}}${x.red ? `{${RED}}${x.w}{\\1c&HFFFFFF&}` : x.w}`)
      .join(" ");
    const pop = "{\\fad(70,50)\\t(0,130,\\fscx106\\fscy106)\\t(130,220,\\fscx100\\fscy100)}";
    out += `Dialogue: 0,${ts(t)},${ts(Math.min(t + phDur, duration))},${ph.hook ? "Hook" : "Cap"},,0,0,0,,${pop}${ks}\n`;
    t += phDur;
  }
  return out;
}
