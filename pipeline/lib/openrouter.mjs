// OpenRouter chat helper. Reads OPENROUTER_API_KEY from env (never argv).
const BASE = "https://openrouter.ai/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Cost meter ─────────────────────────────────────────────────────────────────────────────────
// Every chat() call pushes its real token usage here so a run can report MEASURED dollars, not a guess.
// Rates = OpenRouter $/million tokens [input, output] (2026). Keep in sync with config.MODELS.candidates.
export const USAGE = [];
const RATES = {
  "deepseek/deepseek-v3.2": [0.23, 0.34],
  "google/gemini-2.5-flash-lite": [0.1, 0.4],
  "google/gemini-2.5-flash": [0.3, 2.5],
  "anthropic/claude-opus-4.8": [15, 75],
  "meta-llama/llama-4-maverick": [0.15, 0.6],
};
export function costReport() {
  const byModel = {};
  let total = 0;
  for (const u of USAGE) {
    const [ri, ro] = RATES[u.model] || [0, 0];
    const c = ((u.prompt_tokens || 0) * ri + (u.completion_tokens || 0) * ro) / 1e6;
    const m = (byModel[u.model] ||= { calls: 0, in: 0, out: 0, usd: 0 });
    m.calls++; m.in += u.prompt_tokens || 0; m.out += u.completion_tokens || 0; m.usd += c;
    total += c;
  }
  return { total, byModel, calls: USAGE.length };
}

function parseJson(t) {
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = (fence ? fence[1] : t).trim();
  try {
    return JSON.parse(s);
  } catch (e) {
    const i = s.indexOf("{");
    const j = s.lastIndexOf("}");
    if (i >= 0 && j > i) return JSON.parse(s.slice(i, j + 1));
    throw new Error("could not parse JSON from model output");
  }
}

export async function chat({
  model,
  system,
  user,
  json = false,
  maxTokens = 4000,
  temperature = 0.7,
  retries = 4,
}) {
  const KEY = process.env.OPENROUTER_API_KEY;
  if (!KEY) throw new Error("OPENROUTER_API_KEY not in env (source ../.env)");
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });
  const body = { model, messages, max_tokens: maxTokens, temperature };
  if (json) body.response_format = { type: "json_object" };

  let lastErr;
  for (let a = 0; a < retries; a++) {
    try {
      const r = await fetch(BASE + "/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + KEY,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://thescreenreport.com",
          "X-Title": "The Screen Report",
        },
        body: JSON.stringify(body),
      });
      if (r.status === 429 || r.status >= 500) {
        lastErr = new Error("HTTP " + r.status);
        await sleep(2000 * (a + 1));
        continue;
      }
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      const text = j.choices?.[0]?.message?.content ?? "";
      if (!text) throw new Error("empty completion");
      const usage = j.usage || {};
      USAGE.push({ model, prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0 });
      return json ? { data: parseJson(text), usage, raw: text } : { text, usage };
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (a + 1));
    }
  }
  throw lastErr;
}
