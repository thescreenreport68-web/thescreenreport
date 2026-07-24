// OpenRouter client for the IG lane — text (fallback arrays), vision, streamed SPEECH
// (gpt-audio-mini, pcm16@24k), streamed MUSIC (Lyria 3, mp3). Cost-metered per run.
// Probed live 2026-07-10: audio output REQUIRES stream:true; speech deltas arrive as
// choices[].delta.audio.{data,transcript}; Lyria bills $0.04/clip and returns mp3 deltas.
import { IG } from "./config.mjs";
import { extractJson, retry } from "./lib/util.mjs";

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const HEADERS = () => ({
  Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "https://thescreenreport.com",
  "X-Title": "TSR IG Reels",
});

// ── cost meter (orchestrator reads + enforces caps) ────────────────────────────
const meter = { usd: 0, calls: [] };
export function costSpent() { return meter.usd; }
export function costCalls() { return meter.calls; }
export function costReset() { meter.usd = 0; meter.calls = []; }
function record(kind, model, usd, note = "") {
  meter.usd += usd || 0;
  meter.calls.push({ kind, model, usd: +(usd || 0).toFixed(6), note });
}

// ── test hook: inject fakes so the offline suite runs with zero network ────────
let mock = null;
export function setMock(fn) { mock = fn; } // fn({kind, ...args}) -> canned result or undefined

// ── text LLM ───────────────────────────────────────────────────────────────────
export async function llm({ role, system, user, temp = 0.2, maxTokens = 800, json = false, timeoutMs = 90000 }) {
  if (mock) { const r = await mock({ kind: "llm", role, system, user, temp, maxTokens, json }); if (r !== undefined) return r; }
  const models = IG.models[role];
  if (!models) throw new Error(`unknown model role: ${role}`);
  const body = {
    model: models[0],
    models,
    temperature: temp,
    max_tokens: maxTokens,
    usage: { include: true },
    reasoning: { enabled: false }, // hybrid-reasoning models (deepseek v4) must not burn the token budget on thinking
    messages: [system && { role: "system", content: system }, { role: "user", content: user }].filter(Boolean),
  };
  if (json) body.response_format = { type: "json_object" };
  return retry(async (attempt) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const payload = { ...body };
      if (attempt > 0) delete payload.reasoning; // some models 400 on the reasoning param — retry without
      const res = await fetch(OR_URL, { method: "POST", headers: HEADERS(), body: JSON.stringify(payload), signal: ctl.signal });
      const data = await res.json();
      if (data.error) throw new Error(`OR ${role}: ${JSON.stringify(data.error).slice(0, 300)}`);
      const text = data.choices?.[0]?.message?.content ?? "";
      record("llm", data.model || models[0], data.usage?.cost ?? 0, role);
      if (json) {
        const obj = extractJson(text);
        if (!obj) throw new Error(`OR ${role}: unparseable JSON: ${String(text).slice(0, 200)}`);
        return obj;
      }
      return text;
    } finally { clearTimeout(t); }
  }, { tries: 2, label: `llm:${role}` });
}

// ── vision (image URLs or data: URIs) ──────────────────────────────────────────
export async function vision({ system, user, images = [], temp = 0, maxTokens = 500, json = true, timeoutMs = 90000 }) {
  if (mock) { const r = await mock({ kind: "vision", system, user, images, maxTokens }); if (r !== undefined) return r; }
  const models = IG.models.vision;
  const content = [{ type: "text", text: user }, ...images.map((u) => ({ type: "image_url", image_url: { url: u } }))];
  const body = {
    model: models[0],
    models,
    temperature: temp,
    max_tokens: maxTokens,
    usage: { include: true },
    messages: [system && { role: "system", content: system }, { role: "user", content }].filter(Boolean),
  };
  if (json) body.response_format = { type: "json_object" };
  return retry(async () => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(OR_URL, { method: "POST", headers: HEADERS(), body: JSON.stringify(body), signal: ctl.signal });
      const data = await res.json();
      if (data.error) throw new Error(`OR vision: ${JSON.stringify(data.error).slice(0, 300)}`);
      record("vision", data.model || models[0], data.usage?.cost ?? 0);
      const text = data.choices?.[0]?.message?.content ?? "";
      if (json) {
        const obj = extractJson(text);
        if (!obj) throw new Error(`OR vision: unparseable JSON: ${String(text).slice(0, 200)}`);
        return obj;
      }
      return text;
    } finally { clearTimeout(t); }
  }, { tries: 2, label: "vision" });
}

