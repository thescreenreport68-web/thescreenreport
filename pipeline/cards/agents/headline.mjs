// HEADLINE SMITH — the on-card hook (≤12 words) + red payload span + detail sub-line,
// written ONLY from the fact pack (faithful-writer doctrine: the writer never adds a
// fact the pack doesn't carry). Quote cards pass the verbatim quote through untouched.
import { CARDS } from "../config.mjs";
import { llm } from "../models.mjs";

const SYS = `You write the text ON a square news image card for The Screen Report. Return STRICT JSON:
{"headline":string,"redSpan":string,"sub":string}
RULES:
- headline: ≤12 words, punchy, 100% supported by the FACTS below — never invent, never exaggerate, no clickbait withholding ("you won't believe"), no ALL-CAPS words (the renderer uppercases), film/show titles in ‘single quotes’.
- redSpan: the single most gasp-worthy payload inside the headline, copied EXACTLY (a number, a date, a name — 1-3 words). Empty string if nothing stands out.
- sub: ONE sentence, ≤120 characters, a DIFFERENT supporting fact from the pack (not a rewording of the headline), plain sentence case.
- NEVER credit or name a news outlet or photo source on the card ("via Variety", "Photo:", "according to Deadline", "courtesy of") — the card states the news itself. (An outlet may appear ONLY when it IS the story's subject, e.g. a Rotten Tomatoes score.)
- somber stories (deaths/tragedy): headline is respectful and plain ("[Name], [known-for], dies at [age]"), redSpan MUST be "", sub is a career note — zero sensationalism.`;

export async function writeHeadline(story, pack, cls) {
  if (cls.category === "quote" && pack.quotes.length) {
    // quote mode: the card text IS the verbatim quote — no rewriting allowed
    const q = [...pack.quotes].sort((a, b) => a.text.length - b.text.length).find((x) => x.text.split(/\s+/).length <= 16) || pack.quotes[0];
    const words = q.text.split(/\s+/);
    const text = words.length > 16 ? null : q.text; // too long to render verbatim → let the LLM write a normal headline instead
    if (text) {
      return { headline: `“${text}”`, redSpan: "", sub: `— ${q.speaker}${pack.storyOneLine ? `, ${pack.storyOneLine.slice(0, 80)}` : ""}`, quote: q };
    }
  }
  // two attempts with FEEDBACK — a blind retry re-fails identically (live drop 2026-07-16:
  // multi-name casting stories overflow 12 words twice). Attempt 2 says exactly what was
  // wrong and relaxes the cap to 14 (renderer auto-shrink handles 14 comfortably).
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const cap = attempt === 0 ? CARDS.headline.maxWords : CARDS.headline.maxWords + 2;
    const out = await llm({
      role: "writer", system: SYS, temperature: 0.4, maxTokens: 400,
      user: `STORY: ${story.title}\nANGLE: ${story.angle || ""}\nCATEGORY: ${cls.category}${cls.somber ? " (SOMBER)" : ""}\nFACTS:\n${pack.facts.map((f) => `- ${f.claim}`).join("\n")}\nNUMBERS: ${(pack.numbers || []).join(" | ")}${feedback}`,
    });
    let { headline = "", redSpan = "", sub = "" } = out || {};
    headline = String(headline).replace(/\s+/g, " ").trim();
    sub = String(sub).replace(/\s+/g, " ").trim();
    redSpan = String(redSpan).replace(/\s+/g, " ").trim();
    const words = headline ? headline.split(/\s+/).length : 0;
    if (!headline || words > cap) {
      feedback = `\n\nREJECTED: your previous headline had ${words || 0} words — the HARD CAP is ${CARDS.headline.maxWords + 2}. Cut names or use a shorter reference (e.g. one lead name + "and more"); keep only the payload.`;
      continue;
    }
    // owner hard rule 2026-07-17: no source credits anywhere on the card
    if (/\b(via |photo:|photo courtesy|courtesy of|credit:|according to)\b/i.test(`${headline} ${sub}`)) {
      feedback = `\n\nREJECTED: your previous text credited a source ("via …"/"Photo:"/"according to"). State the news directly — never name the reporting outlet on the card.`;
      continue;
    }
    if (redSpan && !headline.includes(redSpan)) redSpan = ""; // span must be verbatim inside the headline
    if (cls.somber) redSpan = "";
    if (sub.length > 130) sub = sub.slice(0, 127).replace(/\s+\S*$/, "") + "…";
    return { headline, redSpan, sub, quote: null };
  }
  return null;
}
