// AGENT 8 — VOICE (REV 3, owner: "the phrases are the most important thing"). Its one job: make
// the article read like the native genre — the register real audience-reaction desks write in —
// WITHOUT being able to touch a single locked fact. Mechanism, not trust:
//   1. Every quoted span is MASKED to a ⟦Qn⟧ token before the model sees the text — the editor
//      physically cannot edit a quote.
//   2. The edit is accepted only if every token survives exactly once and the fact-locks still
//      pass afterward (the orchestrator reverts to the pre-voice draft otherwise).
// Cosmetic-only by construction: a voice outage or a bad edit ships the un-voiced, QA-passed draft.
import { agentChat } from "../models.mjs";

// The genre's stock register (composed, not scraped — the phrases every fans-react desk leans on).
// The editor uses a FEW of these naturally, varied, never stacked.
export const PHRASEBOOK = [
  "the internet went into full meltdown",
  "fans are losing it over",
  "the timeline did not stay calm for long",
  "has fans in a chokehold",
  "the replies did not disappoint",
  "comment sections turned into a battleground",
  "social media had thoughts — a lot of them",
  "cue the meltdown",
  "the internet did what it does best",
  "nobody was ready for",
  "sent fans into a frenzy",
  "broke the internet's brain a little",
  "and the internet took it from there",
  "not everyone is buying it",
  "the other side isn't having it",
  "fans wasted no time",
  "it took about five minutes for the jokes to start",
  "the discourse isn't cooling off any time soon",
  "one thing is certain: nobody is done talking about this",
  "the reaction was instant — and loud",
];

// Meta/template headings that telegraph the format (owner: "why are you making it obvious?").
// Detected deterministically in QA (fixable correction) and stripped post-voice as a last resort.
export const BANNED_HEADINGS = [
  /^who is everyone (suddenly )?talking about/i,
  /^why is this happening( now)?/i,
  /^how are (audiences|fans|people|viewers|everyone) react/i,
  /^what('s| is) (the )?(debate|argument|buzz|discourse|reaction)/i,
  /^why (this|it) (hit a nerve|matters)/i,
  /^where does the (debate|conversation|discourse) go/i,
  /^what (are people|is everyone) saying/i,
  /^the (audience|fan|internet) (reaction|response)$/i,
  /^what happens next\??$/i,
];

export const findTemplateHeadings = (body) =>
  [...(body || "").matchAll(/^##+\s*(.+?)\s*$/gm)]
    .map((m) => m[1].replace(/[?!.]+$/, "").trim())
    .filter((h) => BANNED_HEADINGS.some((rx) => rx.test(h)));

// Last-resort deterministic fallback: a template heading that survived the voice pass is REMOVED
// (the prose reads fine without an H2; cut-don't-hold).
export const stripTemplateHeadings = (body) =>
  (body || "")
    .split("\n")
    .filter((line) => {
      const m = line.match(/^##+\s*(.+?)\s*$/);
      return !(m && BANNED_HEADINGS.some((rx) => rx.test(m[1].replace(/[?!.]+$/, "").trim())));
    })
    .join("\n");

// ── Quote masking ────────────────────────────────────────────────────────────────────────────────
const QUOTE_RX = /(["“])([^"“”\n]{8,400})(["”])/g;

export function maskQuotes(text) {
  const spans = [];
  const masked = (text || "").replace(QUOTE_RX, (m) => {
    const token = `⟦Q${spans.length + 1}⟧`;
    spans.push({ token, original: m });
    return token;
  });
  return { masked, spans };
}

export function unmaskQuotes(text, spans) {
  let out = text || "";
  for (const s of spans) {
    const first = out.indexOf(s.token);
    if (first === -1) return { text: null, ok: false }; // token dropped → reject the edit
    if (out.indexOf(s.token, first + s.token.length) !== -1) return { text: null, ok: false }; // duplicated
    out = out.replace(s.token, s.original);
  }
  if (/⟦Q\d+⟧/.test(out)) return { text: null, ok: false }; // an invented token
  return { text: out, ok: true };
}

const SYS = `You are the VOICE EDITOR of a top entertainment site's audience-reaction desk. You receive an
accurate, already-verified article whose quotes are masked as ⟦Qn⟧ tokens. Rewrite ONLY the wording —
headline, dek, subheadings, transitions, prose — into the native register of this genre: lively, online,
knowing, natural. The phrasebook below shows the register; use 2-3 such expressions naturally (varied,
never stacked, never forced).
HARD RULES:
- Every ⟦Qn⟧ token must appear EXACTLY ONCE in your body, in a sensible position. Never edit, drop,
  duplicate or invent tokens.
- NEVER introduce new quotation marks anywhere — you have no quotes to give.
- No new facts, names, numbers, dates or platforms. You rephrase; you never add.
- Subheadings must be STORY-SPECIFIC and a little creative — never generic template questions
  ("Why is this happening now?", "How are fans reacting?" and anything like them are banned).
- Keep the same rough length (±15%) and keep it scannable (short paragraphs, ## subheads).
- MATCH THE EMOTIONAL REGISTER: the phrasebook is for hype/debate/celebration stories. A death,
  illness or tragedy takes restraint — warm, somber, no meltdown/losing-it phrasing, no exclamation
  marks. Read the story first; the register follows the story, never the other way.
Output STRICT JSON only.`;

// run(job) → job.article with voiced title/dek/body (orchestrator verifies + may revert).
export async function run(job, { chatImpl = null } = {}) {
  const a = job.article;
  if (!a?.body) { job.voiceSkipped = "no article"; return job; }
  const { masked, spans } = maskQuotes(a.body);
  const user = `SUBJECT: ${job.story.primaryEntity} (${job.angle.form})

PHRASEBOOK (the register — pick a FEW that fit, adapt freely):
${PHRASEBOOK.map((p) => `- ${p}`).join("\n")}

CURRENT TITLE: ${a.title}
CURRENT DEK: ${a.dek}

ARTICLE BODY (quotes masked as ⟦Qn⟧ — preserve each token exactly once):
${masked}

JSON: {"title":"","dek":"1-2 sentences","body":"the rewritten markdown body with every ⟦Qn⟧ token"}`;
  try {
    const { data } = await agentChat("voice", { system: SYS, user }, chatImpl ? { chatImpl } : {});
    if (!data?.body || !data?.title) { job.voiceSkipped = "no usable edit"; return job; }
    const un = unmaskQuotes(data.body, spans);
    if (!un.ok) { job.voiceSkipped = "quote token damaged"; return job; }
    job.article = {
      ...a,
      title: String(data.title).slice(0, 140),
      dek: String(data.dek || a.dek).slice(0, 400),
      body: stripTemplateHeadings(un.text),
    };
    return job;
  } catch (e) {
    job.voiceSkipped = String(e?.message || e).slice(0, 80);
    return job;
  }
}
