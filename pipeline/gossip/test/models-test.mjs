// PHASE 0 — models.mjs registry + metered agentChat. Offline (chatImpl injected). Run:
//   node pipeline/gossip/test/models-test.mjs
import { AGENTS, agentChat, meterReset, meterEntries, meterReport, withTimeout } from "../models.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== MODELS REGISTRY + agentChat ===\n");

// 1) registry sanity: every role has a model + cheap-only (no premium IDs).
{
  const roles = Object.keys(AGENTS);
  const premium = roles.filter((r) => /opus|gpt-4o|gpt-5(?!-nano)|claude-3|sonnet|o1|kimi/i.test(AGENTS[r].model));
  check("all roles have a model + none premium", roles.length >= 9 && premium.length === 0, JSON.stringify(premium));
}
// 2) unknown role throws.
{
  let threw = false;
  try { await agentChat("nope", {}, { chatImpl: async () => ({}) }); } catch { threw = true; }
  check("unknown role throws", threw);
}
// 3) success path: returns data, meters tokens, uses the registry model + temperature.
{
  meterReset();
  let got = null;
  const chatImpl = async (o) => { got = o; return { data: { ok: 1 }, usage: { prompt_tokens: 100, completion_tokens: 50 } }; };
  const res = await agentChat("writer", { system: "s", user: "u", json: true }, { chatImpl });
  const m = meterEntries();
  check("success: data returned + meter entry with tokens", res.data.ok === 1 && m.length === 1 && m[0].in === 100 && m[0].out === 50 && m[0].role === "writer");
  check("registry model + fresh temperature used", got.model === AGENTS.writer.model && got.temperature === 0.4 && got.maxTokens === AGENTS.writer.maxTokens);
}
// 4) surgical flag selects surgicalTemperature.
{
  let got = null;
  await agentChat("writer", { user: "u", surgical: true }, { chatImpl: async (o) => { got = o; return { data: {}, usage: {} }; } });
  check("surgical → surgicalTemperature (0.2)", got.temperature === 0.2);
}
// 5) primary fails → fallback used; both attempts metered.
{
  meterReset();
  const chatImpl = async (o) => {
    if (o.model === AGENTS.writer.model) throw new Error("provider down");
    return { data: { via: o.model }, usage: { prompt_tokens: 10, completion_tokens: 5 } };
  };
  const res = await agentChat("writer", { user: "u" }, { chatImpl });
  const m = meterEntries();
  check("fallback chain: v3.2 error → v4-flash success", res.data.via === AGENTS.writer.fallback && m.length === 2 && !!m[0].error && !m[1].error);
}
// 6) attempt deadline: a hung primary triggers the fallback instead of hanging.
{
  meterReset();
  const chatImpl = (o) => o.model === AGENTS.writer.model
    ? new Promise(() => {}) // never resolves — a hung provider
    : Promise.resolve({ data: { via: o.model }, usage: {} });
  const t0 = Date.now();
  const res = await agentChat("writer", { user: "u", attemptDeadlineMs: 120 }, { chatImpl });
  check("hung primary → deadline → fallback (fast)", res.data.via === AGENTS.writer.fallback && Date.now() - t0 < 2000);
  check("timeout attempt metered as error", meterEntries()[0].error?.includes("timed out"));
}
// 7) explicit model override skips the chain.
{
  let got = null;
  await agentChat("judge", { user: "u", model: "google/gemini-2.5-flash" }, { chatImpl: async (o) => { got = o; return { data: {}, usage: {} }; } });
  check("explicit model override respected", got.model === "google/gemini-2.5-flash");
}
// 8) all models exhausted → throws the last error.
{
  let threw = null;
  try { await agentChat("writer", { user: "u" }, { chatImpl: async () => { throw new Error("all down"); } }); } catch (e) { threw = e; }
  check("all models fail → throws", threw?.message === "all down");
}
// 9) meterReport: per-role rollup with usd math.
{
  meterReset();
  const chatImpl = async () => ({ data: {}, usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } });
  await agentChat("linker", { user: "u" }, { chatImpl }); // flash-lite: $0.10 + $0.40 = $0.50 at 1M+1M
  const rep = meterReport();
  check("meterReport per-role usd math", rep.linker.calls === 1 && Math.abs(rep.linker.usd - 0.5) < 1e-9, JSON.stringify(rep.linker));
}
// 10) withTimeout passes through fast promises.
{
  const v = await withTimeout(Promise.resolve(42), 1000, "x");
  check("withTimeout passthrough", v === 42);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Models registry green. ✅\n");
