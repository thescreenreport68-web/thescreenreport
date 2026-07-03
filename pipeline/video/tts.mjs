// STAGE: TTS — Kokoro-82M via the durable venv. Returns { wav, duration }. Fail-closed: silent/empty
// audio throws (the runner may then retry or fall back to Google Chirp per the plan).
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIDEO } from "./config.mjs";
import { normalizeForSpeech, ensureSentencePunct, PHONEME_LEX } from "./lexicon.mjs";

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
  const speech = text
    .split(/\n+/)
    .map((l) => l.trim()).filter(Boolean)
    .map(ensureSentencePunct)
    .map(normalizeForSpeech)
    .join(" ");
  const txt = path.join(dir, "tts-input.txt");
  fs.writeFileSync(txt, speech, "utf8");
  const lexFile = path.join(dir, "phoneme-lex.json");
  fs.writeFileSync(lexFile, JSON.stringify(PHONEME_LEX), "utf8");
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
