// GOSSIP — MODEL REGISTRY (Phase 0 of GOSSIP_MULTI_AGENT_UPGRADE_PLAN.md). The single source of truth for
// every agent role's tuning, mirroring the proven inside/boxoffice pattern: every LLM call in the lane routes
// through agentChat(role, …) so model choice + fallback chain + per-attempt deadlines + the per-role METER
// live in ONE place. All models are CHEAP by owner hard rule — NEVER a premium model at runtime.
//
// Phase 0 rule: registry values = EXACTLY the models/temps/tokens the lane uses today (no behavior change).
// Future roles (synthesizer/headline/seoAuditor/voice) are declared here but unused until their phase lands.
//
// 💰 COST: pipeline/lib/openrouter.mjs costReport() remains the ONE cost source (it meters usage.cost on every
// call). meterReport() here is the PER-ROLE breakdown for the stats ledger — never ADD it on top of costReport
// (the documented inside-lane double-count trap).
import { chat } from "../lib/openrouter.mjs";

export const AGENTS = {
  // Discovery classify over the candidate pool — highest call count, every pick re-verified downstream.
  // (Phase 1 may trial amazon/nova-micro-v1 here after an offline quality check; today's model kept for parity.)
  scout: { model: "google/gemini-2.5-flash-lite", fallback: "deepseek/deepseek-v4-flash", temperature: 0.1, maxTokens: 4000, watchdogMs: 120e3, attemptDeadlineMs: 90e3 },
  // Dedup gray-band adjudicator (same event / update / distinct). Fallback keeps a transient outage from
  // fail-closed-HOLDing a real story.
  dedup: { model: "deepseek/deepseek-v3.2", fallback: "deepseek/deepseek-v4-flash", temperature: 0, maxTokens: 200, watchdogMs: 90e3, attemptDeadlineMs: 45e3 },
  // Editorial gate — content-grounded reject/category/attribution (the lane's only judgment-heavy gate).
  editor: { model: "google/gemini-2.5-flash", fallback: "google/gemini-2.5-flash-lite", temperature: 0.1, maxTokens: 500, watchdogMs: 90e3, attemptDeadlineMs: 60e3 },
  // The writer. LOCKED deepseek-v3.2 (proven at gossip's 236–450-word form). v4-flash is OUTAGE fallback only —
  // it edits quotes (inside-lane proof), acceptable only because the verbatim quoteGuard re-checks everything.
  writer: { model: "deepseek/deepseek-v3.2", fallback: "deepseek/deepseek-v4-flash", temperature: 0.4, surgicalTemperature: 0.2, maxTokens: 2800, watchdogMs: 240e3, attemptDeadlineMs: 150e3 },
  // Claim-verify L3 (the deterministic L1/L2/L2.5 floors run before this). Caller has its own retry loop.
  verify: { model: "google/gemini-2.5-flash", fallback: "google/gemini-2.5-flash-lite", temperature: 0, maxTokens: 900, watchdogMs: 90e3, attemptDeadlineMs: 60e3 },
  // Engagement/safety scorer — approver, never a blocker (owner-locked calibration).
  judge: { model: "google/gemini-2.5-flash-lite", fallback: "deepseek/deepseek-v4-flash", temperature: 0.2, maxTokens: 900, watchdogMs: 90e3, attemptDeadlineMs: 60e3 },
  // Hero-image vision rank. No fallback — the hero is garnish; on failure the article ships with the og/TMDB pick
  // or none (fail-safe, existing semantics).
  image: { model: "google/gemini-2.5-flash-lite", fallback: null, temperature: 0, maxTokens: 400, watchdogMs: 90e3, attemptDeadlineMs: 60e3 },
  // Internal-link contradiction firewall — fail-closed on error (existing semantics), so no fallback needed.
  linker: { model: "google/gemini-2.5-flash-lite", fallback: null, temperature: 0, maxTokens: 150, watchdogMs: 60e3, attemptDeadlineMs: 30e3 },
  // ── Declared for later phases (unused in Phase 0) ──
  // Writer's brief from the gathered bundle — analytical, quotes referenced by anchor ID only (Phase 2).
  synthesizer: { model: "deepseek/deepseek-v4-flash", fallback: "qwen/qwen3-235b-a22b-2507", temperature: 0.3, maxTokens: 1600, watchdogMs: 120e3, attemptDeadlineMs: 80e3 },
  // Best-of-3 H1/metaTitle/metaDescription candidates (Phase 2).
  headline: { model: "deepseek/deepseek-v3.2", fallback: "deepseek/deepseek-v4-flash", temperature: 0.7, maxTokens: 900, watchdogMs: 90e3, attemptDeadlineMs: 60e3 },
  // CTR/contract judge over headline candidates (Phase 2).
  headlineJudge: { model: "google/gemini-2.5-flash-lite", fallback: null, temperature: 0, maxTokens: 400, watchdogMs: 60e3, attemptDeadlineMs: 30e3 },
  // Post-assemble semantic SEO pass (Phase 3; the deterministic walls are free code, not a model).
  seoAuditor: { model: "google/gemini-2.5-flash-lite", fallback: null, temperature: 0, maxTokens: 500, watchdogMs: 60e3, attemptDeadlineMs: 45e3 },
  // Quote-masked register polish (Phase 4, flagged off by default).
  voice: { model: "deepseek/deepseek-v4-flash", fallback: null, temperature: 0.75, maxTokens: 2800, watchdogMs: 120e3, attemptDeadlineMs: 90e3 },
};

