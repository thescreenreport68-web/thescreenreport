// OpenRouter chat helper. Reads OPENROUTER_API_KEY from env (never argv).
const BASE = "https://openrouter.ai/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      return json ? { data: parseJson(text), usage, raw: text } : { text, usage };
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (a + 1));
    }
  }
  throw lastErr;
}
