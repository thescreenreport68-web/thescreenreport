// GOSSIP — CATEGORIZE & ROUTE (Stage 2). One cheap-LLM pass over the candidates: is it an in-scope gossip
// story (Hollywood celeb / Western musician)? extract the entity, the central CLAIM, the subjectType, the
// confirmation flags (confirmed/official/denied), and the angle → a gossip topic the orchestrator can run.
// classifyImpl is injectable so the harness runs offline with a deterministic mock.
import { chat } from "../lib/openrouter.mjs";
import { tierOf } from "./policy.mjs";

const SYSTEM = `You triage celebrity/music GOSSIP candidates for The Screen Report. IN SCOPE: Hollywood celebrities (actors/actresses) and Western/English-language musicians, and gossip/rumor/speculation about them (dating, breakups, feuds, deals, legal, health, controversy). OUT OF SCOPE: non-Hollywood/non-Western-music figures, politics, sports, and straight factual hard-news that isn't gossip/speculation. Output strict JSON only.`;

function buildPrompt(items) {
  return `Candidates:\n${items.map((it, i) => `[${i}] (${it.outlet}) ${it.title}${it.summary ? " — " + it.summary.slice(0, 200) : ""}`).join("\n")}

Return JSON:
{"results":[{"i":<index>,"inScope":<bool>,"primaryEntity":"<the main person>","subjectType":"actor|musician|awards","claim":"<the central rumor/claim in one sentence>","confirmed":<bool: officially confirmed / on the record>,"official":<bool: from a court/police record>,"denied":<bool: the subject/rep has denied it>,"angle":"<the hook>","reason":"<why in/out of scope>"}]}
Set inScope=false for anything out of scope.`;
}

async function defaultClassify(items) {
  const { data } = await chat({ model: "google/gemini-2.5-flash-lite", system: SYSTEM, user: buildPrompt(items), json: true, maxTokens: 1800, temperature: 0.1 });
  return data?.results || [];
}

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

export async function categorizeGossip(candidates, { classifyImpl = defaultClassify } = {}) {
  if (!candidates.length) return [];
  const results = await classifyImpl(candidates);
  const topics = [];
  for (const r of results || []) {
    if (!r || !r.inScope) continue;
    const c = candidates[r.i];
    if (!c || !r.primaryEntity) continue;
    topics.push({
      id: slugify(`${r.primaryEntity}-${(r.claim || "").slice(0, 24)}`),
      title: c.title,
      slug: slugify(c.title),
      primaryEntity: r.primaryEntity,
      subjectType: r.subjectType || "celebrity",
      claim: r.claim || c.title,
      angle: r.angle || "",
      confirmed: !!r.confirmed,
      official: !!r.official,
      denied: !!r.denied,
      sources: [{ outlet: c.outlet, url: c.url, tier: c.tier ?? tierOf(c.outlet) }],
    });
  }
  return topics;
}
