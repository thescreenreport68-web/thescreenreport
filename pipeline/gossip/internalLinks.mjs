// GOSSIP — INTERNAL LINKS (Step 7). Adds links ONLY to REAL, RELATED, published articles. Three gates, in order:
//   1) SHARED-ENTITY gate (hard): the candidate must share a named person/entity with this story — precise, kills
//      topically-vague matches.
//   2) SEMANTIC rank (embeddings): among shared-entity candidates, rank by cosine of the title/dek embedding.
//   3) CONTRADICTION FIREWALL (fail-CLOSED): a cheap LLM checks that linking the two does NOT create a misleading
//      or contradictory narrative — the owner's "Selena married -> husband died" guard. Any doubt/error => DROP
//      the link. We would rather under-link than publish a false juxtaposition.
// Never links to itself, never invents a slug (candidates come from the real content index), never a death/obituary
// piece under a light-hearted story about the same person unless the firewall clears it.
import { embed as defaultEmbed, cosine } from "./embed.mjs";
import { titleNames } from "./linkIndex.mjs";
import { chat } from "../lib/openrouter.mjs";

const shareEntity = (a, b) => a.some((e) => b.includes(e));

const FIREWALL_SYS = "You are a careful editor deciding whether to place an internal link from a NEW gossip story to an EXISTING published article. Output strict JSON only.";

// Fail-CLOSED contradiction firewall. safe=true ONLY if the link is clearly related AND not misleading.
async function defaultFirewall(current, candidate, model) {
  const user = `NEW story:  title: "${current.title}"  | claim: "${current.claim || ""}"  | date: ${current.date || "?"}
EXISTING article to maybe link:  title: "${candidate.title}"  | claim/summary: "${candidate.claim || ""}"  | date: ${candidate.date || "?"}

Would linking the NEW story to the EXISTING article MISLEAD a reader or create a CONTRADICTORY/false narrative? Examples of UNSAFE: one says a person is alive/together/married NOW while the other implies they died or split; the two describe states that cannot both be currently true; the link would imply a false relationship between facts. SAFE only if they are clearly about the same subject AND consistent/complementary (e.g. background, an earlier chapter of the same ongoing story).
Return STRICT JSON: { "safe": true|false, "reason": "one short clause" }`;
  try {
    const { data } = await chat({ model, system: FIREWALL_SYS, user, json: true, maxTokens: 150, temperature: 0 });
    return { safe: data?.safe === true, reason: String(data?.reason || "") };
  } catch {
    return { safe: false, reason: "firewall error — fail closed" };
  }
}

// findRelatedLinks — returns up to `max` safe internal links [{ slug, title, url, score }].
export async function findRelatedLinks({
  article, topic, index, embedImpl = defaultEmbed, firewallImpl = defaultFirewall,
  model = "google/gemini-2.5-flash-lite", max = 3, selfSlug = null, minScore = 0.45,
} = {}) {
  const entities = [
    topic?.primaryEntity,
    ...((article?.about || []).map((a) => a?.name)),
    ...titleNames(article?.title),
  ].filter(Boolean);
  if (!entities.length || !Array.isArray(index) || !index.length) return [];

  const qtext = [article?.title, article?.dek, entities.join(", ")].filter(Boolean).join(". ");
  const qv = await embedImpl(qtext);

  const ranked = index
    .filter((r) => r.slug && r.slug !== selfSlug && Array.isArray(r.embedding))
    .filter((r) => shareEntity(entities, r.entities || []))          // (1) shared-entity gate — hard
    .map((r) => ({ r, score: cosine(qv, Float32Array.from(r.embedding)) })) // (2) semantic rank
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(max * 2, 6));

  const out = [];
  for (const { r, score } of ranked) {
    if (out.length >= max) break;
    let verdict;
    try {
      verdict = await firewallImpl(                                  // (3) contradiction firewall — fail-closed
        { title: article?.title, claim: topic?.claim, date: article?.date },
        { title: r.title, claim: r.claim, date: r.date },
        model
      );
    } catch { verdict = { safe: false, reason: "firewall error — fail closed" }; }
    if (verdict?.safe === true) out.push({ slug: r.slug, title: r.title, url: r.url, score: Number(score.toFixed(3)) });
  }
  return out;
}
