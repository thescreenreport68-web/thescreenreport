// AGENT 14 — VERBATIM & ALIGNMENT WALL (plan §2.2 #14, load-bearing):
// whisper transcribes the ACTUAL audio → word-for-word diff vs the approved script
// (a chat-audio model can paraphrase — any real drift = fail) → emits the word
// timestamps that drive karaoke subtitles AND entity-timed shots.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IG } from "../config.mjs";
import { normWords, tokenDiff } from "../lib/util.mjs";

const PY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "py");

export function whisperAlign(wavPath) {
  const out = execFileSync(IG.python, [path.join(PY_DIR, "whisper_align.py"), "--audio", wavPath], {
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  }).toString();
  return JSON.parse(out);
}

// Verbatim verdict: normalized token edit distance vs the SPEAKABLE script.
// Whisper mishears names/numbers, so plain token DRIFT is tolerated up to 0.18 (matching
// the provider-transcript precheck — one consistent bar) while the real fabrication guards
// stay strict: a run of 4+ inserted unknown words (ad-lib) and >15% length change (dropped/
// added sentence) always fail. (audit 2026-07-11: 0.12 here vs 0.18 precheck caused a valid
// take to pass one gate and hold at the next.)
export function verbatimVerdict(speakableText, whisper, { tolerance = 0.18, maxRunInserted = 4 } = {}) {
  const a = normWords(speakableText);
  const b = normWords(whisper.text);
  if (!a.length || !b.length) return { pass: false, kind: "empty", reason: "empty transcript" };
  // the ad-lib catcher FIRST — a long run of unknown words is the real fabrication signal
  const aSet = new Set(a);
  let run = 0;
  for (const w of b) {
    run = aSet.has(w) ? 0 : run + 1;
    if (run >= maxRunInserted) return { pass: false, kind: "insert", reason: `inserted phrase of ${run}+ unknown words (ad-lib)` };
  }
  const lenDelta = Math.abs(b.length - a.length) / a.length;
  if (lenDelta > 0.15) return { pass: false, kind: "length", reason: `length drift ${(lenDelta * 100).toFixed(0)}%` };
  const dist = tokenDiff(a, b);
  const ratio = dist / a.length;
  // plain drift = whisper mishearing names/numbers, NOT the model ad-libbing — soft signal
  if (ratio > tolerance) return { pass: false, kind: "drift", reason: `token drift ${(ratio * 100).toFixed(0)}% (max ${(tolerance * 100).toFixed(0)}%)` };
  return { pass: true, kind: "ok", reason: `drift ${(ratio * 100).toFixed(1)}%` };
}

// Map each display sentence to its [t0,t1] window using the aligned words (greedy walk).
export function sentenceWindows(sentences, words) {
  const windows = [];
  let wi = 0;
  for (const s of sentences) {
    const target = normWords(s).length;
    if (!target) continue;
    const startWord = words[Math.min(wi, words.length - 1)];
    let consumed = 0;
    let endWord = startWord;
    while (wi < words.length && consumed < target) {
      endWord = words[wi];
      // whisper words can glue punctuation; count normalized tokens
      consumed += Math.max(1, normWords(endWord.w).length);
      wi++;
    }
    windows.push({ text: s, t0: startWord?.t0 ?? 0, t1: endWord?.t1 ?? startWord?.t0 ?? 0 });
  }
  return windows;
}

// DISPLAY-WORD ALIGNMENT: subtitles must show the SCRIPT's spelling (whisper mishears
// names — "Kelce" → "Kelsey") but use whisper's TIMING. Token-level Needleman-Wunsch
// between script tokens and whisper tokens; unmatched script tokens interpolate timing.
export function alignDisplayWords(displaySentences, whisperWords) {
  const display = displaySentences.flatMap((s) => s.split(/\s+/).filter(Boolean));
  const a = display.map((w) => normWords(w)[0] || w.toLowerCase());
  const b = whisperWords.map((w) => normWords(w.w)[0] || "");
  const n = a.length, m = b.length;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  // traceback → for each display token, the whisper index it maps to (or -1)
  const mapTo = new Array(n).fill(-1);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { mapTo[i - 1] = j - 1; i--; j--; }
    else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  const out = display.map((w, k) => {
    const wi = mapTo[k];
    if (wi >= 0) return { w, t0: whisperWords[wi].t0, t1: whisperWords[wi].t1 };
    return { w, t0: null, t1: null }; // fill below
  });
  // interpolate unmatched timings between nearest matched neighbors
  for (let k = 0; k < out.length; k++) {
    if (out[k].t0 !== null) continue;
    let prev = k - 1; while (prev >= 0 && out[prev].t0 === null) prev--;
    let next = k + 1; while (next < out.length && out[next].t0 === null) next++;
    const p = prev >= 0 ? out[prev].t1 : 0;
    const q = next < out.length ? out[next].t0 : (whisperWords[whisperWords.length - 1]?.t1 ?? p + 0.3);
    const span = Math.max(0.12, (q - p) / (next - prev));
    out[k].t0 = p + span * (k - prev - 1);
    out[k].t1 = out[k].t0 + span * 0.9;
  }
  return out;
}

export function align({ wav, speakable, displaySentences }) {
  const whisper = whisperAlign(wav);
  const verdict = verbatimVerdict(speakable.join(" "), whisper);
  const windows = verdict.pass ? sentenceWindows(displaySentences, whisper.words) : [];
  const displayWords = verdict.pass ? alignDisplayWords(displaySentences, whisper.words) : [];
  return { whisper, verdict, windows, displayWords };
}
