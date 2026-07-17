// GOSSIP — WRITER (Stage 5). Builds the article from the VERIFIED bundle + the frame's directive, in a
// researched gossip voice, with a PER-TYPE template (a dating rumor reads nothing like a feud or a cryptic-post
// story), and ALWAYS the mandatory in-text non-confirmation disclaimer. buildGossipPrompt() is pure (testable
// without an LLM); writeGossip() does the live generation.
// Voice/craft sourced from how Page Six / TMZ / Pop Crave / People actually write (RUMOR_GOSSIP_AUTOMATION_PLAN
// PART 22): punchy + tight + active, curiosity hook, skimmable, a pull-quote, light gossip idiom (never stuffed),
// attribution on every claim, hedges for shade ("appears to"/"seemingly").
import { agentChat } from "./models.mjs";

const SYSTEM = `You are a sharp, fast celebrity-gossip writer for The Screen Report — the wit and energy of Page Six and TMZ, written like a smart friend who has the tea. CRAFT (do all of this):
- Punchy and irreverent with a knowing wink — but tasteful and credible, never mean, sleazy, or moralizing.
- Short, active sentences; plain vivid verbs; cut every wasted word (if five words work, don't use nine).
- Open with a strong, SPECIFIC lede in the LEDE STYLE you're assigned below (scene / quote-first / fact-first / contrast / question). NEVER use the formula "What happens when…? For [NAME]…" or any recycled question template — vary how you open every time. Then deliver fast. Skimmable: short paragraphs, varied rhythm, and use one or two "## " subheads to break a longer piece into sections.
- Light, natural gossip idiom is welcome ("sparked rumors", "set tongues wagging", "stepped out", "fans were quick to notice") — sprinkle a little, NEVER stuff; never read like a cliché generator or an AI.
NON-NEGOTIABLE (trust — these override style). This is a SPECULATION/gossip desk: lively interpretation is the point, but two things are sacred — checkable specifics, and never presenting the unconfirmed as confirmed.
- CHECKABLE SPECIFICS ARE SACRED (the #1 rule). Every NAME, NUMBER, AGE, DATE, money amount, place, work TITLE, and OUTLET/source ATTRIBUTION must come from the bundle EXACTLY and stay attached to the RIGHT person or thing. Never invent one, never guess one, and NEVER MISPLACE one — do not attribute a quote, number, role, or action to the wrong person, and do not credit the wrong outlet (if the fan reactions came from WABI, say WABI, not WMUR). A misplaced name or number is one of the worst errors you can make.
- NEVER GUESS A BACKGROUND / HISTORICAL YEAR. Do NOT add a past date from memory — an engagement year, a marriage/wedding year, a "dating since" year, a birth/death/release year — unless the bundle states that EXACT year FOR THAT event. A year in the bundle for one thing (e.g. they started DATING in 2023) is NOT the year for another (their ENGAGEMENT). If the bundle gives no year for a past event, don't state one — write "years ago" / "previously" / "back in [what the source says]". A wrong background year is a real error even in a fun story.
- QUOTATION MARKS = VERBATIM ONLY. Put text in quotation marks ONLY if you copied it word-for-word from a source. If the source paraphrased ("struggles with substance abuse"), NEVER reword it inside quotes ("has a drug problem"). Quote the EXACT words, or paraphrase WITHOUT quotation marks. Never invent a quote, a "source says", or a rep statement.
- ATTRIBUTE EVERY QUOTE TO THE RIGHT SPEAKER. Credit a quote ONLY to the exact person the SAME source says spoke it. If you are not 100% sure who said a quoted line, do NOT name a speaker and do NOT paper over it with a vague cover like "in a past interview" or "once said" — either attribute it to the person the source explicitly names, or drop the quotation marks and paraphrase. Pinning a real quote on the wrong person is one of the worst errors you can make.
- SPECULATION IS WELCOME — but FRAME IT AS SPECULATION. You may add engaging interpretation, atmosphere, and "what this could mean" color to make it a fun read; just phrase it as speculation ("it seems", "reportedly", "sources suggest", "fans wonder", "appears to") — NEVER as your own confirmed fact.
- MATCH THE SOURCE'S CONFIDENCE — this is the one line you must not cross:
  • CONFIRMED → state as FACT. If a source confirms it — an official announcement, a court/police record, the person's own statement, or an outlet reporting it as established fact — write it plainly. Do NOT hedge a confirmed fact into a "rumor". (A publicly ANNOUNCED pregnancy/engagement/deal is CONFIRMED — say so.)
  • NOT CONFIRMED → say so: "it's reported that", "according to [Outlet]", "a source claims", "reportedly", "expected to". An insider tip / rumor / "expected"/"in talks" is NEVER your own established fact — do not upgrade "expected to star" into "set to star", or "an EP" into "a co-star".
- Avoid spammy clickbait words ("SHOCKING", "you won't believe", "BOMBSHELL", all-caps "SLAMS", "jaw-dropping") — write it straight; the story carries itself.
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

// LEDE styles (fix #3 — kill the "What happens when…? For NAME…" template fingerprint). One is assigned
// per article (rotated by the runner) so consecutive articles never open the same way. The order in this
// object is the rotation order; keep `question` last + rare.
export const LEDE_STYLES = {
  scene: "LEDE = SCENE. Open IN THE MOMENT — a vivid, specific image of what happened (the place, the look, the action), taken straight from the bundle. Drop the reader into the scene, then pull back to the news. No question opener.",
  fact: "LEDE = FACT-FIRST. Open with the hard news in ONE flat, confident declarative sentence — the what + who, attributed — then unpack the context. No question, no throat-clearing, no 'What happens when'.",
  quote: "LEDE = QUOTE-FIRST. Open on the single most striking VERBATIM quote from the bundle (attributed), then say who said it and why it matters. Use ONLY if a real verbatim quote exists; otherwise open fact-first instead.",
  contrast: "LEDE = CONTRAST / TWIST. Open on the tension or surprise — what everyone assumed vs. what actually happened, or then-vs-now — then deliver the reveal. No question opener.",
  question: "LEDE = QUESTION (sparingly). Open on ONE sharp, SPECIFIC question the story answers — but NEVER 'What happens when…?' and NEVER 'For [NAME]…'. A concrete, unique question, answered fast in the next line.",
};
export const LEDE_ORDER = ["scene", "fact", "quote", "contrast", "fact", "scene", "question", "contrast"];

// Detect the gossip TYPE from the claim/title (most specific first). Drives the template above.
export function detectGossipType(topic) {
  const t = `${topic.angle || ""} ${topic.title || ""} ${topic.claim || ""}`.toLowerCase();
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

// Word TARGET = f(bundle depth) — never a fixed floor (a floor past the bundle's material is the fabrication
// forcing-function; news lane D1). Thin bundle → short + legal beats padded; rich bundle → a fuller piece.
export function wordRangeFor(bundle, anchors = []) {
  const seed = (bundle?.sources || []).filter((s) => !s.corroborating);
  const chars = (bundle?.sources || []).reduce((a, s) => a + (s.text || "").length, 0);
  const rich = chars >= 5000 || (bundle?.sources || []).length >= 3;
  const medium = chars >= 1800;
  const lo = rich ? 350 : medium ? 280 : 220;
  const hi = rich ? 450 : medium ? 380 : 300;
  return { lo, hi, label: `${lo}\u2013${hi} words` };
}

export function buildGossipPrompt(bundle, frame, topic, corrections = null, ledeStyle = "scene", brief = null, anchors = []) {
  const gtype = detectGossipType(topic);
  const sourceBlock = (bundle.sources || [])
    .map((s, i) => `[S${i + 1}] ${s.outlet}${s.url ? ` (${s.url})` : ""} — tier ${s.tier}\n${(s.text || "").slice(0, 2500)}`)
    .join("\n\n");
  // ANCHOR CARDS (Phase 2): when present, quotes are inserted BY TOKEN — the writer never types quote text,
  // so verbatim-ness is structural. Without anchors, fall back to the old verbatim-quote list.
  const quoteBlock = anchors.length
    ? anchors.map((a) => `${a.id} (${a.outlet}): "${a.text}"`).join("\n")
    : ((bundle.quotes || []).map((q) => `• "${q}"`).join("\n") || "(no verbatim quotes available — paraphrase only, invent nothing)");
  const range = wordRangeFor(bundle, anchors);

  const user = `${topic.isUpdate ? `⚠ FOLLOW-UP: we already covered this story's earlier chapter. LEAD with the NEW development${topic.updateFact ? ` (${topic.updateFact})` : ""}; recap the background in ONE sentence mid-piece, never as the opener.\n` : ""}${topic.angle ? `THE STORY (the content-verified angle — write THIS): ${topic.angle}\n` : ""}DISCOVERY HEADLINE (UNVERIFIED — may be clickbait or overstated; do NOT treat it as fact, verify every specific against the bundle): ${topic.title || ""}
