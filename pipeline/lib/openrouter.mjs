// OpenRouter chat helper. Reads OPENROUTER_API_KEY from env (never argv).
const BASE = "https://openrouter.ai/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Cost meter ─────────────────────────────────────────────────────────────────────────────────
// Every chat() call pushes its real token usage here so a run can report MEASURED dollars, not a guess.
// Rates = OpenRouter $/million tokens [input, output] (2026). Keep in sync with the models wired in config.MODELS.
export const USAGE = [];
const RATES = {
  "deepseek/deepseek-v3.2": [0.23, 0.34],
  "google/gemini-2.5-flash-lite": [0.1, 0.4],
  "google/gemini-2.5-flash": [0.3, 2.5],
  "anthropic/claude-opus-4.8": [15, 75],
  "meta-llama/llama-4-maverick": [0.15, 0.6],
  "perplexity/sonar": [1, 1], // token rate only; the per-request web-search fee dominates → prefer usage.cost (below)
};
export function costReport() {
  const byModel = {};
  let total = 0;
  for (const u of USAGE) {
    // Prefer the REAL cost OpenRouter returns (usage.cost) — it includes Perplexity's per-request search fee that
    // a flat token rate can't model; fall back to the token-rate estimate only when the API didn't report a cost.
    const [ri, ro] = RATES[u.model] || [0, 0];
    const c = (typeof u.cost === "number" && u.cost > 0) ? u.cost : ((u.prompt_tokens || 0) * ri + (u.completion_tokens || 0) * ro) / 1e6;
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
  images = null, // optional array of image URLs → sends a multimodal user turn (for the hero-image vision gate)
  web = false, // optional: enable OpenRouter's web-search plugin (live open-web grounding for the news reality-check)
  webMaxResults = 3, // keep small — each web result costs; 3 covers the load-bearing specifics of one article
  json = false,
  maxTokens = 4000,
  temperature = 0.7,
  retries = 4,
}) {
  const KEY = process.env.OPENROUTER_API_KEY;
  if (!KEY) throw new Error("OPENROUTER_API_KEY not in env (source ../.env)");
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  // Multimodal user turn when images are supplied (OpenAI/OpenRouter vision format); plain string otherwise.
  const userContent = images?.length
    ? [{ type: "text", text: user }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
    : user;
  messages.push({ role: "user", content: userContent });
  // NATIVE-SEARCH models (Perplexity Sonar) search the live web THEMSELVES and return url_citation annotations —
  // they must NOT get the OpenRouter `web` plugin (redundant/errors), and some reject response_format:json_object,
  // so we skip it and rely on parseJson (the prompt still demands strict JSON). Non-native models (gemini) keep
  // both, so the gemini+web path still works for the A/B bake-off.
  const nativeSearch = /^perplexity\//.test(model);
  const body = { model, messages, max_tokens: maxTokens, temperature };
  if (json && !nativeSearch) body.response_format = { type: "json_object" };
  // Web-search: the news reality-check (the only layer that catches a misread of an ambiguous source / a stale
  // number / a wrong credit against the LIVE web). Native-search models do it inherently; others get the plugin.
  if (web && !nativeSearch) body.plugins = [{ id: "web", max_results: webMaxResults }];

  let lastErr;
  for (let a = 0; a < retries; a++) {
    try {
      const r = await fetch(BASE + "/chat/completions", {
        method: "POST",
        // Cap each LLM call so a single hung socket can't stall the whole run — but generous enough NOT to abort a
        // legitimately-slow big generation (a 4k-token deepseek write can take ~90s) and needlessly retry. Web-search
        // calls run longest.
        signal: AbortSignal.timeout(web ? 120000 : 150000),
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
      const msg = j.choices?.[0]?.message || {};
      const text = msg.content ?? "";
      if (!text) throw new Error("empty completion");
      const usage = j.usage || {};
      USAGE.push({ model, prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, cost: usage.cost });
      // WEB-PLUGIN CITATIONS (2026-07-03 audit #1/#9): OpenRouter returns the URLs the web plugin actually fetched
      // as url_citation annotations. Surfacing them lets webVerify PROVE a real web lookup happened — so "no
      // contradiction" can never be mistaken for "verified" when the plugin silently returned nothing.
      const citations = (Array.isArray(msg.annotations) ? msg.annotations : [])
        .filter((a) => a && (a.type === "url_citation" || a.url_citation))
        .map((a) => (a.url_citation && a.url_citation.url) || a.url).filter(Boolean);
      return json ? { data: parseJson(text), usage, raw: text, citations } : { text, usage, citations };
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (a + 1));
    }
  }
  throw lastErr;
}
