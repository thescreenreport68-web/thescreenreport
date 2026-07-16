// CLASSIFIER — assigns the category tab. LLM proposes, HARD RULES dispose:
// the owner's 2026-07-16 correction is law here — BOX OFFICE means money already
// EARNED; presales/tracking/ticket-demand for an unreleased film are NEWS. Deaths and
// tragedies force IN MEMORIAM (somber mode) no matter what the model says.
import { CARDS } from "../config.mjs";
import { llm } from "../models.mjs";

const MEMORIAM_RE = /\b(dies|died|dead at \d+|passes away|passed away|death of|killed in|fatal)\b/i;
const EARNED_RE = /\b(grossed|grosses|box office (haul|total|gross)|opening weekend (of|hit|took)|\$[\d.,]+[MB]? (domestic|global|worldwide)|crossed \$|milestone|record (opening|weekend|debut))\b/i;
const PRESALE_RE = /\b(presale|pre-sale|advance (ticket|sales)|tracking (for|to)|projected|projection|forecast|tickets? (on sale|sold out|resale|scalp))\b/i;

const SYS = `You classify a Hollywood news story into ONE category for an image card. Return STRICT JSON: {"category":"news"|"first-look"|"box-office"|"streaming"|"tv"|"celebrity"|"awards"|"music"|"quote"|"memoriam","why":string}
DEFINITIONS: box-office = money ALREADY EARNED at the theatrical box office (grosses, records, milestones of released films) — NEVER presales, ticket demand, or tracking forecasts for unreleased films (those are news). first-look = trailers, posters, first footage, castings revealed. quote = the story IS what a named person said (a verbatim quote carries it). memoriam = a death or tragedy. celebrity = personal life (weddings, babies, couples, fashion moments). streaming/tv/awards/music per their obvious scopes. Otherwise news.`;

export async function classify(story, pack) {
  const out = await llm({
    role: "classify", system: SYS, temperature: 0, maxTokens: 300,
    user: `STORY: ${story.title}\nANGLE: ${story.angle || ""}\nHINT: ${story.hint || ""}\nFACTS:\n${pack.facts.map((f) => `- ${f.claim}`).join("\n")}\nQUOTES: ${pack.quotes.length}\nRELEASED: ${pack.released}`,
  });
  // "breaking" is an ESCALATION the sentinel grants, never a category the model may claim —
  // a model-assigned breaking tab would bypass the breaking budget (review #16)
  let category = out.category !== "breaking" && CARDS.categories[out.category] ? out.category : "news";
  const text = `${story.title} ${pack.facts.map((f) => f.claim).join(" ")}`;

  // ── hard rules override the model (cheap models drift; these cases are brand-critical)
  if (MEMORIAM_RE.test(text)) category = "memoriam";
  if (category === "box-office") {
    const earned = EARNED_RE.test(text);
    const presale = PRESALE_RE.test(text);
    // owner rule: unreleased or presale/tracking language → not box office
    if (pack.released === false || (presale && !earned)) category = "news";
  }
  if (category === "quote" && pack.quotes.length === 0) category = "news"; // quote card with no verbatim quote is a lie
  return { category, somber: CARDS.categories[category].somber, why: out.why || "" };
}
