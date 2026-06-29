// GOSSIP — CATEGORIZE & ROUTE (Stage 2). One cheap-LLM pass over the candidates: is it an in-scope gossip
// story (Hollywood celeb / Western musician)? extract the entity, the central CLAIM, the subjectType, the
// confirmation flags (confirmed/official/denied), and the angle → a gossip topic the orchestrator can run.
// classifyImpl is injectable so the harness runs offline with a deterministic mock.
import { chat } from "../lib/openrouter.mjs";
import { tierOf } from "./policy.mjs";

const SYSTEM = `You triage candidates for The Screen Report's GOSSIP desk. Keep ONLY genuine celebrity GOSSIP about Hollywood actors/actresses and Western/English-language musicians — their PERSONAL lives, RELATIONSHIPS, DRAMA, and the RUMORS/SPECULATION about them.
IN SCOPE: dating/romance rumors, breakups/splits, feuds/shade, "fans are speculating", cryptic-post sleuthing, pregnancy/relationship speculation, "a source says", personal controversy/backlash, unconfirmed reports about a star's private life.
OUT OF SCOPE (set inScope=false — this is PRODUCT/RESULTS NEWS, handled by another desk, NOT gossip):
- film/TV/music announcements, RELEASE DATES, first-look images, TRAILERS, casting confirmations, box office, chart positions;
- AWARD WINNERS / RESULTS / nominations lists / ceremony recaps;
- non-Hollywood / non-Western-music figures, politics, sports, corporate news.
THE TEST: is it about a STAR'S PERSONAL LIFE / a rumor / interpersonal drama (IN), or a CONFIRMED PRODUCT or RESULT (OUT)? When unsure → OUT.
Output strict JSON only.`;

function buildPrompt(items) {
  return `Candidates:\n${items.map((it, i) => `[${i}] (${it.outlet}) ${it.title}${it.summary ? " — " + it.summary.slice(0, 200) : ""}`).join("\n")}

Return JSON:
{"results":[{"i":<index>,"inScope":<bool>,"primaryEntity":"<the main person>","subjectType":"actor|musician|awards","claim":"<the central rumor/claim in one sentence>","confirmed":<bool: officially confirmed / on the record>,"official":<bool: from a court/police record>,"denied":<bool: the subject/rep has denied it>,"angle":"<the hook>","reason":"<why in/out of scope>"}]}
Set inScope=false for anything out of scope. REMEMBER: a confirmed announcement, release date, trailer, first-look, or an awards winners/results list is NOT gossip → inScope=false. Only a star's personal-life rumor / speculation / interpersonal drama is inScope=true.`;
}

async function defaultClassify(items) {
  try {
    const { data } = await chat({ model: "google/gemini-2.5-flash-lite", system: SYSTEM, user: buildPrompt(items), json: true, maxTokens: 4000, temperature: 0.1 });
    return data?.results || [];
  } catch (e) {
    console.error("  ⚠ categorize LLM error (skipping batch):", String(e?.message || e).slice(0, 100));
    return [];
  }
}

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

export async function categorizeGossip(candidates, { classifyImpl = defaultClassify, batchSize = 6 } = {}) {
  if (!candidates.length) return [];
  const topics = [];
  // Small batches → each LLM JSON response stays tiny + valid; a bad batch is skipped, not fatal.
  for (let off = 0; off < candidates.length; off += batchSize) {
    const batch = candidates.slice(off, off + batchSize);
    const results = await classifyImpl(batch); // results[].i is the index WITHIN this batch
    for (const r of results || []) {
      if (!r || !r.inScope) continue;
      const c = batch[r.i];
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
  }
  return topics;
}