ABOUT: ${topic.primaryEntity || bundle.entity || ""}

THE VERIFIED BUNDLE — the ONLY facts and quotes you may use:
${sourceBlock || "(no source text)"}

${anchors.length ? `QUOTE CARDS — to include a quote, write its TOKEN like ⟦Q1⟧ exactly where the quote belongs (the system replaces the token with the exact quote text; NEVER type quote words yourself; attribute the speaker in the surrounding sentence). Use 1–3 of the strongest; skip weak ones:` : `VERBATIM QUOTES you may use (copy exactly; attribute them):`}
${quoteBlock}
${brief ? `
YOUR RESEARCHER'S BRIEF (grounded in the sources — follow the beats, verify every specific against the bundle):
HOOK: ${brief.hook || ""}
MOOD: ${brief.mood || ""}
BEATS: ${(brief.beats || []).map((b, i) => `${i + 1}. ${b}`).join("  ")}
MUST INCLUDE: ${(brief.mustInclude || []).join("; ")}
ANGLE: ${brief.angle || ""}${brief.useAnchors?.length ? `
FEATURE THESE QUOTE CARDS: ${brief.useAnchors.join(", ")}` : ""}` : ""}

${TYPES[gtype] || TYPES.general}

LEDE STYLE for THIS article — vary how you open (do NOT default to a question, NEVER "What happens when…? For [NAME]…"):
${LEDE_STYLES[ledeStyle] || LEDE_STYLES.scene}

