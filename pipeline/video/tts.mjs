// STAGE: TTS — Kokoro-82M via the durable venv. Returns { wav, duration }. Fail-closed: silent/empty
// audio throws (the runner may then retry or fall back to Google Chirp per the plan).
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIDEO } from "./config.mjs";
import { normalizeForSpeech, ensureSentencePunct, PHONEME_LEX, LEXICON } from "./lexicon.mjs";
import { chat } from "../lib/openrouter.mjs";
import { wikiIPA, toEspeak } from "./names.mjs";

// ═══ NAME PRONUNCIATION SYSTEM (Phase 3) — every name on Earth solved at most once, forever.
// Unknown Title-Case names → one cheap batched call ("how do Hollywood media pronounce these?") →
// respellings persisted to the auto-lexicon JSON. Fail-open (a skipped check ≠ a broken video).
const AUTO_LEX = `${VIDEO.workDir}/../name-lexicon.json`;
const PHON_LEX = `${VIDEO.workDir}/../phoneme-lexicon.json`; // name → verified espeak-IPA (context-stable splice)
const COMMON = /^(The|A|An|In|On|At|Of|And|But|So|He|She|It|They|We|You|His|Her|Their|This|That|New|Now|Full|Story|Screen|Report|Link|Bio|Netflix|Disney|Marvel|Hollywood|America|American|Oscar|Oscars|Emmy|Emmys|Season|Episode|Part|Movie|Film|Show|Series|Star|Wars|Trek|July|August|January|February|March|April|May|June|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/;
// tiny Levenshtein for by-ear grading
function lev(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const phon = (w) => w.toLowerCase().replace(/[^a-z]/g, "").replace(/ph/g, "f").replace(/ck/g, "k")
  .replace(/(ie|ee|ea|ey)/g, "i").replace(/y/g, "i").replace(/(.)\1+/g, "$1").replace(/e$/, "");
const heardScore = (name, heard) => {
  // every word of the real name must be recognizably present in what the listener heard (by SOUND)
  const hw = heard.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean).map(phon);
  return name.toLowerCase().split(/\s+/).map(phon).filter(Boolean).every((w) =>
    hw.some((h) => lev(w, h) <= Math.max(1, Math.floor(w.length * 0.34))));
};
const earTest = (cands) => new Promise(async (res) => {
  const { execFile } = await import("node:child_process");
  execFile(VIDEO.python, [path.join(path.dirname(fileURLToPath(import.meta.url)), "name_test.py"), "--model-dir", VIDEO.modelDir, "--json", JSON.stringify(cands)],
    { maxBuffer: 4 * 1024 * 1024, timeout: 420000 }, (e, so) => { try { res(JSON.parse(String(so).trim().split("\n").pop())); } catch { res(null); } });
});
async function nameRespellings(text) {
  let lex = {}, phon = {};
  try { lex = JSON.parse(fs.readFileSync(AUTO_LEX, "utf8")); } catch {}
  try { phon = JSON.parse(fs.readFileSync(PHON_LEX, "utf8")); } catch {}
  const names = [...new Set([...text.matchAll(/\b([A-Z][a-z'']+(?:\s+[A-Z][a-z'']+)+)\b/g)].map((m) => m[1]))]
    .filter((n) => n.split(/\s+/).every((w) => !COMMON.test(w)))
    .filter((n) => !(n in lex) && !(n in phon) && !(n in LEXICON) && !Object.keys(LEXICON).some((k) => n.includes(k)) && !Object.keys(PHONEME_LEX).some((k) => n.includes(k)));
  if (names.length) {
    try {
      // ROUND 1: as-spelled, graded by ear (most names pass here — zero fetches, zero guessing)
      const r1 = await earTest(Object.fromEntries(names.map((n) => [n, [n]])));
      const failed = [];
      for (const n of names) {
        if (heardScore(n, r1?.[n]?.[n] || "")) { lex[n] = n; console.log(`  name-check ${n}: as-spelled OK`); }
        else failed.push(n);
      }
      // ROUND 2: failures → AUTHORITATIVE American IPA (Wikipedia lead) → LLM-IPA → splice-verified by ear
      for (const n of failed) {
        const cands = [];
        const wiki = await wikiIPA(n).catch(() => null);
        if (wiki) cands.push(toEspeak(wiki));
        try {
          const { data } = await chat({
            model: VIDEO.scriptModel, json: true, maxTokens: 200, temperature: 0,
            system: "You produce espeak-ng General-American IPA for names. Use ONLY symbols: ɹ ɡ ɚ ɝ ˈ ˌ ː ə ɪ ʊ ɛ ɔ æ ŋ ʃ ʒ θ ð ɜ ɑ a e i o u b d f h j k l m n p s t v w z eɪ aɪ oʊ aʊ ɔɪ dʒ tʃ. STRICT JSON.",
            user: `American media pronunciation of "${n}" as espeak IPA with stress marks (like "dˈeɪvɪd kˈɔːɹənswɛt"). {"ipa":"..."}`,
          });
          if (data?.ipa && !cands.includes(data.ipa)) cands.push(String(data.ipa).trim());
        } catch {}
        if (cands.length) {
          const r2 = await earTest({ [n]: cands.map((c) => "ipa:" + c) });
          const win = cands.find((c) => heardScore(n, r2?.[n]?.["ipa:" + c] || ""));
          if (win) { phon[n] = win; console.log(`  name-check ${n}: PHONEME verified ("${win}"${wiki && win === toEspeak(wiki) ? " · Wikipedia" : " · LLM"})`); continue; }
        }
        lex[n] = n; // honest fallback: plain as-spelled (never a guessed respelling again)
        console.log(`  name-check ${n}: no verified pronunciation — as-spelled fallback`);
      }
      fs.mkdirSync(path.dirname(AUTO_LEX), { recursive: true });
      fs.writeFileSync(AUTO_LEX, JSON.stringify(lex, null, 1));
      fs.writeFileSync(PHON_LEX, JSON.stringify(phon, null, 1));
    } catch (e) { console.log("  (name-pass skipped: " + String(e.message).slice(0, 60) + ")"); }
  }
  return lex;
}
function applyNames(text, lex) {
  let t = text;
  for (const k of Object.keys(lex).sort((a, b) => b.length - a.length)) {
    if (lex[k] !== k) t = t.split(k).join(lex[k]);
  }
  return t;
}

const run = (cmd, args, opts = {}) =>
  new Promise((res, rej) =>
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, timeout: 300000, ...opts }, (e, stdout, stderr) =>
      e ? rej(new Error(`${e.message}\n${String(stderr).slice(-800)}`)) : res({ stdout, stderr })
    )
  );

