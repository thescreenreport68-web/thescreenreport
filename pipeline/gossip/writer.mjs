// GOSSIP — WRITER (Stage 5). Builds the article from the VERIFIED bundle + the frame's directive, in a
// researched gossip voice, with a PER-TYPE template (a dating rumor reads nothing like a feud or a cryptic-post
// story), and ALWAYS the mandatory in-text non-confirmation disclaimer. buildGossipPrompt() is pure (testable
// without an LLM); writeGossip() does the live generation.
// Voice/craft sourced from how Page Six / TMZ / Pop Crave / People actually write (RUMOR_GOSSIP_AUTOMATION_PLAN
// PART 22): punchy + tight + active, curiosity hook, skimmable, a pull-quote, light gossip idiom (never stuffed),
// attribution on every claim, hedges for shade ("appears to"/"seemingly").
import { chat } from "../lib/openrouter.mjs";

const SYSTEM = `You are a sharp, fast celebrity-gossip writer for The Screen Report — the wit and energy of Page Six and TMZ, written like a smart friend who has the tea. CRAFT (do all of this):
- Punchy and irreverent with a knowing wink — but tasteful and credible, never mean, sleazy, or moralizing.
- Short, active sentences; plain vivid verbs; cut every wasted word (if five words work, don't use nine).
- Open with a CURIOSITY HOOK — a question or an intriguing image — then deliver fast. Skimmable: short paragraphs, varied rhythm.
- Light, natural gossip idiom is welcome ("sparked rumors", "set tongues wagging", "stepped out", "fans were quick to notice") — sprinkle a little, NEVER stuff; never read like a cliché generator or an AI.
NON-NEGOTIABLE (legal + trust — these override style):
- Write ONLY from the VERIFIED BUNDLE. Never add a fact, quote, name, number, date, or detail that is not in it.
- Every factual claim about a person is ATTRIBUTED ("according to [Outlet]", "a source tells [Outlet]", "fans noticed") or framed as opinion/speculation — NEVER asserted as your own fact.
- For shade/feuds, DECODE with hedges ("appears to", "seemingly", "thinly veiled") — never assert a direct attack as fact.
- Follow the FRAMING DIRECTIVE exactly, and include the mandatory non-confirmation sentence VERBATIM where required.
- Never describe or link intimate/leaked media; never a damaging claim about a private person or a minor.
Output STRICT JSON only.`;

// Per-type writing templates (the owner's "each gossip is different" requirement).
const TYPES = {
  romance: "TYPE = DATING/ROMANCE RUMOR. Open on the will-they spark. Lead with the trigger (the sighting/photo/event), attributed. Add behavioral color from the bundle (how they looked/acted) — only details that are IN the bundle. Tie to any past link or timeline if present. Close on what is still unconfirmed.",
  breakup: "TYPE = BREAKUP/SPLIT. Lead with the news, attributed. Give the relationship timeline from the bundle (how long together, when first linked). Note the stated reason/source and current status. Be matter-of-fact, not gleeful.",
  feud: "TYPE = FEUD/SHADE. Lead with the trigger (the post/comment/subtweet). DECODE it with hedges ('appears to', 'seemingly', 'thinly veiled', 'took a swipe at') — never assert a direct attack as fact. Add the back-history if in the bundle. Note that neither side has confirmed anything.",
  spotted: "TYPE = SPOTTED/SIGHTING. Lead with where + when + who. Keep it short and fun. Say briefly why it matters. Attribute the sighting.",
  pregnancy: "TYPE = PREGNANCY/BABY/HEALTH SPECULATION (sensitive — tread carefully). Lead with the cryptic clue. Say what fans are reading into it — as SPECULATION, never as fact. Lay out the clues from the bundle. Respectful tone; the non-confirmation note is mandatory and prominent.",
  cryptic: "TYPE = CRYPTIC POST / SOCIAL SLEUTHING. Lead with the post. Lay out the fan theories and the clues being decoded (emojis, timing, imagery) — only those in the bundle. Frame the WHOLE thing as the online conversation, not a conclusion.",
  career: "TYPE = CAREER/DEAL/CASTING RUMOR. Lead with the reported move, attributed. Say what it would mean for the person/project. Note it is unconfirmed and reps haven't commented (if in the bundle).",
  controversy: "TYPE = CONTROVERSY/BACKLASH. Lead with what happened (attributed or per the record). Give the reaction and the context. Include any response or denial. Stay neutral; report the discourse, don't pile on.",
  general: "TYPE = GENERAL GOSSIP. Lead with the hook, attributed. Give the trigger, a little context, and what's still unconfirmed.",
};

