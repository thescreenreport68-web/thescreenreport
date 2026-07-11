// AGENT 5 — SCRIPT WRITER: the viral-hook heart (plan §2.2 #5, §1.5).
// Writes ONLY from verified facts. Deterministic lint (agent 6) drives the retry loop —
// violations are named back to the writer at low temperature. Max 2 attempts, then hold.
import { llm } from "../models.mjs";
import { IG } from "../config.mjs";
import { lintScript } from "../lib/lint.mjs";
import { lintEnding } from "./engage.mjs";
import { loadWeights } from "../lib/ledger.mjs";
import { normWords } from "../lib/util.mjs";

const SYS = `You REWRITE a Hollywood news article into a spoken script for an Instagram Reel. You are NOT summarizing — you are turning the real facts into an engaging, video-native spoken story a great creator would voice. Your ONLY goal: the reel goes viral — maximum watch time (hook + density) and maximum engagement. Aim for a 30-40 second read when the story has the material; a tighter 25-30 seconds is fine when it doesn't.

HARD RULES:
- Use ONLY the verified facts provided. Never add, infer, or embellish a fact. Go DEEP on the real facts (the vivid specifics, the numbers, the who-said-what) to fill the runtime — never pad with filler or repetition.
- REWRITE, DON'T RECAP. Turn the facts into an engaging spoken STORY: lead with the most surprising CONCRETE fact, build curiosity beat by beat, and use the punchy, direct phrasing a top creator uses. If the story is thin, go DEEPER on the REAL details you have — the context, what's surprising, why it matters, what fans react to — to reach the length that way. The audience QUESTION belongs in the ending beat (below), NEVER in the hook — the hook is always a concrete fact. Engagement comes from FRAMING and curiosity, NEVER from inventing a fact, number, date, or quote (hard line).
- ONE story only. No background tangents.
- HOOK (sentence 1): ≤12 words, contains the star/film name AND the single most surprising concrete fact. No greetings, no "in recent news", never open with "revealed/teased/talked about".
- Order facts by DESCENDING surprise — the best material inside the first 10 seconds, never saved for the end.
- Sentences ≤14 words, punchy, spoken-word rhythm (contractions fine). ${IG.script.minWords}-${IG.script.maxWords} words total (aim for the 30-40s upper range when the material allows; 25-30s is fine for a thinner story — reach the floor by expanding the REAL details engagingly, never by padding).
- WRITE FOR THE VOICE: read your script aloud in your head — it must flow as ONE continuous
  broadcast, never a list of disconnected lines. Get flow from SHORT connected sentences, never
  from long ones: start sentences with natural momentum connectives where they help the handoff
  (And, But, Now, Then, Because, So — connectives are FLOW, not padding), and if any sentence
  runs past 14 words, SPLIT it into two short ones. Vary the rhythm (a 6-word jab after a
  12-word line). Every sentence should pull the listener into the next one.
- THE ENDING IS ONE FLOWING BEAT OF TWO SENTENCES, written by YOU as part of the story:
  {ENDING_GUIDANCE}. The ask must feel inevitable after the question — never a topic change,
  never bolted on. Ask examples for this video: {ASK_EXAMPLES}. NEVER "follow for more".
  Never bait phrases ("wait for it", "you won't believe", "tag a friend").
- THE RUN-UP TO THE ENDING MUST BUILD TOWARD THE QUESTION. The 2 sentences right before the
  closing question carry momentum INTO it — they raise the exact tension the question resolves.
  NEVER put a tangent, a roster/list ("also have kids X, Y, Z"), a side-fact, or a date-dump in
  the final third; those belong in the MIDDLE. A low-energy fact dropped before the question is
  what makes an ending feel "tacked on" — end on the through-line, not a footnote.
- USE THE FULL RANGE of facts — every sentence adds a DIFFERENT fact or angle, never circling back. COMBINE closely-related facts into ONE beat (two facts about the same detail = one sentence, not two restatements). Never repeat the same fact, phrase, or point.
- Numbers: write digits (the pronunciation pass handles speech).

Return STRICT JSON: {"sentences":[string], "hookStyle":"record-number"|"casting-shock"|"first-look"|"return-nostalgia"|"debate"|"reveal", "ending":"question"}`;

