// Role-based LLM access for the cards lane — thin wrapper over the shared OpenRouter
// helper (pipeline/lib/openrouter.mjs) adding: role→model roster with fallback, and a
// vision call that ships the rendered JPEG as a data URI. Cost is metered by the shared
// USAGE array; cardsrun prints costReport() per run.
import { chat } from "../lib/openrouter.mjs";
import { CARDS } from "./config.mjs";

// mock hook for offline tests: test sets globalThis.__cardsMockLLM = async ({role,...}) => result|undefined
export async function llm({ role, system, user, json = true, maxTokens = 1200, temperature = 0.3 }) {
  const mock = globalThis.__cardsMockLLM;
  if (mock) { const r = await mock({ kind: "llm", role, system, user }); if (r !== undefined) return r; }
  const models = CARDS.models[role];
  if (!models) throw new Error(`unknown model role: ${role}`);
  let lastErr;
  for (const model of models) {
    try {
      const out = await chat({ model, system, user, json, maxTokens, temperature });
      return json ? out.data : out.text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

export async function vision({ system, user, jpegBuffer, json = true, maxTokens = 800 }) {
  const mock = globalThis.__cardsMockLLM;
  if (mock) { const r = await mock({ kind: "vision", system, user }); if (r !== undefined) return r; }
  const dataUri = `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
  let lastErr;
  for (const model of CARDS.models.vision) {
    try {
      const out = await chat({ model, system, user, images: [dataUri], json, maxTokens, temperature: 0 });
      return json ? out.data : out.text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