// Detect the gossip TYPE from the claim/title (most specific first). Drives the template above.
export function detectGossipType(topic) {
  const t = `${topic.title || ""} ${topic.claim || ""}`.toLowerCase();
  if (/\b(pregnan|expecting|baby bump|having a baby|hospitaliz|health scare|rehab|cancer|illness)\b/.test(t)) return "pregnancy";
  if (/\b(split|break ?up|broke up|divorc|separat|called it off|calls it quits|ex-|former (couple|flame)|no longer together)\b/.test(t)) return "breakup";
  if (/\b(feud|shade|subtweet|diss|took a (shot|swipe|dig)|clap ?back|beef|throwing shade|unfollow|slam|fired back)\b/.test(t)) return "feud";
  if (/\b(backlash|controvers|under fire|called out|apolog|accus|criticism|dragged|canceled)\b/.test(t)) return "controversy";
  if (/\b(cast|casting|in talks|joins|signs on|lands? (the )?role|reboot|sequel|exit|quits|leaving|replac)\b/.test(t)) return "career";
  if (/\b(dating|romance|new (man|woman|flame|couple)|fling|smitten|cozy|linked|relationship|getting close|more than friends)\b/.test(t)) return "romance";
  if (/\b(spotted|seen (together|out)|stepped out|sighting|out and about|grabbed (dinner|lunch|coffee))\b/.test(t)) return "spotted";
  if (/\b(cryptic|hint|teas\w+|sparked speculation|fans (think|believe|speculate)|wonder\w*|fueled rumors)\b/.test(t)) return "cryptic";
  return "general";
}

export function buildGossipPrompt(bundle, frame, topic) {
  const gtype = detectGossipType(topic);
  const sourceBlock = (bundle.sources || [])
    .map((s, i) => `[S${i + 1}] ${s.outlet}${s.url ? ` (${s.url})` : ""} — tier ${s.tier}\n${(s.text || "").slice(0, 2500)}`)
    .join("\n\n");
  const quoteBlock = (bundle.quotes || []).map((q) => `• "${q}"`).join("\n") || "(no verbatim quotes available — paraphrase only, invent nothing)";

  const user = `TOPIC: ${topic.title || ""}
ABOUT: ${topic.primaryEntity || bundle.entity || ""}

THE VERIFIED BUNDLE — the ONLY facts and quotes you may use:
${sourceBlock || "(no source text)"}

VERBATIM QUOTES you may use (copy exactly; attribute them):
${quoteBlock}

${TYPES[gtype] || TYPES.general}

FRAMING DIRECTIVE (follow exactly):
${frame.writerDirective}
${frame.needsDisclaimer ? `\nMANDATORY — include this exact sentence, as its own sentence in the body:\n"${frame.disclaimerText}"` : ""}

LENGTH: write 300–450 words — IMPORTANT, do not stop short at 150. Keep individual SENTENCES tight, but develop the story fully: the trigger, the context, the fan reaction, the what-we-know-vs-what's-unconfirmed, and why it matters. A real article, not a caption.
STRUCTURE: headline = a curiosity hook in present tense (NEVER state an unconfirmed damaging claim as fact in the headline). Hook → what sparked it (attributed) → what we know vs. what's unconfirmed → quick context / why it matters → the denial / other side if any. Pull one punchy line out as the pull-quote.

Return STRICT JSON:
{ "title": "...", "dek": "one-line standfirst with a little wit",
  "body": "markdown article (250–450 words) INCLUDING the mandatory non-confirmation sentence verbatim if required",
  "pullQuote": "one short punchy line from the story (a quote or a vivid sentence) for display",
  "keyTakeaways": ["3 short bullets"],
  "faq": [{"q":"...","a":"..."}],
  "claims": [{"text":"each checkable claim","sourceQuote":"the verbatim bundle text that supports it"}],
  "whatWeKnow": ["confirmed/attributed points"],
  "whatWeDont": ["the open questions"],
  "denial": "the subject/rep denial if any, else null",
  "statusLabel": "${frame.uiLabel}" }`;
  return { system: SYSTEM, user, gossipType: gtype };
}

export async function writeGossip({ bundle, frame, topic, model = "deepseek/deepseek-v3.2" }) {
  const { system, user } = buildGossipPrompt(bundle, frame, topic);
  const { data } = await chat({ model, system, user, json: true, maxTokens: 1800, temperature: 0.65 });
  return data;
}
