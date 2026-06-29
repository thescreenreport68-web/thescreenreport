// GOSSIP — WRITER (Stage 5). Builds the article from the VERIFIED bundle + the frame's directive, in an
// aggressive-but-attributed voice, ALWAYS embedding the mandatory in-text non-confirmation disclaimer.
// buildGossipPrompt() is a PURE function so the harness can verify the writer is INSTRUCTED correctly without
// spending an LLM call; writeGossip() does the live generation.
import { chat } from "../lib/openrouter.mjs";

const SYSTEM = `You are a sharp, fast celebrity-gossip writer for The Screen Report — Page Six / TMZ energy: punchy, fun, curiosity-driven. NON-NEGOTIABLE rules:
- Write ONLY from the VERIFIED BUNDLE you are given. Never add a fact, quote, name, number, date, or detail that is not in the bundle.
- Every factual claim about a person must be ATTRIBUTED to a named source ("according to [Outlet]") or framed as opinion/speculation ("fans are speculating…") — NEVER asserted as your own fact.
- Follow the FRAMING DIRECTIVE exactly, and include the mandatory non-confirmation sentence VERBATIM where required.
- Never describe or link intimate/leaked media; never state a damaging claim about a private person or a minor.
Output STRICT JSON only.`;

export function buildGossipPrompt(bundle, frame, topic) {
  const sourceBlock = (bundle.sources || [])
    .map((s, i) => `[S${i + 1}] ${s.outlet}${s.url ? ` (${s.url})` : ""} — tier ${s.tier}\n${(s.text || "").slice(0, 2500)}`)
    .join("\n\n");
  const quoteBlock = (bundle.quotes || []).map((q) => `• "${q}"`).join("\n") || "(no verbatim quotes available — paraphrase only, invent nothing)";

  const user = `TOPIC: ${topic.title || ""}
ABOUT: ${topic.primaryEntity || bundle.entity || ""}

THE VERIFIED BUNDLE — the ONLY facts and quotes you may use:
${sourceBlock || "(no source text)"}

VERBATIM QUOTES you may use (copy exactly; do not alter; attribute them):
${quoteBlock}

FRAMING DIRECTIVE (follow exactly):
${frame.writerDirective}
${frame.needsDisclaimer ? `\nMANDATORY — include this exact sentence, as its own sentence in the body:\n"${frame.disclaimerText}"` : ""}

VOICE & STRUCTURE:
- Headline: a curiosity hook, present tense. NEVER state an unconfirmed damaging claim as fact in the headline — frame the question/reaction.
- 250–450 words. Structure: (1) the hook, framed as report/question; (2) what sparked it (the trigger, attributed); (3) what we know vs. what's unconfirmed; (4) brief context / why it matters; (5) the denial / other side if any.
- Attribute every claim. Conversational, lively, but disciplined.

Return STRICT JSON:
{ "title": "...", "dek": "one-line standfirst",
  "body": "markdown article (250–450 words) INCLUDING the mandatory non-confirmation sentence verbatim if required",
  "keyTakeaways": ["3 short bullets"],
  "faq": [{"q":"...","a":"..."}],
  "claims": [{"text":"each checkable claim","sourceQuote":"the verbatim bundle text that supports it"}],
  "whatWeKnow": ["confirmed/attributed points"],
  "whatWeDont": ["the open questions"],
  "denial": "the subject/rep denial if any, else null",
  "statusLabel": "${frame.uiLabel}" }`;
  return { system: SYSTEM, user };
}

export async function writeGossip({ bundle, frame, topic, model = "deepseek/deepseek-v3.2" }) {
  const { system, user } = buildGossipPrompt(bundle, frame, topic);
  const { data } = await chat({ model, system, user, json: true, maxTokens: 1800, temperature: 0.6 });
  return data;
}