FRAMING DIRECTIVE (follow exactly):
${frame.writerDirective}
${frame.needsDisclaimer ? `\nMANDATORY — include this exact sentence, as its own sentence in the body:\n"${frame.disclaimerText}"` : ""}
${corrections ? `\n⚠ FIX THESE FROM YOUR LAST DRAFT (keep the voice + the same facts; attribute any flagged claim, e.g. "according to ${frame.attribution || "the outlet"}", or add the required note): ${corrections}` : ""}

LENGTH: write ${range.label} — the target matches how much VERIFIED material the bundle actually holds. Never pad past the material: a thin bundle means a SHORT, punchy, legal piece (padding invents facts — the one unforgivable error). Keep individual SENTENCES tight and develop what the bundle supports: the trigger, the who/what/when/where, the reaction, the what-we-know-vs-unconfirmed, the relevant timeline/context. More RELEVANT specifics = a stronger story.
STRUCTURE: the DISPLAY headline (title) = a specific present-tense hook that names the subject (NEVER state an unconfirmed damaging claim as fact). Open the BODY with your assigned LEDE STYLE above — never a recycled "What happens when…?" question. Then: what sparked it (attributed) → what we know vs. what's unconfirmed → quick context / why it matters → the denial / other side if any. Use one or two "## " subheads to break up a longer piece (skip subheads under ~450 words). Pull one punchy line out as the pull-quote.
CRAFT (each of these measurably drives search + reader trust — do them all where the bundle supports it):
- Sentence 2 of the lede = the sourcing tag + a role appositive ("..., a source close to the 'Euphoria' star told PEOPLE").
- Include at least ONE concrete NUMBER from the bundle (an age, a date, a dollar figure, a count) and — when a quote card exists — at least ONE attributed quote.
- Name the outlet IN the text ("told PEOPLE", "per court documents", "TMZ reports") — attribution is the product.
- TIME-ANCHOR every beat: never "recently"/"a while back" when the bundle gives a date or day.
- Quote-then-context rhythm; NO conclusion paragraph — the piece stops on the latest fact or the open question.

