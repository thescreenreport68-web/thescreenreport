// FACT GATE — the universal verify gate for card text (verification-is-the-core-mandate):
// every string that ships (headline, sub, IG caption, FB caption) must be ENTAILED by the
// fact pack; quotes must match a pack quote verbatim with the same speaker; the category
// tab must agree with the facts (a wrong tab = a held card, owner rule 2026-07-16).
import { llm } from "../models.mjs";

const SYS = `You are a strict fact gate for a news image card. Compare the CARD TEXT against the VERIFIED FACT PACK. Return STRICT JSON:
{"verdict":"pass"|"fail","problems":[string]}
FAIL if ANY of: a card claim is not literally supported by the pack (names, numbers, dates, platforms, superlatives all count); a quotation on the card does not appear VERBATIM in the pack's quotes with the same speaker; the category tab misstates the story (especially: "BOX OFFICE" on a story about presales/tracking/tickets for an unreleased film — box office means money already earned); the tone is sensational on a death/tragedy story. Minor rephrasing of a supported fact is fine; added specifics are not.`;

export async function factGate({ card, captions, cls, pack }) {
  if (!pack?.facts?.length) return { verdict: "fail", problems: ["empty fact pack — nothing to verify against"] }; // deterministic, before any model call (review #24)
  const out = await llm({
    role: "verify", system: SYS, temperature: 0, maxTokens: 500,
    user: `CATEGORY TAB: ${cls.category.toUpperCase()}${cls.somber ? " (somber)" : ""}
CARD HEADLINE: ${card.headline}
CARD SUB: ${card.sub}
IG CAPTION: ${captions.ig}
FB CAPTION: ${captions.fb}

VERIFIED FACT PACK:
FACTS:\n${pack.facts.map((f) => `- ${f.claim}`).join("\n")}
QUOTES:\n${pack.quotes.map((q) => `- "${q.text}" — ${q.speaker}`).join("\n") || "(none)"}
NUMBERS: ${(pack.numbers || []).join(" | ") || "(none)"}
RELEASED: ${pack.released}`,
  });
  const verdict = out?.verdict === "pass" ? "pass" : "fail";
  // deterministic double-check on quotes — the one failure class we never trust a model on.
  // Covers CAPTIONS too, not just the card face (audit D5).
  const surfaces = `${card.headline} ${card.sub} ${captions?.ig || ""} ${captions?.fb || ""}`;
  const norm = (s) => s.replace(/\s+/g, " ").replace(/[“”]/g, '"').trim().toLowerCase();
  for (const m of surfaces.matchAll(/[“"]([^”"]{8,})[”"]/g)) {
    const hit = pack.quotes.some((q) => norm(q.text).includes(norm(m[1])) || norm(m[1]).includes(norm(q.text)));
    if (!hit) return { verdict: "fail", problems: [...(out?.problems || []), `quotation not found verbatim in the fact pack: "${m[1].slice(0, 60)}"`] };
  }
  return { verdict, problems: out?.problems || [] };
}
