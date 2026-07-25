// expand.mjs — FINISH A NEAR-MISS DRAFT (owner-approved structural fix, 2026-07-25).
//
// ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────────────────────────────
// The writer will not hold a length. On the SAME story with the SAME material, consecutive runs
// produced 516 / 528 / 542 / 569 / 707 / 766 words. Eight prompt variations moved that number
// unpredictably in BOTH directions, so prompt tuning is not the answer — it is guessing.
//
// Every recent hold was length ALONE: accuracy, structure, headings, quotes and padding all passed,
// and the draft was thrown away for being ~50 words short. That is the waste this removes. Instead of
// re-rolling the whole article and hoping for a better number, we keep the good draft and make ONE
// cheap, targeted call that ADDS a section built from material the draft left UNUSED.
//
// ── WHY IT CANNOT DEGRADE QUALITY ────────────────────────────────────────────────────────────────
//   • ADD-ONLY. The existing text is never rewritten. A rewrite is how NEW fabrications appeared in
//     earlier attempts (the Madonna case: attempt 2 invented a different altered quote). Nothing that
//     already passed the fidelity guards can be changed by this pass.
//   • SAME FACTS. It receives exactly the reference facts the writer had — never the open web.
//   • SAME GUARDS AFTER. The merged article goes back through the full gate: fidelity, padding,
//     readability, structure. If the addition is padding, the whole thing is still rejected.
//   • IT MAY DECLINE. If the facts genuinely hold nothing more, it returns nothing and the article is
//     held as before. Reaching the floor is never worth inventing for.
import { chat } from "../lib/openrouter.mjs";
import { MODELS } from "../config.mjs";

// Only rescue a draft that is genuinely CLOSE. Below this the story lacks material and padding it to
// the floor is exactly the failure mode the whole quality floor exists to prevent.
export const MIN_RESCUABLE = Number(process.env.EXPAND_MIN_WORDS ?? 380);

const SYS = `You are a senior news editor finishing a colleague's draft. The draft is accurate and well written but
too short: it left verified material unused. Your ONLY job is to write ONE additional section that covers ground the
draft has not covered, using ONLY the reference facts supplied.

ABSOLUTE RULES:
- ADD ONLY. Never rewrite, re-order, summarise or "improve" the existing text. You are appending.
- ONLY the supplied facts. No memory, no background, no "well-known" detail. Every name, date, number, title and
  quote must appear in the facts. An independent verifier re-checks every claim and cuts what it cannot find.
- NO PADDING. Do not restate what the draft already says in fresh words; do not write "it remains to be seen",
  "only time will tell", "stay tuned"; do not describe what you cannot confirm. Padding is detected and the whole
  article is rejected — a shorter honest piece is better than a padded one.
- If the facts hold nothing the draft has not already used, return an EMPTY body. Declining is a correct answer.
- Match the draft's voice: 2-3 sentence paragraphs, varied sentence length, no sentence over 35 words.
- The heading must NAME SOMETHING SPECIFIC from the story (a person, a film, a number, a decision) — never
  scaffolding like "What Are the Key Details?", "What We Know So Far", "More Information".`;

// Returns { markdown, heading, words } — or null when nothing more is honestly available.
export async function expandArticle({ article, topic, facts, targetWords, model = MODELS.generator, maxTokens = 1400 }) {
  const body = String(article?.body || "");
  if (!body) return null;
  const existingHeadings = (body.match(/^##\s+(.+)$/gm) || []).map((h) => h.replace(/^##\s+/, "").trim());
  const have = body.split(/\s+/).filter(Boolean).length;
  const need = Math.max(80, (targetWords || 0) - have + 60);   // +60 so the fidelity trim cannot re-open the gap

  const user = `The draft below is ${have} words and must reach ${targetWords}. Write ONE new section of roughly ${need} words
that covers something the draft has NOT covered, drawn only from the REFERENCE FACTS.

SECTIONS THE DRAFT ALREADY HAS (do not repeat these angles):
${existingHeadings.length ? existingHeadings.map((h) => `- ${h}`).join("\n") : "- (none)"}

THE DRAFT:
${body}

REFERENCE FACTS — the ONLY permitted source for every claim:
${(facts || []).map((f) => `### ${f.title}\n${String(f.extract || "").slice(0, 4000)}`).join("\n\n").slice(0, 20000)}

Return JSON: {"heading": "the H2 text, naming something specific from this story", "body": "the section's markdown paragraphs (no heading line)"}
Return {"heading": "", "body": ""} if the facts genuinely support nothing further.`;

  let data;
  try {
    ({ data } = await chat({ model, system: SYS, user, json: true, maxTokens, temperature: 0.2 }));
  } catch { return null; }

  const heading = String(data?.heading || "").trim().replace(/^#+\s*/, "");
  const section = String(data?.body || "").trim();
  if (!heading || !section) return null;
  const words = section.split(/\s+/).filter(Boolean).length;
  if (words < 40) return null;                       // too small to be worth the risk of appending

  return { heading, markdown: `\n\n## ${heading}\n\n${section}\n`, words };
}