export async function writeScript({ article, facts, segment, engage }) {
  const weights = loadWeights();
  const factList = facts.facts
    .map((f) => `- (surprise ${f.surprise}) ${f.claim}`)
    .join("\n");
  const learned = Object.keys(weights.hookStyles || {}).length
    ? `\nLEARNED: these hook styles over/under-perform for our audience: ${JSON.stringify(weights.hookStyles)} — prefer high performers when the story allows.`
    : "";
  const sys = SYS
    .replace("{ENDING_GUIDANCE}", engage?.family?.writerGuidance || "end with a genuine question the audience wants to answer, then invite them to answer it in the comments")
    .replace("{ASK_EXAMPLES}", (engage?.family?.examples || ['"Let us know in the comments below."']).join(" or "));
  const base = `STORY: ${facts.storyOneLine || article.title}\nSEGMENT: ${segment || "news"}\nENGAGEMENT GOAL: ${engage?.goal || "comments"}\nENTITIES: ${facts.entities.map((e) => e.name).join(", ")}\nVERIFIED FACTS (the ONLY allowed material):\n${factList}${learned}`;

  let violations = [];
  let lastScript = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = attempt === 0 ? base : `${base}\n\nYOUR PREVIOUS ATTEMPT FAILED THESE GATES — fix exactly these, change nothing else that worked:\n${violations.map((v) => `- ${v.rule}: ${v.detail}`).join("\n")}`;
    const res = await llm({
      role: "writer",
      system: sys,
      user,
      temp: attempt === 0 ? 0.7 : 0.2,
      maxTokens: 1600,
      json: true,
    });
    const script = {
      // deterministic re-chunking: however the model groups the array, we lint and speak
      // real sentences (the flow prompt tempts it to return one flowing paragraph)
      sentences: (res.sentences || [])
        .flatMap((s) => String(s).split(/(?<=[.!?…])\s+/))
        .map((s) => s.trim())
        .filter(Boolean),
      hookStyle: res.hookStyle || "reveal",
      ending: "question",
    };
    violations = [
      ...lintScript(script, facts.entities, `${article.title} ${facts.storyOneLine || ""}`),
      ...lintEnding(script.sentences, engage?.goal || "comments"),
    ];
    if (!violations.length) {
      // SEMANTIC ending check (text-only, ~free): regex can't hear a non-sequitur ask —
      // "Save this for when you need a peek inside" passes patterns and still lands flat.
      if (attempt < 2) {
        try {
          const sem = await llm({
            role: "classify",
            system:
              'Judge ONLY the ending of a short news reel script. STRICT JSON {"lands":boolean,"fix":string} — lands: do the final two sentences read as a natural, satisfying conclusion of THIS story (a question that grows out of the story, then an ask that follows from the question)? false if the ask feels bolted-on, generic, or a non-sequitur. fix: one sentence of direction if false.',
            user: `STORY: ${facts.storyOneLine}\nSCRIPT ENDING:\n${script.sentences.slice(-3).join("\n")}`,
            temp: 0,
            maxTokens: 120,
            json: true,
          });
          if (sem.lands === false) {
            violations = [{ rule: "ending-semantic", detail: sem.fix || "the ask does not follow from the story — rewrite the final two sentences as one natural beat" }];
            lastScript = script;
            continue;
          }
        } catch { /* semantic check is best-effort */ }
      }
      return { script, attempts: attempt + 1 };
    }
    lastScript = script;
  }
  // DETERMINISTIC MECHANICAL REPAIR: length/hook overruns are the model's most common miss
  // and are deterministically fixable — split an overlong hook at its natural break, then
  // trim whole body sentences (hook block + ending pair stay intact) until under the ceiling.
  // Only fires when EVERY remaining violation is mechanical; content gates are never papered over.
  const MECH = new Set(["too-long", "duration", "hook-too-long", "sentence-too-long"]);
  if (lastScript && violations.length && violations.every((v) => MECH.has(v.rule))) {
    let s = [...lastScript.sentences];
    // 1) an overlong HOOK splits at its last natural break (keeps the entity+fact up front)
    if (s.length && normWords(s[0]).length > 14) {
      const m = s[0].match(/^(.{8,}?)\s*[,;:—–-]\s+(.+)$/); // a comma/dash gives a clean seam
      if (m) s = [m[1].replace(/[,;:—–-]\s*$/, "") + ".", m[2], ...s.slice(1)];
      else {
        const w = s[0].split(/\s+/);
        const cut = Math.min(12, Math.ceil(w.length / 2));
        s = [w.slice(0, cut).join(" ").replace(/[,;:]+$/, "") + ".", w.slice(cut).join(" "), ...s.slice(1)];
      }
    }
    // 2) trim body sentences from just before the ending pair until under the word ceiling
    const cap = IG?.script?.maxWords ?? 144;
    while (normWords(s.join(" ")).length > cap && s.length > 7) s.splice(s.length - 3, 1);
    const trimmed = { ...lastScript, sentences: s };
    const still = [...lintScript(trimmed, facts.entities, `${article.title} ${facts.storyOneLine || ""}`), ...lintEnding(trimmed.sentences, engage?.goal || "comments")];
    if (!still.length) return { script: trimmed, attempts: 3, trimmed: true };
  }
  // DETERMINISTIC ENDING REPAIR: if the story passed every gate except ask PHRASING,
  // swap in the canonical ask for the goal (the writer's flow + question stay intact) —
  // repair beats retry-and-pray (same philosophy as the caption repair).
  if (lastScript && violations.every((v) => v.rule.startsWith("ending"))) {
    const canonical = (engage?.family?.examples?.[0] || '"Let us know in the comments below."').replace(/^"|"$/g, "");
    const s = [...lastScript.sentences];
    if (/\b(save|send|show|comment|bookmark|let us know|tell us)\b/i.test(s[s.length - 1])) s.pop();
    s.push(canonical);
    const repaired = { ...lastScript, sentences: s };
    const still = [...lintScript(repaired, facts.entities, `${article.title} ${facts.storyOneLine || ""}`), ...lintEnding(repaired.sentences, engage?.goal || "comments")];
    if (!still.length) return { script: repaired, attempts: 3, repairedEnding: true };
  }
  return { script: null, attempts: 3, hold: `script failed lint after 3 attempts: ${violations.map((v) => `${v.rule}(${v.detail?.slice(0, 60)})`).join(", ")}` };
}
