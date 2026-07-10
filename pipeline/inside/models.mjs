// MODEL REGISTRY — the single source of truth for every agent's tuning (plan: INSIDE_MULTI_AGENT_PLAN.md).
// Models researched + VERIFIED live on OpenRouter 2026-07-10 (IDs resolve at the cited prices).
// Every LLM call in the lane goes through agentChat(role, …) so tuning + fallback + cost metering
// live in ONE place. All models are CHEAP by owner hard rule — never a premium model at runtime.
import { chat } from "../lib/openrouter.mjs";

export const AGENTS = {
  // Discovery classify — fires the most, matters the least per call (re-verified downstream).
  finder: {
    model: "amazon/nova-micro-v1",            // $0.035/$0.14 per Mtok
    fallback: "google/gemini-2.5-flash-lite",
    temperature: 0.2,
    maxTokens: 800,
    watchdogMs: 60e3,
  },
  // Literal verbatim extraction to strict JSON — zero creativity wanted.
  gatherer: {
    model: "google/gemini-2.5-flash-lite",    // $0.10/$0.40 — most reliable cheap strict-JSON
    fallback: "openai/gpt-5-nano",
    temperature: 0,
    maxTokens: 2200,
    watchdogMs: 180e3,
  },
  // IG/X embed relevance pick — deterministic scanning + one cheap classify.
  embed: {
    model: "google/gemini-2.5-flash-lite",
    fallback: null,                           // embeds are garnish: on failure, ship without
    temperature: 0,
    maxTokens: 1200,
    watchdogMs: 90e3,
  },
  // Reads the WHOLE gathered pile, distills the brief — analytical, not creative.
  synthesizer: {
    model: "deepseek/deepseek-v4-flash",      // $0.09/$0.18 — reasoning + cheap output
    fallback: "qwen/qwen3-235b-a22b-2507",
    temperature: 0.3,
    maxTokens: 1600,
    watchdogMs: 120e3,
  },
  // The prose. Creative on fresh drafts, surgical on corrections.
  // 2026-07-10 proof-run verdict: deepseek-v4-flash EDITS quotes (drops apostrophes, merges spans,
  // leaks ** into quotation marks), quote-dumps 35-45%, and stalled 240s — the registry plan's
  // fallback clause triggered. v3.2 (which passed these exact locks and published cleanly) is
  // primary again; v4-flash stays as the outage fallback.
  writer: {
    model: "deepseek/deepseek-v3.2",
    fallback: "deepseek/deepseek-v4-flash",
    temperature: 0.7,
    surgicalTemperature: 0.2,
    maxTokens: 6000,
    watchdogMs: 240e3,
    attemptDeadlineMs: 150e3, // a SLOW primary falls back like a failing one (inside the watchdog)
  },
  // Vision relevance ranking of image candidates (inside imagePicker's vision pass).
  image: {
    model: "google/gemini-2.5-flash-lite",    // cheapest reliable vision + strict JSON
    fallback: "qwen/qwen3-vl-30b-a3b-instruct",
    temperature: 0,
    maxTokens: 400,
    watchdogMs: 120e3,
  },
  // The judge. Accuracy is existential; QA output is short so flash's output price barely bites.
  qa: {
    model: "google/gemini-2.5-flash",         // $0.30/$2.50
    fallback: "qwen/qwen3-235b-a22b-2507",
    temperature: 0,
    maxTokens: 900,
    watchdogMs: 180e3,
  },
};

// Optional prose step-up for flagship stories (~6x writer cost) — owner toggles per-run.
export const FLAGSHIP_WRITER = "moonshotai/kimi-k2-0905";
export const flagshipOn = () => process.env.INSIDE_FLAGSHIP === "1";

// ── Metered, fallback-aware chat — the ONLY way agents call a model ─────────────────────────────
// Records every call per role so the orchestrator can write the per-run cost/token report the
// 24/7 monitoring depends on.
export const METER = [];

export async function agentChat(role, { system, user, images = null, json = true, surgical = false, maxTokens = null, retries = 2 } = {}, { chatImpl = chat } = {}) {
  const cfg = AGENTS[role];
  if (!cfg) throw new Error(`unknown agent role: ${role}`);
  const temperature = surgical && cfg.surgicalTemperature != null ? cfg.surgicalTemperature : cfg.temperature;
  const models = [role === "writer" && flagshipOn() ? FLAGSHIP_WRITER : cfg.model, cfg.fallback].filter(Boolean);
  let lastErr = null;
  for (const model of models) {
    try {
      const t0 = Date.now();
      // Per-attempt deadline (when configured): a hung/slow provider triggers the FALLBACK chain
      // instead of eating the orchestrator watchdog with no second chance.
      const attempt = chatImpl({ model, system, user, images, json, maxTokens: maxTokens ?? cfg.maxTokens, temperature, retries });
      const res = cfg.attemptDeadlineMs
        ? await Promise.race([attempt, new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(`attempt deadline ${cfg.attemptDeadlineMs / 1e3}s (${model})`)), cfg.attemptDeadlineMs); t.unref?.(); })])
        : await attempt;
      METER.push({
        role, model, ms: Date.now() - t0,
        in: res?.usage?.prompt_tokens ?? 0, out: res?.usage?.completion_tokens ?? 0,
      });
      return res;
    } catch (e) {
      lastErr = e;
      METER.push({ role, model, error: String(e?.message || e).slice(0, 120) });
    }
  }
  throw lastErr || new Error(`${role}: all models failed`);
}

// Per-run rollup for the report (tokens + rough cost per role).
const PRICE = { // $ per Mtok in/out, verified 2026-07-10 — used only for the report estimate
  "amazon/nova-micro-v1": [0.035, 0.14],
  "google/gemini-2.5-flash-lite": [0.10, 0.40],
  "google/gemini-2.5-flash": [0.30, 2.50],
  "deepseek/deepseek-v4-flash": [0.09, 0.18],
  "deepseek/deepseek-v3.2": [0.229, 0.343],
  "openai/gpt-5-nano": [0.05, 0.40],
  "qwen/qwen3-235b-a22b-2507": [0.09, 0.10],
  "qwen/qwen3-vl-30b-a3b-instruct": [0.13, 0.52],
  "moonshotai/kimi-k2-0905": [0.60, 2.50],
};
export function meterReport() {
  const byRole = {};
  let totalUsd = 0;
  for (const m of METER) {
    const r = (byRole[m.role] ||= { calls: 0, errors: 0, in: 0, out: 0, usd: 0, ms: 0 });
    r.calls++;
    if (m.error) { r.errors++; continue; }
    r.in += m.in; r.out += m.out; r.ms += m.ms;
    const [pi, po] = PRICE[m.model] || [0.3, 1.0];
    const usd = (m.in * pi + m.out * po) / 1e6;
    r.usd += usd; totalUsd += usd;
  }
  for (const r of Object.values(byRole)) r.usd = Number(r.usd.toFixed(5));
  return { byRole, totalUsd: Number(totalUsd.toFixed(5)) };
}
export function meterReset() { METER.length = 0; }
