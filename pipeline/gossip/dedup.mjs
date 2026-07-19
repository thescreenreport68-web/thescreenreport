// GOSSIP — DEDUP GATE (Step 2). Never republish a story — even REWORDED. Runs at the FRONT of the per-topic
// flow so duplicates exit before any content-finding / writing spend. Three layers on the Step-1 store:
//   L1 EXACT     — SHA-256(canonical URL + normalized headline). Same article = instant block.
//   L2 EVENT-KEY — entity | gossip-type | month-bucket (stored for grouping; the entity-scoped L3 search below
//                  effectively enforces it for the decision).
//   L3 SEMANTIC  — cosine of the event summary vs the SAME-ENTITY, recent (≤window-day) published records:
//                  ≥0.90 ⇒ DUPLICATE · 0.82–0.90 ⇒ ONE cheap-LLM adjudication (DUPLICATE|UPDATE|DISTINCT) ·
//                  <0.82 ⇒ NEW. A genuine new development on a known story returns UPDATE (publishes, linked).
// FAIL-CLOSED: any store/embed/adjudicator error ⇒ HOLD (never risk a reworded republish).
import crypto from "node:crypto";
import { embed as defaultEmbed } from "./embed.mjs";
import { detectGossipType } from "./writer.mjs";
import { agentChat } from "./models.mjs";

const DUP_HARD = 0.9, DUP_SOFT = 0.82, WINDOW_DAYS = 45;
import { slugify as slug } from "./normalize.mjs"; // folded: Hernández and Hernandez share ONE dedup bucket

export const normHeadline = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
export function canonicalUrl(u) {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname).toLowerCase().replace(/\/+$/, ""); }
  catch { return (u || "").toLowerCase(); }
}
export function urlHash(topic) {
  const u = topic.sources?.[0]?.url || "";
  return crypto.createHash("sha256").update(canonicalUrl(u) + "|" + normHeadline(topic.title)).digest("hex").slice(0, 32);
}
export function eventKey(topic, now = new Date()) {
  return `${slug(topic.primaryEntity)}|${detectGossipType(topic)}|${now.toISOString().slice(0, 7)}`;
}
const summaryText = (topic) => `${topic.primaryEntity || ""}: ${topic.claim || topic.title || ""}`;

// Cheap adjudicator for the 0.82–0.90 gray band: same event, a genuine update, or distinct?
async function defaultAdjudicate(aSummary, bSummary) {
  const { data } = await agentChat("dedup", {
    system: "You compare two short celebrity-gossip story summaries. Output strict JSON only.",
    user: `A (already published): ${aSummary}\nB (new candidate): ${bSummary}\n\nDo A and B describe the SAME underlying real-world EVENT/occasion (same happening, same day/setting), or a genuinely DIFFERENT event?\n- DUPLICATE: same event as A — even if B is reworded, comes from a different outlet, adds a new DETAIL, quote, or ANGLE, or emphasizes a different aspect. A new detail about the same occasion is STILL the same story; publishing it again is a re-post.\n- UPDATE: a genuinely NEW development that HAPPENED after A (the situation materially changed — e.g. A said "dating", B says "engaged"; A said "hospitalized", B says "released"). Not just a new fact about the same moment.\n- DISTINCT: a clearly different event/occasion.\nWhen unsure between DUPLICATE and UPDATE, choose DUPLICATE. Return {"verdict":"DUPLICATE"|"UPDATE"|"DISTINCT","newFact":"the new development if UPDATE, else empty"}.`,
    json: true, maxTokens: 200, temperature: 0,
  });
  return data || { verdict: "DUPLICATE", newFact: "" };
}

export async function dedupCheck(topic, store, { embedImpl = defaultEmbed, adjudicateImpl = defaultAdjudicate, now = new Date() } = {}) {
  try {
    const uh = urlHash(topic), ek = eventKey(topic, now);
    // L1 — exact
    if (store.byUrlHash(uh)) return { decision: "DUPLICATE", reason: "exact url+headline match", urlHash: uh, eventKey: ek, embedding: null };
    // L2 — SAME eventKey (entity|gossipType|month): the strongest "same story" signal short of an identical URL —
    // it catches near-duplicates whose short summaries embed BELOW the semantic threshold (two outlets covering the
    // same event with different wording, e.g. two "Kathy Griffin banned from the Tonight Show" pieces). Adjudicate
    // (the cheap LLM decides duplicate / genuine update / distinct). Only fires on an actual collision, so no cost
    // in the common case.
    // 2026-07-19 FIX: adjudicate against EVERY record in the bucket, NEWEST FIRST — not just ekHits[0].
    // The Jelly Roll duplicate shipped because the bucket held three records and [0] was a week-old
    // "inside their world" piece: the adjudicator correctly said DISTINCT against that wrong comparison,
    // and the real prior (4h earlier, same divorce) was never examined at all.
    const ekHits = ((store.byEventKey ? store.byEventKey(ek) : []) || [])
      .slice()
      .sort((a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0))
      .slice(0, 5); // newest 5 — caps adjudication spend on a busy entity
    for (const prior of ekHits) {
      const adj = await adjudicateImpl(prior.summary, summaryText(topic));
      if (adj.verdict === "DUPLICATE") return { decision: "DUPLICATE", reason: "same-event dup (eventKey)", parentKey: prior.key, urlHash: uh, eventKey: ek, embedding: null };
      if (adj.verdict === "UPDATE") return { decision: "UPDATE", reason: (`update: ${adj.newFact || "new development"}`).slice(0, 120), parentKey: prior.key, urlHash: uh, eventKey: ek, embedding: null };
      // DISTINCT vs THIS record → keep checking the rest of the bucket before concluding the story is new.
    }
    // L3 — semantic vs same-entity recent records
    const vec = await embedImpl(summaryText(topic));
    const top = store.search(vec, { k: 3, sinceDays: WINDOW_DAYS, entity: topic.primaryEntity })[0];
    if (top) {
      if (top.score >= DUP_HARD) return { decision: "DUPLICATE", reason: `semantic dup (${top.score.toFixed(3)})`, parentKey: top.key, urlHash: uh, eventKey: ek, embedding: Array.from(vec) };
      if (top.score >= DUP_SOFT) {
        const adj = await adjudicateImpl(top.summary, summaryText(topic));
        if (adj.verdict === "DUPLICATE") return { decision: "DUPLICATE", reason: `adjudicated dup (${top.score.toFixed(3)})`, parentKey: top.key, urlHash: uh, eventKey: ek, embedding: Array.from(vec) };
        if (adj.verdict === "UPDATE") return { decision: "UPDATE", reason: (`update: ${adj.newFact || "new development"}`).slice(0, 120), parentKey: top.key, urlHash: uh, eventKey: ek, embedding: Array.from(vec) };
      }
    }
    return { decision: "NEW", reason: "distinct story", urlHash: uh, eventKey: ek, embedding: Array.from(vec) };
  } catch (e) {
    return { decision: "HOLD", reason: "dedup error (fail-closed): " + String(e?.message || e).slice(0, 80) };
  }
}

// After a story publishes, record it so future runs dedup against it.
export function recordPublished(topic, store, { urlHash, eventKey, embedding, slug: articleSlug, parentKey = null, now = new Date() } = {}) {
  store.upsert({
    key: articleSlug || topic.slug || urlHash,
    kind: "gossip",
    urlHash, eventKey,
    entities: [topic.primaryEntity].filter(Boolean),
    summary: summaryText(topic),
    embedding,
    meta: { title: topic.title, parentKey },
    createdAt: now.toISOString(),
  });
}