Return STRICT JSON:
{ "title": "...", "dek": "one-line standfirst with a little wit",
  "metaTitle": "SEARCH title: 45–55 chars, STARTS with the main person's NAME then the hook — a COMPLETE phrase (never cut mid-word / mid-name / mid-quote), no site name. Front-load the name so it wins in Google; may differ from the display title. Every specific must be bundle-supported.",
  "metaDescription": "SEARCH snippet: 140–160 chars, a teaser that earns the click — the hook PLUS one concrete fact from the story (a name / number / what happened). One or two COMPLETE sentences ending in a period. Must be REWORDED, NOT identical to the dek. Only bundle-supported facts.",
  "body": "markdown article (${range.label}) INCLUDING the mandatory non-confirmation sentence verbatim if required; use one or two '## ' subheads when it helps",
  "pullQuote": "one short punchy line from the story (a quote or a vivid sentence) for display",
  "keyTakeaways": ["EXACTLY 3 short factual takeaway bullets — REQUIRED, never empty"],
  "faq": [{"q":"a real question a reader would google about THIS story","a":"a SHORT, REAL factual ANSWER from the bundle"}, "... 2 to 5 FAQ — pick the count by how much the story SUPPORTS (a rich, multi-fact story → 4–5; a thin one → 2), never pad to a fixed number. Ask questions the article ANSWERS (the who/what/when/where/why of the CONFIRMED facts) and give each a real answer. Do NOT ask about things nobody knows yet or answer with 'not confirmed'/'unknown' — every FAQ must teach the reader something."],
  "claims": [{"text":"the claim","sourceQuote":"the verbatim bundle text that supports it"}],
  "_claimsRule": "REQUIRED — self-verify: for EVERY date, number, place name, person name, and work title (album/show/movie/song/book/tour) in the article, add a claims[] entry whose sourceQuote is the EXACT bundle text proving THAT specific attached to THAT thing. If the bundle has no text for a specific, do NOT write that specific.",
  "whatWeKnow": ["confirmed/attributed points — only facts the bundle supports"],
  "whatWeDont": ["genuine open questions about THIS story's CORE development only — do NOT list basic attributes (the date/place/amount) of a DIFFERENT event you only mention as context, and NEVER list as 'unknown' anything you state as known"],
  "denial": "the subject/rep denial if any, else null",
  "statusLabel": "${frame.uiLabel}" }`;
  return { system: SYSTEM, user, gossipType: gtype };
}

// SURGICAL-CORRECTION prompt (Step 5). The writer FIXES its own draft instead of rewriting it: it gets the prior
// draft + the EXACT list of problems + the same verified bundle, and edits ONLY the flawed spots (find the real
// supporting fact in the bundle, attribute it, soften it to speculation, or cut it) — every correct sentence is
// preserved verbatim. This keeps a good piece good while killing the specific fabrications. A full rewrite is the
// fallback (run.mjs sets rewrite=true) only when the draft is broken top-to-bottom.
const CORRECTION_SYS = `You are editing a celebrity-gossip draft for The Screen Report. You are NOT rewriting it — you are SURGICALLY FIXING specific flagged problems while keeping everything that is already correct.
RULES:
- Preserve every sentence that is NOT flagged EXACTLY as written — same voice, same facts, same order. Do not re-style, re-order, or "improve" untouched text.
- For each flagged problem, do the SMALLEST fix that makes it true and safe, using ONLY the VERIFIED BUNDLE:
  • if the bundle supports the claim → attribute it ("according to [Outlet]", "a source tells [Outlet]") and quote ONLY verbatim words;
  • if the bundle does NOT support it → soften to attributed speculation ("fans speculate", "appears to") OR cut the claim entirely;
  • if a quote isn't verbatim in the bundle → replace with the exact words or drop the quotation marks and paraphrase.
