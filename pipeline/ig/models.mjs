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
async function streamAudio(body, { label, timeoutMs }) {
  const ctl = new AbortController();
  const hardMs = Math.max(timeoutMs * 3, 300000);
  let t = setTimeout(() => ctl.abort(), timeoutMs);
  const hard = setTimeout(() => ctl.abort(), hardMs);
  const rearm = () => { clearTimeout(t); t = setTimeout(() => ctl.abort(), timeoutMs); };
  try {
    const res = await fetch(OR_URL, { method: "POST", headers: HEADERS(), body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok || !res.body) throw new Error(`${label}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const decoder = new TextDecoder();
    let buf = "";
    const audioB64 = [];
    let transcript = "";
    let usage = null;
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
          if (a?.data) audioB64.push(a.data);
          if (a?.transcript) transcript += a.transcript;
          if (ch.finish_reason || ch.native_finish_reason) finished = true;
        }
      }
    }
    if (errObj) throw new Error(`${label}: ${JSON.stringify(errObj).slice(0, 300)}`);
    if (!finished) throw new Error(`${label}: stream died mid-read (partial audio rejected)`);
    const audio = Buffer.concat(audioB64.map((x) => Buffer.from(x, "base64")));
    if (!audio.length) throw new Error(`${label}: stream returned no audio`);
    return { audio, transcript, cost: usage?.cost ?? 0 };
  } finally { clearTimeout(t); clearTimeout(hard); }
}

// ── SPEECH: verbatim-locked but PERFORMED, not read (probe-proven verbatim wall
// downstream makes the performative framing safe). Returns { pcm, transcript, cost }.
// timeout 100s: a healthy audio stream starts producing within seconds — a silent
// 100s stream is dead; fail fast and retry fast (2026-07-10: 240s timeouts let a slow
// OpenAI night blow through 20-minute stage watchdogs)
export async function speak({ text, voice = IG.voice.candidates[0], style, context = "", model = IG.models.voice, timeoutMs = 60000 }) {
  if (mock) { const r = await mock({ kind: "speak", text, voice, model }); if (r !== undefined) return r; }
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
  const out = await retry(() => streamAudio(body, { label: "speak", timeoutMs }), { tries: 2, label: "speak" });
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
