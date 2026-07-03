// MAJOR-EVENT INSIDE-STORIES EXPANSION (FIND_HALF_PLAN PENDING SUB-SYSTEM #1).
// A Tier-S life event (death/marriage/divorce/arrest/scandal/birth) generates HUGE search + engagement
// demand, so one "what happened" report isn't enough — outlets blanket it with many distinct angles
// (career retrospective, tributes from peers, most memorable roles, the relationship timeline, …).
// This proposes those angles as ready MAKE topic objects. Each still flows through the EXISTING grounding
// + ≥80 gate, so a thinly-sourced angle is rejected, never fabricated. TONE-SAFE: for a death/tragedy the
// angles are respectful (retrospective/tribute/legacy), never frivolous.
import { chat } from "../lib/openrouter.mjs";
import { MODELS } from "../config.mjs";

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

// Only these high-magnitude events warrant multi-angle expansion.
export const TIER_S = new Set(["death", "marriage", "divorce", "breakup", "arrest", "scandal", "lawsuit", "birth", "pregnancy"]);

const SYS = `You are the lead editor of The Screen Report planning blanket coverage of a MAJOR celebrity event. Given the event + the central person, propose distinct, legitimate, search-worthy ANGLES that each become their OWN article (the way People/THR/E! blanket a major event with a dozen pieces). RULES:
- Each angle must be GROUNDABLE from the person's public record (Wikipedia/filmography) + the confirmed event facts — NO fabricated quotes, fake "hometown reactions", or invented private details.
- TONE must match the event: a DEATH/illness/arrest/lawsuit → respectful, factual angles (career retrospective, most memorable roles, legacy & impact, tributes from confirmed peers, what we know). NEVER frivolous (no "net worth", "sports cars", gossip) on a tragedy.
- A celebration (marriage/birth) → relationship timeline, career, the people involved.
- Angles must be genuinely DIFFERENT from each other (no near-duplicates). Output STRICT JSON only.`;

export async function expandInsideStories(topic, monitor, { model = MODELS.classifier, max = 6 } = {}) {
  if (!TIER_S.has(topic.eventType)) return [];
  // Only multiply a story we actually trust (don't blanket an unconfirmed/held event).
  const v = topic.verification;
  if (v && !v.publishable) return [];
  if (topic.eventType === "death" && v && v.status !== "CONFIRMED") return []; // deaths: confirmed only

  const user = `EVENT TYPE: ${topic.eventType} (sensitivity: ${topic.sensitivity || "normal"})
CENTRAL PERSON / ENTITY: ${topic.primaryEntity}
HEADLINE: ${topic.title}
KNOWN FACTS: ${(topic.sources || []).map((s) => s.headline + (s.summary ? " — " + s.summary : "")).join(" | ") || topic.angle || ""}

Propose up to ${max} DISTINCT article angles, each a NEWS report on the event (retrospective, tributes, what we know, the timeline — all written as news, never as a review/ranking/profile feature). Return JSON:
{"angles":[{"angle":"short angle name","title":"a working headline","focusEntity":"the exact entity this angle centers on (usually the person, or a clearly-related person/film)","note":"one line on what it covers + its source basis"}]}
Order by audience demand. Respect the TONE rule above.`;

  let data;
  try {
    ({ data } = await chat({ model, system: SYS, user, json: true, maxTokens: 1200, temperature: 0.4 }));
  } catch {
    return [];
  }
  const angles = (data?.angles || []).slice(0, max);
  const out = [];
  const seen = new Set();
  for (const a of angles) {
    if (!a.angle || !a.title) continue;
    const key = slugify(a.angle);
    if (seen.has(key)) continue;
    seen.add(key);
    // NEWS-ONLY: every inside-story angle is filed as a news report. The removed profile/list/ranking
    // forms belong to separate automations, so we never emit them here (this path bypasses categorize's
    // canonicalize, so the clamp must live inline). Inherit the parent's news-valid category silo.
    const ft = "news";
    const category = ["movies", "tv", "celebrity"].includes(topic.category) ? topic.category : "celebrity";
    const subcategory = "news";
    out.push({
      id: `${ft}-${slugify(topic.eventSlug || topic.primaryEntity)}-${key}`.slice(0, 80),
      slug: slugify(a.title),
      title: a.title,
      contentType: ft,
      formatTag: ft,
      category,
      subcategory,
      eventType: topic.eventType,
      sensitivity: topic.sensitivity || "normal",
      eventSlug: `${topic.eventSlug || slugify(topic.primaryEntity)}-${key}`,
      primaryKeyword: slugify(a.focusEntity || topic.primaryEntity).replace(/-/g, " "),
      primaryEntity: a.focusEntity || topic.primaryEntity,
      entities: [...new Set([topic.primaryEntity, ...(topic.entities || [])])].filter((e) => e !== (a.focusEntity || topic.primaryEntity)).slice(0, 4),
      angle: a.note || a.angle,
      tmdbType: "movie",
      // inherit the verified provenance so each angle publishes with the same trust + recheck coverage
      source: topic.source,
      sources: topic.sources || [],
      _parentEvent: topic.eventSlug || slugify(topic.primaryEntity),
      _insideStory: true,
    });
  }
  if (monitor) monitor.stage("expand", `Tier-S "${topic.eventType}" on ${topic.primaryEntity} → ${out.length} inside-angle articles`, out.map((t) => t.formatTag + ":" + t.angle).slice(0, 8));
  return out;
}