export async function synthVoice({ text, outWav, voice = VIDEO.voice, speed = VIDEO.speed }) {
  const dir = path.dirname(outWav);
  fs.mkdirSync(dir, { recursive: true });
  // PRONUNCIATION PASS (hard-coded system, see lexicon.mjs): sentence-punctuation discipline →
  // lexicon respellings → symbol normalization. Spoken text only; captions keep correct spelling.
  const nameLex = await nameRespellings(text); // Phase 3: auto-solved name pronunciations (SAY track only)
  const speech = text
    .split(/\n+/)
    .map((l) => l.trim()).filter(Boolean)
    .map(ensureSentencePunct)
    .map((l) => applyNames(l, nameLex))
    .map(normalizeForSpeech)
    .join(" ");
  const txt = path.join(dir, "tts-input.txt");
  fs.writeFileSync(txt, speech, "utf8");
  const lexFile = path.join(dir, "phoneme-lex.json");
  let autoPhon = {};
  try { autoPhon = JSON.parse(fs.readFileSync(PHON_LEX, "utf8")); } catch {}
  fs.writeFileSync(lexFile, JSON.stringify({ ...autoPhon, ...PHONEME_LEX }), "utf8");
  const py = path.join(path.dirname(fileURLToPath(import.meta.url)), "kokoro_tts.py");
  const { stdout } = await run(VIDEO.python, [py, "--text-file", txt, "--out", outWav, "--voice", voice, "--speed", String(speed), "--model-dir", VIDEO.modelDir, "--lexicon", lexFile]);
  const info = JSON.parse(String(stdout).trim().split("\n").pop());
  if (info.error || !info.duration || info.duration < 3) throw new Error(`tts failed: ${JSON.stringify(info)}`);
  if (info.rms !== undefined && info.rms < 0.005) throw new Error(`tts near-silent (rms ${info.rms})`);
  // PRONUNCIATION QC (warn-only): ASR round-trip diff — flags feed the sidecar, never block production
  let qc = null;
  try {
    const qcPy = path.join(path.dirname(fileURLToPath(import.meta.url)), "kokoro_qc.py");
    const { stdout: qout } = await run(VIDEO.python, [qcPy, "--wav", outWav, "--expected", txt]);
    qc = JSON.parse(String(qout).trim().split("\n").pop());
    if (qc.hard?.length) console.log(`  ⚠ QC hard flags: ${qc.hard.join(", ")} (wer ${qc.wer})`);
  } catch (e) { console.log("  (qc skipped: " + String(e.message).slice(0, 80) + ")"); }
  return { wav: outWav, duration: info.duration, qc };
}
