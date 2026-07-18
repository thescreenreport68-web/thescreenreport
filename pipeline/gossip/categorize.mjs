// GOSSIP — CATEGORIZE & ROUTE (Stage 2). One cheap-LLM pass over the candidates: is it an in-scope gossip
// story (Hollywood celeb / Western musician)? extract the entity, the central CLAIM, the subjectType, the
// confirmation flags (confirmed/official/denied), and the angle → a gossip topic the orchestrator can run.
// classifyImpl is injectable so the harness runs offline with a deterministic mock.
import { agentChat } from "./models.mjs";
import { tierOf } from "./policy.mjs";

const SYSTEM = `You triage candidates for The Screen Report's GOSSIP desk. Keep ONLY genuine celebrity GOSSIP about Western/English-language ENTERTAINMENT figures — Hollywood actors/actresses, Western/English-language musicians, AND reality-TV / streaming-show / social-media personalities (e.g. the "Secret Lives of Mormon Wives"/MomTok, Bravo, "Love Island", major influencers) — their PERSONAL lives, RELATIONSHIPS, DRAMA, and the RUMORS/SPECULATION about them.
IN SCOPE: dating/romance rumors, breakups/splits, feuds/shade, "fans are speculating", cryptic-post sleuthing, pregnancy/relationship speculation, "a source says", personal controversy/backlash, unconfirmed reports about a star's private life.
SCOPE — our niche is ENTERTAINMENT celebrities: film/TV actors, Western musicians, reality-TV / streaming stars INCLUDING the Kardashian–Jenner family and supermodels who are TV/media personalities (Kardashians, Jenners, Hadids), comedians, directors, TV hosts, and entertainment influencers. Keep a story if an in-niche entertainment celebrity is a MEANINGFUL SUBJECT of it (lead or a key named figure) — even paired with a non-niche person (e.g. "Lewis Hamilton on his girlfriend KIM KARDASHIAN" is IN, because Kim K is a key subject; "Taylor Swift's wedding" with Travis Kelce is IN).
- Set inScope=false ONLY for a STANDALONE story about a NON-ENTERTAINMENT figure with NO in-niche celebrity involved: an ATHLETE of any sport (incl. an F1/race-car driver) in a sport/personal story with no celebrity, a POLITICIAN (a senator's health), a ROYAL (a prince's appearance), a business CEO's deal, or a non-niche person with only an UNNAMED companion (e.g. "Alex Rodriguez kisses a mystery woman" = OUT).
- PRODUCT/RESULTS NEWS (handled by another desk): film/TV/music announcements, RELEASE DATES, first-look images, TRAILERS, casting confirmations, box office, chart positions; AWARD WINNERS / RESULTS / nominations / ceremony recaps.
- non-Western / non-English-language figures, politics, sports, corporate news.
subjectType RULE (drives which category it files under — get this right):
- "musician" = ONLY a genuine recording artist / singer / rapper / band. NEVER label a reality star, influencer, actor, or host "musician".
- "reality" = a reality-TV / streaming-show / social-media personality, influencer, or TV host (files under Celebrity).
- "actor" = a film/TV actor or actress (files under Celebrity).
- "awards" = an awards-RACE rumor/speculation (who might win/be snubbed).
- When unsure between actor and reality, use "reality" (it still files under Celebrity). Only "musician" routes to Music, so use it precisely.
THE TEST: is it about a STAR'S PERSONAL LIFE / a rumor / interpersonal drama (IN), or a CONFIRMED PRODUCT or RESULT (OUT)? When unsure → OUT.
CONFIRMED flag (a light hint — a later editorial gate re-decides this from the full article text, so just be reasonable): set confirmed=true only when the central newsworthy fact is genuinely ESTABLISHED — officially announced, on a court/police record, the person's own on-record words, or reported as an accomplished fact by a named news outlet (a donation made, a marriage/birth announced, a death, a casting/signing confirmed). Set confirmed=false for a RUMOR or unverified item ("a source says", "fans speculate", a dating/pregnancy rumor, an anonymous tip) AND for a trivial sighting/reaction/outfit post where nothing is really "confirmed" (spotted, wore, reacted, stepped out). When unsure, confirmed=false.
Output strict JSON only.`;

function buildPrompt(items) {
  return `Candidates:\n${items.map((it, i) => `[${i}] (${it.outlet}) ${it.title}${it.summary ? " — " + it.summary.slice(0, 200) : ""}`).join("\n")}

Return JSON:
{"results":[{"i":<index>,"inScope":<bool>,"primaryEntity":"<the main person>","subjectType":"actor|musician|reality|awards","claim":"<the central rumor/claim in one sentence>","confirmed":<bool: officially confirmed / on the record>,"official":<bool: from a court/police record>,"denied":<bool: the subject/rep has denied it>,"angle":"<the hook>","reason":"<why in/out of scope>"}]}
Set inScope=false for anything out of scope. REMEMBER: a confirmed announcement, release date, trailer, first-look, or an awards winners/results list is NOT gossip → inScope=false. Only a star's personal-life rumor / speculation / interpersonal drama is inScope=true.`;
}

async function defaultClassify(items) {
  try {
    const { data } = await agentChat("scout", { system: SYSTEM, user: buildPrompt(items), json: true });
    return data?.results || [];
  } catch (e) {
    console.error("  ⚠ categorize LLM error (skipping batch):", String(e?.message || e).slice(0, 100));
    return [];
  }
}

import { slugify } from "./normalize.mjs";

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
        // Phase 1 — demand signals carried through the seam (the ranker scores on these; they were computed
        // by discovery and previously discarded right here).
        engagement: c.engagement ?? null,
        ageMin: c.ageMin ?? null,
        viaTrending: !!c.viaTrending,
        sources: [{ outlet: c.outlet, url: c.url, tier: c.tier ?? tierOf(c.outlet) }],
      });
    }
  }
  return topics;
}