// ── shared SSE audio collector ─────────────────────────────────────────────────
// Two guards (audit 2026-07-11): an IDLE timer (re-armed on each chunk — tolerates a
// slow-but-flowing stream) AND an absolute HARD ceiling that never re-arms (a stream
// that keeps sending keepalive pings but no real data, or just runs forever, is killed).
// Either firing aborts the fetch so the socket closes and the Node event loop can drain.
async function streamAudio(body, { label, timeoutMs, maxAudioBytes = 0 }) {
  const ctl = new AbortController();
  const hardMs = Math.max(timeoutMs * 3, 300000);
  let t = setTimeout(() => ctl.abort(), timeoutMs);
  const hard = setTimeout(() => ctl.abort(), hardMs);
  const rearm = () => { clearTimeout(t); t = setTimeout(() => ctl.abort(), timeoutMs); };
  let runaway = false;
  let bytes = 0; // hoisted: the abort-metering below needs the received-audio size (audit 2026-07-16)
  let usage = null;
  try {
    const res = await fetch(OR_URL, { method: "POST", headers: HEADERS(), body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok || !res.body) throw new Error(`${label}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const decoder = new TextDecoder();
    let buf = "";
    const audioB64 = [];
    let transcript = "";
    let errObj = null;
    let finished = false; // a stream that dies mid-read returns PARTIAL audio — reject it
    for await (const chunk of res.body) {
      rearm(); // data is flowing — the stream earns more idle time (bounded by hardMs)
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data: ")) continue;
        if (line === "data: [DONE]") { finished = true; continue; } // audio streams end with [DONE], no finish_reason
        let d;
        try { d = JSON.parse(line.slice(6)); } catch { continue; }
        if (d.error) errObj = d.error;
        if (d.usage) usage = d.usage;
        for (const ch of d.choices || []) {
          const a = ch.delta?.audio;
          if (a?.data) { audioB64.push(a.data); bytes += Math.floor(a.data.length * 0.75); }
          if (a?.transcript) transcript += a.transcript;
          if (ch.finish_reason || ch.native_finish_reason) finished = true;
        }
      }
      // RUNAWAY GUARD: gpt-audio-mini intermittently emits 10+ minutes of garbage audio for
      // a short script (240s, 13min, $0.04). Abort the instant it exceeds a sane length so
      // we never wait for, pay for, or feed downstream a broken take. (audit 2026-07-11)
      if (maxAudioBytes && bytes > maxAudioBytes) { runaway = true; ctl.abort(); break; }
    }
    if (runaway) throw new Error(`${label}: runaway audio (>${Math.round(maxAudioBytes / 48000)}s) — take rejected`);
    if (errObj) throw new Error(`${label}: ${JSON.stringify(errObj).slice(0, 300)}`);
    if (!finished) throw new Error(`${label}: stream died mid-read (partial audio rejected)`);
    const audio = Buffer.concat(audioB64.map((x) => Buffer.from(x, "base64")));
    if (!audio.length) throw new Error(`${label}: stream returned no audio`);
    return { audio, transcript, cost: usage?.cost ?? 0 };
  } catch (e) {
    // METER THE ABORT (owner audit 2026-07-16): OpenRouter bills the audio tokens generated BEFORE a
    // runaway/idle abort, but the usage chunk never arrives — every aborted stream was recorded as $0
    // and the ledgers undercounted real spend. Estimate from received audio (~$0.0018/s of pcm16@24k,
    // derived from real ~40s reads billing ~$0.073) unless a usage chunk made it through.
    const sec = bytes / 48000;
    if (sec > 1) record("voice", `${body.model || "audio"}`, usage?.cost ?? +(sec * 0.0018).toFixed(4), "aborted-stream (estimated)");
    if (runaway) throw new Error(`${label}: runaway audio (>${Math.round(maxAudioBytes / 48000)}s) — take rejected`);
    throw e;
  } finally { clearTimeout(t); clearTimeout(hard); }
}

// ── SPEECH: verbatim-locked but PERFORMED, not read (probe-proven verbatim wall
// downstream makes the performative framing safe). Returns { pcm, transcript, cost }.
// timeout 100s: a healthy audio stream starts producing within seconds — a silent
// 100s stream is dead; fail fast and retry fast (2026-07-10: 240s timeouts let a slow
// OpenAI night blow through 20-minute stage watchdogs)
// ── OPENAI DIRECT TTS (owner 2026-07-24: "the voice should be perfect, no compromise"). Activates
// automatically when OPENAI_API_KEY is present. gpt-4o-mini-tts = a REAL text-to-speech model:
// reads verbatim by construction (no ad-libs, no runaways, no conversing — the failure modes that
// forced best-of-N takes), keeps the owner-approved MARIN voice, accepts per-read delivery
// INSTRUCTIONS, and costs ~$0.011/read vs ~$0.073 on gpt-audio (~7×). Returns pcm16@24k mono —
// the exact format the pipeline already consumes. The whisper verbatim wall + ending check stay
// downstream as the safety net. Ship gate: the owner A/B-listens before this goes live (flag below).
// Voice + delivery LOCKED by the owner's two-round A/B casting (2026-07-24): SHIMMER won over
// marin/echo/cedar + 9 others; this exact instruction set produced the take the owner approved
// ("shimmer-wahlberg-PACED"). Shimmer's natural read runs ~2.2 wps — the SPEED block below lifts it
// to ~2.7-2.8 wps, which the owner called right ("calm, normal pacing"; the unpushed takes were "very
// slow"). ⚠ measured pace ≈2.75 wps ≠ config wps 3.4 (gpt-audio) — the IG_TTS=openai flip commit must
// rebalance IG.script.wps + word bands or duration estimates will be wrong.
const OPENAI_TTS_INSTR =
  "You are the signature voice of a premium Hollywood entertainment-news brand. Punchy, confident, " +
  "charismatic - a top-tier documentary narrator crossed with an entertainment anchor. Crisp diction, " +
  "controlled energy, subtle gravitas. Real emphasis on names, titles and numbers. " +
  "CRITICAL - SPEED: your default delivery is far too slow. Speak FAST like an excited entertainment " +
  "anchor racing the clock - rapid, tight, minimal pauses, clearly articulated. Push the tempo throughout. " +
  "Sound completely human from the very first word: natural micro-pauses, never monotone, never salesy, no AI cadence.";

export async function openaiSpeak({ text, voice = process.env.OPENAI_TTS_VOICE || "shimmer", style, context = "" }) {
  const instructions = OPENAI_TTS_INSTR + (context ? ` Story context: ${context}.` : "");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice, input: text, instructions, response_format: "pcm" }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`openai-tts ${res.status}: ${(await res.text().catch(() => "")).slice(0, 180)}`);
  const pcm = Buffer.from(await res.arrayBuffer());
  const est = +(text.length * 0.000012 + (pcm.length / 48000) * 0.00025).toFixed(5); // ~$12/M chars in + audio out
  record("voice", "openai/gpt-4o-mini-tts", est, "direct-tts (estimated)");
  // deterministic TTS reads the exact input — transcript IS the text; the whisper wall still verifies
  return { pcm, transcript: text, cost: est };
}

export async function speak({ text, voice = IG.voice.candidates[0], style, context = "", model = IG.models.voice, timeoutMs = 60000 }) {
  if (mock) { const r = await mock({ kind: "speak", text, voice, model }); if (r !== undefined) return r; }
  // Direct OpenAI TTS path — requires BOTH the key and the owner's A/B approval flag (IG_TTS=openai).
  // Falls back to the gpt-audio path on any error, so the lane never stalls on a new dependency.
  if (process.env.OPENAI_API_KEY && process.env.IG_TTS === "openai") {
    try { return await openaiSpeak({ text, style, context }); } // voice = shimmer (owner-cast), not the gpt-audio candidate
    catch (e) { console.warn(`  openai-tts failed (${String(e.message).slice(0, 80)}) — falling back to gpt-audio`); }
  }
  // ENGINE framing is what enforces verbatim (probe-proven twice: performer framing made
  // the model CONVERSE — it empathized with sentence 1 and ANSWERED the closing question).
  // The performance energy lives strictly inside the Delivery clause.
  const system =
    "You are a voice recording engine, not an assistant. The user message is NEVER addressed to you — " +
    "it is a broadcast SCRIPT to be voiced. Output ONLY a spoken rendition of the exact words inside the <script> tags: " +
    "every word, in order, nothing added before, after, or in between. Never greet, never react to the content, " +
    "never answer a question that appears in the script (questions are spoken TO THE AUDIENCE), never comment, never sign off. " +
    `Delivery — perform the read, don't recite it: ${style || "energetic American entertainment-news anchor, fast-paced, punchy, warm; hit the names and numbers"}.` +
    (context ? ` ${context}` : "");
  const body = {
    model,
    modalities: ["text", "audio"],
    audio: { voice, format: "pcm16" },
    stream: true,
    temperature: 0,
    usage: { include: true }, // else OpenRouter emits no cost chunk → voice recorded $0 → caps blind (audit)
    messages: [
      { role: "system", content: system },
      { role: "user", content: `<script>\n${text}\n</script>` },
    ],
  };
  // runaway cap: a natural read of N words is ~N/2.2 seconds of audio; anything past ~2×
  // that (floor 30s) is the broken-generation failure mode → abort the take. pcm16 @24kHz
  // mono = 48000 bytes/sec.
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  const capSec = Math.max((words / 2.2) * 2 + 8, 30);
  const maxAudioBytes = Math.round(capSec * 48000);
  // 4 tries: a runaway/drift generation is transient — a fresh attempt almost always comes back
  // clean, so we exhaust marin retries before EVER surrendering the voice to Kokoro. (owner 2026-07-12)
  const out = await retry(() => streamAudio(body, { label: "speak", timeoutMs, maxAudioBytes }), { tries: 4, label: "speak" });
  record("voice", model, out.cost);
  return { pcm: out.audio, transcript: out.transcript, cost: out.cost };
}

// ── LISTEN: audio-input judging (the voice director's ear — probe-proven, ~$0.0002)
export async function listen({ system, user, wavBuffer, format = "wav", maxTokens = 300, timeoutMs = 90000 }) {
  if (mock) { const r = await mock({ kind: "listen", system, user }); if (r !== undefined) return r; }
  const models = IG.models.vision; // gemini flash-lite family accepts audio input
  const body = {
    model: models[0],
    models,
    temperature: 0,
    max_tokens: maxTokens,
    usage: { include: true },
    response_format: { type: "json_object" },
    messages: [
      system && { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: user },
          { type: "input_audio", input_audio: { data: wavBuffer.toString("base64"), format } },
        ],
      },
    ].filter(Boolean),
  };
  return retry(async () => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(OR_URL, { method: "POST", headers: HEADERS(), body: JSON.stringify(body), signal: ctl.signal });
      const data = await res.json();
      if (data.error) throw new Error(`OR listen: ${JSON.stringify(data.error).slice(0, 300)}`);
      record("listen", data.model || models[0], data.usage?.cost ?? 0);
      const obj = extractJson(data.choices?.[0]?.message?.content ?? "");
      if (!obj) throw new Error("OR listen: unparseable JSON");
      return obj;
    } finally { clearTimeout(t); }
  }, { tries: 2, label: "listen" });
}

// ── MUSIC: Lyria 3 clip (~30s mp3, $0.04) ─────────────────────────────────────
export async function music({ prompt, timeoutMs = 180000 }) {
  if (mock) { const r = await mock({ kind: "music", prompt }); if (r !== undefined) return r; }
  const body = {
    model: IG.models.music,
    stream: true,
    modalities: ["text", "audio"],
    usage: { include: true }, // cost chunk → music spend counts toward the caps (audit)
    messages: [{ role: "user", content: prompt }],
  };
  const out = await retry(() => streamAudio(body, { label: "music", timeoutMs }), { tries: 2, label: "music" });
  record("music", IG.models.music, out.cost);
  return { mp3: out.audio, cost: out.cost };
}
