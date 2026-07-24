// MODEL REGISTRY (box-office lane) — the single source of truth for every agent's tuning
// (plan: BOX_OFFICE_MULTI_AGENT_PLAN.md §8). Every LLM call routes through agentChat(role, …) so
// tuning + the fallback chain + cost METERing live in ONE place. All models are CHEAP by owner hard
// rule ([[automation-hard-constraints]]) — NEVER a premium model at runtime. Prices are the same
// verified OpenRouter IDs the inside lane uses.
import { chat } from "../lib/openrouter.mjs";
import { fault, SEV } from "./health.mjs";

export const AGENTS = {
  // Discovery classify — fires most, matters least per call (re-verified downstream). Picks ONE
  // trending in-theater Hollywood film + the form + search queries in one batched classify.
  finder: {
    model: "amazon/nova-micro-v1",
    fallback: "google/gemini-2.5-flash-lite",
    temperature: 0.2,
    // 900 was sized for a 6-8 film pool. The volume work grew the pool to ~43, and each pick serialises
    // to ~60 tokens (i/form/workingTitle/star/2 queries), so the reply needs ~2600 — the JSON array was
    // being TRUNCATED mid-element on EVERY call, on BOTH models:
    //   "Expected ',' or ']' after array element in JSON at position 2459 / 3041"
    // The lane silently ran on deterministic fallback picks for days. Sized with real headroom.
    maxTokens: 4000,
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
// ── JSON SALVAGE (lane-local; the shared lib is owned by other lanes and must not be edited) ─────────
// pipeline/lib/openrouter.mjs parseJson() falls back to slicing indexOf("{")..lastIndexOf("}"). When a
// model emits TWO objects, or one object followed by prose containing a brace, that slice is valid JSON
// PLUS trailing content and JSON.parse throws:
//     "Unexpected non-whitespace character after JSON at position 244"
// Reproduced exactly. This fired on EVERY finder call — both models — so the lane silently ran on
// deterministic fallback picks for days. Extract the FIRST BALANCED object instead (string- and
// escape-aware, so a brace inside a quoted title cannot end it early).
export function firstJsonObject(text) {
  const t = String(text ?? "");
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = (fence ? fence[1] : t).trim();
  const start = s.indexOf("{");
  if (start < 0) return null;
  // Walk the structure tracking the open bracket stack, so we can both (a) stop at the first COMPLETE
  // object when there is trailing junk, and (b) REPAIR a response the model ran out of tokens mid-write.
  const stack = [];
  let inStr = false, esc = false, lastComplete = -1, openAtComplete = null;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      stack.pop();
      if (stack.length === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
      // We just closed an element that sits INSIDE an array (stack top is now "[") — that is a clean
      // truncation point. Depth is 2 here for the common {"picks":[ {...}, {...} ]} shape, not 1.
      if (stack.length && stack[stack.length - 1] === "[") { lastComplete = i; openAtComplete = stack.slice(); }
    }
  }
  // TRUNCATED (the live finder failure): the model was cut off mid-array. Rewind to the last element
  // that closed cleanly and shut the remaining brackets, so we keep the picks that DID arrive instead of
  // throwing the whole response away. Never invents a value — it only drops an incomplete tail.
  if (stack.length && lastComplete > start) {
    // Close the brackets that were open AT the truncation point — not the final stack, which also holds
    // the half-written element opened after it (that extra "{" produced an unbalanced repair).
    const closers = (openAtComplete || stack).slice().reverse().map((b) => (b === "{" ? "}" : "]")).join("");
    try { return JSON.parse(s.slice(start, lastComplete + 1) + closers); } catch { /* fall through */ }
  }
  return null;
}
const isJsonParseError = (e) => /JSON|non-whitespace|Unexpected token|could not parse/i.test(String(e?.message || e));

export async function agentChat(role, { system, user, images = null, json = true, surgical = false, maxTokens = null, retries = 1 } = {}, { chatImpl = chat } = {}) {
  const cfg = AGENTS[role];
  if (!cfg) throw new Error(`unknown agent role: ${role}`);
  const temperature = surgical && cfg.surgicalTemperature != null ? cfg.surgicalTemperature : cfg.temperature;
  const models = [cfg.model, cfg.fallback].filter(Boolean);
  let lastErr = null;
  const errsByModel = [];
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
      // JSON-SHAPE SALVAGE: the model answered, we just could not parse it. Re-ask this SAME model for
      // raw text and extract the first balanced object rather than burning the fallback model (and then
      // the whole call) on what is a parsing problem, not a model problem.
      if (json && isJsonParseError(e)) {
        try {
          const raw = await chatImpl({ model, system, user, images, json: false, maxTokens: maxTokens ?? cfg.maxTokens, temperature, retries: 1 });
          const salvaged = firstJsonObject(raw?.text ?? raw?.content ?? raw?.data ?? raw);
          if (salvaged) {
            fault(`model:${role}`, `malformed JSON from ${model} — salvaged the first balanced object`, { severity: SEV.INFO });
            METER.push({ role, model, salvaged: true, in: raw?.usage?.prompt_tokens ?? 0, out: raw?.usage?.completion_tokens ?? 0 });
            return { ...(raw || {}), data: salvaged };
          }
        } catch { /* silent-ok: salvage is best-effort; the outer fallback/fault path still runs */ }
      }
      lastErr = e;
      errsByModel.push({ model, err: String(e?.message || e).slice(0, 90) });
      METER.push({ role, model, error: String(e?.message || e).slice(0, 120) });
    }
  }
  // Every model for this role failed. Bug #8 (retries=0 → zero requests) made this happen on EVERY call
  // at $0 cost, which read as a quiet news day. It is now a recorded CRITICAL fault before it throws.
  // SEVERITY BY CONSEQUENCE, not by stage. `finder` has a deterministic fallback (agents/finder.mjs) and
  // the chart candidates never touch it at all, so its failure degrades ranking quality — it does not
  // void the tick. Marking it CRITICAL failed the GitHub job on ~78% of ticks and produced the owner's
  // "not posting" email storm on days the lane published its entire available supply. CRITICAL is now
  // reserved for roles whose loss actually stops an article being written.
  const HAS_FALLBACK = new Set(["finder", "categorize", "image"]);
  const severity = HAS_FALLBACK.has(role) ? SEV.WARN : SEV.CRITICAL;
  // Report BOTH models' errors: lastErr is overwritten each iteration, so the message used to show only
  // the fallback's error while listing both names — which made three distinct failure classes look
  // identical for five days.
  const detail = errsByModel.map((e) => `${e.model}: ${e.err}`).join(" | ");
  fault(`model:${role}`, `all models failed — ${detail}`, { severity });
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