- NEVER invent a new fact, quote, source, number, or date to "patch" a hole. Cutting a false claim is always better than inventing a true-sounding one.
- Keep the mandatory non-confirmation sentence verbatim if the framing requires it.
Output the FULL corrected article as STRICT JSON (same shape as the draft).`;

export function buildCorrectionPrompt(bundle, frame, topic, priorArticle, issues) {
  const sourceBlock = (bundle.sources || [])
    .map((s, i) => `[S${i + 1}] ${s.outlet}${s.url ? ` (${s.url})` : ""} — tier ${s.tier}\n${(s.text || "").slice(0, 2500)}`)
    .join("\n\n");
  const issueList = Array.isArray(issues) ? issues : String(issues || "").split(";").map((x) => x.trim()).filter(Boolean);
  const user = `ABOUT: ${topic.primaryEntity || bundle.entity || ""}

THE VERIFIED BUNDLE — the ONLY facts and quotes you may use to fix things:
${sourceBlock || "(no source text)"}

YOUR DRAFT (fix ONLY the flagged problems below; keep the rest verbatim — and apply each fix in EVERY field it appears: a wrong date in a keyTakeaway or an FAQ answer must be fixed there too, not only in the body):
${JSON.stringify({ title: priorArticle.title, dek: priorArticle.dek, metaTitle: priorArticle.metaTitle, metaDescription: priorArticle.metaDescription, body: priorArticle.body, pullQuote: priorArticle.pullQuote, keyTakeaways: priorArticle.keyTakeaways, faq: priorArticle.faq, whatWeKnow: priorArticle.whatWeKnow, whatWeDont: priorArticle.whatWeDont, denial: priorArticle.denial }).slice(0, 8000)}

PROBLEMS TO FIX (each one, surgically — and apply each fix to metaTitle/metaDescription too if the flagged specific appears there):
${issueList.map((p, i) => `${i + 1}. ${p}`).join("\n") || "(none specified)"}
${frame.needsDisclaimer ? `\nKEEP this exact sentence in the body: "${frame.disclaimerText}"` : ""}

Return the FULL corrected article as STRICT JSON, same shape:
{ "title":"...","dek":"...","metaTitle":"45–55, name-first, complete","metaDescription":"140–160, teaser + a fact, full sentence","body":"...","pullQuote":"...","keyTakeaways":["..."],"faq":[{"q":"...","a":"..."}],
  "claims":[{"text":"...","sourceQuote":"verbatim bundle text"}],"whatWeKnow":["..."],"whatWeDont":["..."],"denial":null,"statusLabel":"${frame.uiLabel}" }`;
  return { system: CORRECTION_SYS, user };
}

export async function writeGossip({ bundle, frame, topic, model = null, corrections = null, priorArticle = null, issues = null, rewrite = false, ledeStyle = "scene", brief = null, anchors = [] }) {
  // SURGICAL self-correction when we have a prior draft and aren't forcing a rewrite; otherwise a fresh write.
  const useSurgical = priorArticle && !rewrite && (issues || corrections);
  const { system, user } = useSurgical
    ? buildCorrectionPrompt(bundle, frame, topic, priorArticle, issues || corrections)
    : buildGossipPrompt(bundle, frame, topic, rewrite ? null : corrections, ledeStyle, brief, anchors);
  // 2800 tokens: a 450-600-word body + dek + pull-quote + 3 takeaways + FAQ + claims + whatWeKnow/Dont must all fit
  // in the JSON, or the output truncates mid-sentence (the cause of an incomplete published article).
  const { data } = await agentChat("writer", { model: model || undefined, system, user, json: true, surgical: !!useSurgical });
  return data;
}