// Per-Mtok [in, out] — for the meterReport per-role breakdown ONLY (costReport() is the billing truth).
const PRICES = {
  "google/gemini-2.5-flash-lite": [0.10, 0.40],
  "google/gemini-2.5-flash": [0.30, 2.50],
  "deepseek/deepseek-v3.2": [0.23, 0.34],
  "deepseek/deepseek-v4-flash": [0.09, 0.18],
  "qwen/qwen3-235b-a22b-2507": [0.18, 0.54],
  "amazon/nova-micro-v1": [0.035, 0.14],
};

// Per-run, per-role call log: {role, model, ms, in, out} on success, {role, model, ms, error} on failure.
const METER = [];
export function meterReset() { METER.length = 0; }
export function meterEntries() { return [...METER]; }
export function meterReport() {
  const byRole = {};
  for (const m of METER) {
    const r = (byRole[m.role] ||= { calls: 0, errors: 0, in: 0, out: 0, usd: 0, ms: 0 });
    r.calls++;
    r.ms += m.ms || 0;
    if (m.error) { r.errors++; continue; }
    r.in += m.in || 0;
    r.out += m.out || 0;
    const [pi, po] = PRICES[m.model] || [0, 0];
    r.usd += ((m.in || 0) * pi + (m.out || 0) * po) / 1e6;
  }
  return byRole;
}

// Race a promise against a deadline — Node fetch has no timeout, so a hung provider must trigger the
// fallback chain instead of eating the stage watchdog (inside cloud-run 8 + 10 lessons).
export function withTimeout(promise, ms, label = "op") {
  if (!ms || !Number.isFinite(ms)) return promise;
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

/**
 * The ONLY way a gossip agent calls a model. Iterates [primary, fallback] (or an explicit `model` override),
 * races each attempt against attemptDeadlineMs, meters every attempt, throws only when every model failed.
 * `surgical: true` selects surgicalTemperature (the writer's low-temp correction passes).
 * `chatImpl` is injectable so the whole lane stays offline-testable.
 */
export async function agentChat(role, { model: override, system, user, images, json = false, maxTokens, temperature, surgical = false, retries = 2, attemptDeadlineMs } = {}, { chatImpl } = {}) {
  const cfg = AGENTS[role];
  if (!cfg) throw new Error(`unknown agent role: ${role}`);
  const impl = chatImpl || chat;
  const models = override ? [override] : [cfg.model, cfg.fallback].filter(Boolean);
  const temp = temperature ?? (surgical && cfg.surgicalTemperature != null ? cfg.surgicalTemperature : cfg.temperature);
  const deadline = attemptDeadlineMs ?? cfg.attemptDeadlineMs;
  let lastErr;
  for (const model of models) {
    const t0 = Date.now();
    try {
      const res = await withTimeout(
        impl({ model, system, user, ...(images ? { images } : {}), json, maxTokens: maxTokens ?? cfg.maxTokens, temperature: temp, retries }),
        deadline,
        `${role}:${model}`
      );
      METER.push({ role, model, ms: Date.now() - t0, in: res?.usage?.prompt_tokens || 0, out: res?.usage?.completion_tokens || 0 });
      return res;
    } catch (e) {
      METER.push({ role, model, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 80) });
      lastErr = e;
    }
  }
  throw lastErr;
}
