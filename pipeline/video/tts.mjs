// STAGE: TTS — Kokoro-82M via the durable venv. Returns { wav, duration }. Fail-closed: silent/empty
// audio throws (the runner may then retry or fall back to Google Chirp per the plan).
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIDEO } from "./config.mjs";
import { normalizeForSpeech, ensureSentencePunct, PHONEME_LEX, LEXICON } from "./lexicon.mjs";
import { chat } from "../lib/openrouter.mjs";

// ═══ NAME PRONUNCIATION SYSTEM (Phase 3) — every name on Earth solved at most once, forever.
// Unknown Title-Case names → one cheap batched call ("how do Hollywood media pronounce these?") →
// respellings persisted to the auto-lexicon JSON. Fail-open (a skipped check ≠ a broken video).
const AUTO_LEX = `${VIDEO.workDir}/../name-lexicon.json`;
const COMMON = /^(The|A|An|In|On|At|Of|And|But|So|He|She|It|They|We|You|His|Her|Their|This|That|New|Now|Full|Story|Screen|Report|Link|Bio|Netflix|Disney|Marvel|Hollywood|America|American|Oscar|Oscars|Emmy|Emmys|Season|Episode|Part|Movie|Film|Show|Series|Star|Wars|Trek|July|August|January|February|March|April|May|June|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/;
async function nameRespellings(text) {
  let lex = {};
  try { lex = JSON.parse(fs.readFileSync(AUTO_LEX, "utf8")); } catch {}
  const names = [...new Set([...text.matchAll(/\b([A-Z][a-z'']+(?:\s+[A-Z][a-z'']+)+)\b/g)].map((m) => m[1]))]
    .filter((n) => n.split(/\s+/).every((w) => !COMMON.test(w)))
    .filter((n) => !(n in lex) && !(n in LEXICON) && !Object.keys(LEXICON).some((k) => n.includes(k)) && !Object.keys(PHONEME_LEX).some((k) => n.includes(k)));
  if (names.length) {
    try {
      const { data } = await chat({
        model: VIDEO.visionModel, json: true, maxTokens: 300, temperature: 0,
        system: "You are a broadcast pronunciation coach. STRICT JSON only.",
        user: `For each name, give the phonetic respelling of how US entertainment media pronounce it, as simple hyphenated syllables (e.g. "Seth Rogen" -> "Seth ROH-gun", "Saoirse Ronan" -> "SUR-shuh ROH-nan"). If pronounced exactly as spelled, return the name unchanged. Names: ${names.join("; ")}. {"Name": "respelling", ...}`,
      });
      for (const [k, v] of Object.entries(data || {})) if (typeof v === "string" && v.trim()) lex[k] = v.trim();
      fs.mkdirSync(VIDEO.workDir, { recursive: true });
      fs.writeFileSync(AUTO_LEX, JSON.stringify(lex, null, 1));
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
