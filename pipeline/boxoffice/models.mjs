// MODEL REGISTRY (box-office lane) — the single source of truth for every agent's tuning
// (plan: BOX_OFFICE_MULTI_AGENT_PLAN.md §8). Every LLM call routes through agentChat(role, …) so
// tuning + the fallback chain + cost METERing live in ONE place. All models are CHEAP by owner hard
// rule ([[automation-hard-constraints]]) — NEVER a premium model at runtime. Prices are the same
// verified OpenRouter IDs the inside lane uses.
import { chat } from "../lib/openrouter.mjs";

export const AGENTS = {
  // Discovery classify — fires most, matters least per call (re-verified downstream). Picks ONE
  // trending in-theater Hollywood film + the form + search queries in one batched classify.
  finder: {
    model: "amazon/nova-micro-v1",
    fallback: "google/gemini-2.5-flash-lite",
    temperature: 0.2,
    maxTokens: 900,
    watchdogMs: 60e3,
  },
  // FIND categorize — ONE batched call per FIND run turns raw trade/gnews headlines into typed box-office
  // events (film + kind + form). Cheapest tier; everything before/after it is deterministic (news-lane pattern).
  categorize: {
    model: "google/gemini-2.5-flash-lite",
    fallback: "amazon/nova-micro-v1",
    temperature: 0,
    maxTokens: 1600,
    watchdogMs: 90e3,
  },
  // Literal verbatim extraction of every reported number/narrative/cast to strict JSON — zero creativity.
  gatherer: {
    model: "google/gemini-2.5-flash-lite",
    fallback: "openai/gpt-5-nano",
    temperature: 0,
    maxTokens: 2200,
    watchdogMs: 180e3,
  },
  // Reads the whole gathered pile + TMDB data, distils the engagement brief (hook + why up/why down).
  synthesizer: {
    model: "deepseek/deepseek-v4-flash",
    fallback: "qwen/qwen3-235b-a22b-2507",
    temperature: 0.3,
    maxTokens: 1600,
    watchdogMs: 150e3,
    attemptDeadlineMs: 80e3,
  },
  // The prose — stars-first, trade voice, faithful, engaging. Creative fresh / surgical on corrections.
  // WRITER MODEL (owner-approved 2026-07-12): the ultra-cheap models (deepseek-v3.2, qwen3-235b) BOTH write
  // terse ~130-word stubs no matter the prompt/data → could not meet the owner's 300-word HARD minimum. Moved
  // to a capable, VERBOSE, still-affordable model (gpt-4.1-mini, ~$0.4/$1.6 per M ≈ $0.002/article — NOT a
  // premium/$400+/mo model) that reliably writes full 300-450-word pieces; gemini-2.5-flash is the fallback.
  writer: {
    model: "openai/gpt-4.1-mini",
    fallback: "google/gemini-2.5-flash",
    temperature: 0.7,
    surgicalTemperature: 0.2,
    maxTokens: 6000,
    watchdogMs: 240e3,
    attemptDeadlineMs: 150e3,
  },
  // Chart-update PROFILE prose only (~150-220 words). Every number, title, metaTitle, takeaway, FAQ and the
  // "At the Box Office" section are SYSTEM-BUILT from canonical figures, so the writer here only writes a short
  // movie profile — the terse ultra-cheap model that failed 300-word features is EXACTLY right for this
  // (cost lever §4.5: ~4× cheaper than gpt-4.1-mini; features keep the verbose writer below).
  writerChart: {
    model: "deepseek/deepseek-v3.2",
    fallback: "openai/gpt-4.1-mini",
    temperature: 0.7,
    surgicalTemperature: 0.2,
    maxTokens: 3000,
    watchdogMs: 180e3,
    attemptDeadlineMs: 120e3,
  },
  // The judge — fidelity walls run deterministically BEFORE this; the judge scores engagement/readability.
  qa: {
    model: "google/gemini-2.5-flash",
    fallback: "qwen/qwen3-235b-a22b-2507",
    temperature: 0,
    maxTokens: 900,
    watchdogMs: 180e3,
  },
  // Vision relevance ranking of image candidates (inside imagePicker's vision pass).
  image: {
    model: "google/gemini-2.5-flash-lite",
    fallback: "qwen/qwen3-vl-30b-a3b-instruct",
    temperature: 0,
    maxTokens: 400,
    watchdogMs: 120e3,
  },
};

// ── Metered, fallback-aware chat — the ONLY way agents call a model ─────────────────────────────
export const METER = [];

// retries = 1 by DEFAULT (registry §3.16). `chat()` carries its own ~150s abort + backoff per attempt, so
// the old retries=2 let a single call run ~300s — far past the attemptDeadlineMs we race it against.
// Promise.race abandons the result but the request keeps streaming and the tokens are still billed: we were
// paying for generations we had already given up on. This loop ALREADY retries via the primary->fallback
// model list, so the inner retries were redundant as well as un-cancellable.
// ⚠ MUST BE 1, NOT 0. `chat()` loops `for (let a = 0; a < retries; a++)`, so `retries` is an ATTEMPT COUNT,
// not a retry count — retries=0 makes ZERO requests and every call fails ("all models failed"). Verified
// live: retries=0 FAILED, retries=2 succeeded. 1 = exactly one bounded attempt. Shared lib untouched.
export async function agentChat(role, { system, user, images = null, json = true, surgical = false, maxTokens = null, retries = 1 } = {}, { chatImpl = chat } = {}) {
  const cfg = AGENTS[role];
  if (!cfg) throw new Error(`unknown agent role: ${role}`);
  const temperature = surgical && cfg.surgicalTemperature != null ? cfg.surgicalTemperature : cfg.temperature;
  const models = [cfg.model, cfg.fallback].filter(Boolean);
  let lastErr = null;
  for (const model of models) {
    try {
      const t0 = Date.now();
      const attempt = chatImpl({ model, system, user, images, json, maxTokens: maxTokens ?? cfg.maxTokens, temperature, retries });
      const res = cfg.attemptDeadlineMs
        ? await Promise.race([attempt, new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(`attempt deadline ${cfg.attemptDeadlineMs / 1e3}s (${model})`)), cfg.attemptDeadlineMs); t.unref?.(); })])
        : await attempt;
      METER.push({ role, model, ms: Date.now() - t0, in: res?.usage?.prompt_tokens ?? 0, out: res?.usage?.completion_tokens ?? 0 });
      return res;
    } catch (e) {
      lastErr = e;
      METER.push({ role, model, error: String(e?.message || e).slice(0, 120) });
    }
  }
  throw lastErr || new Error(`${role}: all models failed`);
}

// Per-run rollup for the report (tokens + rough cost per role). Prices verified 2026-07-10.
const PRICE = {
  "amazon/nova-micro-v1": [0.035, 0.14],
  "google/gemini-2.5-flash-lite": [0.10, 0.40],
  "google/gemini-2.5-flash": [0.30, 2.50],
  "deepseek/deepseek-v4-flash": [0.09, 0.18],
  "deepseek/deepseek-v3.2": [0.229, 0.343],
  "openai/gpt-4.1-mini": [0.40, 1.60],
  "openai/gpt-5-nano": [0.05, 0.40],
  "qwen/qwen3-235b-a22b-2507": [0.09, 0.10],
  "qwen/qwen3-vl-30b-a3b-instruct": [0.13, 0.52],
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
