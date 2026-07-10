// AGENT 2 — GATHERER ("the best at finding the data we need"). Its one job: gather the real
// reactions & discourse for the story and extract every quote/post VERBATIM into strict JSON.
// The engine is the proven harvest (contentFinder + Reddit + tweets-as-anchors + the deterministic
// verbatim wall + subject-match). This agent adds the tuned model routing (flash-lite, temp 0.0 —
// literal extraction only) and the work-file contract.
import { harvestReactions, factBlockText } from "../reactionFinder.mjs";
import { AGENTS, METER } from "../models.mjs";
import { chat } from "../../lib/openrouter.mjs";

// Metered chat shim with the gatherer's tuning — passed into the harvest engine so every
// extraction/classify call inside it uses the gatherer's model + temp and lands in the meter.
function gathererChat({ chatImpl = chat } = {}) {
  const cfg = AGENTS.gatherer;
  return async (args) => {
    const t0 = Date.now();
    try {
      const res = await chatImpl({ ...args, model: cfg.model, temperature: cfg.temperature });
      METER.push({ role: "gatherer", model: cfg.model, ms: Date.now() - t0, in: res?.usage?.prompt_tokens ?? 0, out: res?.usage?.completion_tokens ?? 0 });
      return res;
    } catch (e) {
      METER.push({ role: "gatherer", model: cfg.model, error: String(e?.message || e).slice(0, 120) });
      // one retry on the fallback model, then give up on this source (harvest skips it)
      const res = await chatImpl({ ...args, model: cfg.fallback, temperature: cfg.temperature });
      METER.push({ role: "gatherer", model: cfg.fallback, ms: Date.now() - t0, in: res?.usage?.prompt_tokens ?? 0, out: res?.usage?.completion_tokens ?? 0 });
      return res;
    }
  };
}

// run(job) → fills job.factBlock, job.factText, job.bundle — or job.gatherFail = reason.
export async function run(job, { harvestImpl = harvestReactions, chatImpl = chat } = {}) {
  const h = await harvestImpl(job.story, job.angle, { chatImpl: gathererChat({ chatImpl }), model: AGENTS.gatherer.model });
  if (!h.ok) {
    job.gatherFail = h.reason || "harvest failed";
    job.gatherStats = h.stats || null;
    return job;
  }
  job.factBlock = h.factBlock;
  job.bundle = h.bundle;
  job.factText = factBlockText(h.factBlock, job.story);
  job.gatherStats = h.factBlock.stats;
  return job;
}
