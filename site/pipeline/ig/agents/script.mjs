// AGENT 5 — SCRIPT WRITER: the viral-hook heart (plan §2.2 #5, §1.5).
// Writes ONLY from verified facts. Deterministic lint (agent 6) drives the retry loop —
// violations are named back to the writer at low temperature. Max 2 attempts, then hold.
import { llm } from "../models.mjs";
import { IG } from "../config.mjs";
import { lintScript, estimateSeconds } from "../lib/lint.mjs";
import { lintEnding, rotatedExamples } from "./engage.mjs";
import { loadWeights } from "../lib/ledger.mjs";
import { normWords } from "../lib/util.mjs";

const SYS = `You REWRITE a Hollywood news article into a spoken script for an Instagram Reel. You are NOT summarizing — you are turning the real facts into an engaging, video-native spoken story a great creator would voice. Your ONLY goal: the reel goes viral — maximum watch time (hook + density) and maximum engagement. Aim for a 30-40 second read when the story has the material; a tighter 25-30 seconds is fine when it doesn't.

HARD RULES:
- Use ONLY the verified facts provided. Never add, infer, or embellish a fact. Go DEEP on the real facts (the vivid specifics, the numbers, the who-said-what) to fill the runtime — never pad with filler or repetition.
- You do NOT have to use EVERY fact. SELECT the most surprising, on-story facts that fit the length — a tight, well-paced reel beats a crammed one. When you have more material than fits, cut the weakest, never repeat a detail to stretch.
- REWRITE, DON'T RECAP. Turn the facts into an engaging spoken STORY: lead with the most surprising CONCRETE fact, build curiosity beat by beat, and use the punchy, direct phrasing a top creator uses. If the story is thin, go DEEPER on the REAL details you have — the context, what's surprising, why it matters, what fans react to — to reach the length that way. The audience QUESTION belongs in the ending beat (below), NEVER in the hook — the hook is always a concrete fact. Engagement comes from FRAMING and curiosity, NEVER from inventing a fact, number, date, or quote (hard line).
- REACTIONS ARE PARAPHRASED, NEVER QUOTED. Never put a fan's, viewer's, or social-media
  reaction in quotation marks — say the sentiment in YOUR OWN words ("audiences are calling
  it a return to form", "fans are losing it over the trailer", "the reaction online has been
  glowing"). Quoting a random person verbatim reads terribly in a reel. A SHORT on-record
  quote from a NAMED star or director is fine; an unnamed person's reaction is always reworded.
- ONE story only. No background tangents.
- NEVER break the fourth wall or reference the source or your own reporting. BANNED phrasings: "the article notes/says", "the report says/adds/notes", "the story says", "sources say", "it's been reported", "as mentioned", and any "according to [outlet/anyone]". You ARE the reporter — state every fact directly and first-hand, as if you have the information yourself. (A named on-record quote from a real star or director is still fine.)
- HOOK (sentence 1) IS A COLD OPEN — the reel lives or dies in its first 3 seconds (measured: viewers swipe at 2-4s when the open winds up). ≤10 words, contains the star/film name AND the single most surprising concrete fact, phrased as the PAYOFF not the setup ("Sam Neill is gone at 78" not "Sad news about a Jurassic Park star"). No greetings, no "in recent news", never open with "revealed/teased/talked about".
- Order facts by DESCENDING surprise — the best material inside the first 10 seconds, never saved for the end.
- LENGTH IS A HARD GATE — over-length gets the whole script AUTO-REJECTED, so stay disciplined:
  COUNT the words in every sentence and keep EACH ONE to ≤14 words; the moment a sentence reaches
  15, split it into two short ones. Keep the WHOLE script ${IG.script.minWords}-${IG.script.maxWords} words (aim 22-30s
  when the material allows; 25-30s is fine for a thinner story — reach the floor by expanding REAL
  details engagingly, never padding). The CLOSING QUESTION is the strictest: 12 words MAX, punchy and
  direct — a long, winding question kills the ending AND cannot be auto-fixed, so it will HOLD the video.
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
  what makes an ending feel "tacked on" — end on the through-line, not a footnote. The LAST person or work you NAME before the closing question MUST be the story's MAIN subject — never a secondary name (a sibling, a bystander, a separate sighting): the closing shot follows the last subject named, so a side character there hijacks the final frame. Secondary names go in the MIDDLE only.
- USE THE FULL RANGE of facts — every sentence adds a DIFFERENT fact or angle, never circling back. COMBINE closely-related facts into ONE beat (two facts about the same detail = one sentence, not two restatements). Never repeat the same fact, phrase, or point.
- SHARE TRIGGER (mandatory, exactly ONE): every script carries one beat a viewer would forward to a
  specific friend — a fandom-identity moment ("every Jurassic Park fan..."), a nostalgia callback, or
  a wow-stat. It must be a REAL fact from the list, framed for the person who NEEDS to hear it.
- Numbers: write digits (the pronunciation pass handles speech).
- PACE THE NUMBERS. Never stack multiple figures in one sentence — a voice rushes them and the scale is lost. Give each key number its OWN short beat with a word of context: "It opened to $160 million at home. Another $640 million overseas. That's $800 million worldwide." — NOT "160 million domestic and 640 million overseas for 800 million total." One figure per breath.

Return STRICT JSON: {"sentences":[string], "hookStyle":"record-number"|"casting-shock"|"first-look"|"return-nostalgia"|"debate"|"reveal", "ending":"question"}`;

// A sentence that ends on a word that grammatically CANNOT end a sentence (article,
// possessive, preposition, conjunction) is a spurious mid-phrase break from the writer
// (e.g. "...just made their." + "public debut...") — it makes the VOICE pause mid-thought
// at the very start. Stitch it back into the next sentence. (owner 2026-07-11)
// Only words that RELIABLY cannot end a sentence: articles, determiner-only possessives
// (whose pronoun form differs — "their"→"theirs", so a trailing "their" is always a break),
// and coordinating conjunctions. Deliberately EXCLUDES this/that/here/prepositions/his/her/its
// — those legitimately end sentences ("...like this.", "what it's for.") and must not merge.
const CANT_END = new Set("a an the my your our their and or but nor".split(" "));
export function mergeMidPhraseBreaks(sents) {
  const endWord = (s) => (s.replace(/["'’)\]]*[.!?…,;:]*$/u, "").split(/\s+/).pop() || "").toLowerCase().replace(/[^a-z]/g, "");
  const out = [];
  for (const s of sents) {
    // Two signals of a spurious break the writer emitted mid-phrase: the previous sentence
    // ends on a word that can't end one ("...made their."), OR THIS sentence starts with a
    // lowercase word ("...went." + "public at...") — a real sentence always starts capitalized.
    const startsLower = /^[a-z]/u.test(s);
    if (out.length && (CANT_END.has(endWord(out[out.length - 1])) || startsLower)) {
      out[out.length - 1] = out[out.length - 1].replace(/[.!?…]+$/u, "").trim() + " " + s;
    } else {
      out.push(s);
    }
  }
  return out;
}

export async function writeScript({ article, facts, segment, engage }) {
  const weights = loadWeights();
  const factList = facts.facts
    .map((f) => `- (surprise ${f.surprise}) ${f.claim}`)
    .join("\n");
  const learned = Object.keys(weights.hookStyles || {}).length
    ? `\nLEARNED: these hook styles over/under-perform for our audience: ${JSON.stringify(weights.hookStyles)} — prefer high performers when the story allows.`
    : "";
  // slug-rotated ask examples (owner audit 2026-07-16): the writer copies the example it sees, so
  // showing every reel the same one shipped the identical CTA line 14/14 — a mass-produced-content
  // fingerprint. Rotation gives per-video variation while every variant still matches the lint pattern.
  const askExamples = rotatedExamples(engage?.goal || "comments", article.slug || "");
  const sys = SYS
    .replace("{ENDING_GUIDANCE}", engage?.family?.writerGuidance || "end with a genuine question the audience wants to answer, then invite them to answer it in the comments")
    .replace("{ASK_EXAMPLES}", (askExamples.length ? askExamples : ['"Let us know in the comments below."']).join(" or "));
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
      // real sentences (the flow prompt tempts it to return one flowing paragraph), then
      // MERGE any spurious mid-phrase break (a sentence ending on a word that can't end one)
      // so the voice never pauses mid-thought at the start.
      sentences: mergeMidPhraseBreaks(
        (res.sentences || [])
          .flatMap((s) => String(s).split(/(?<=[.!?…])\s+/))
          .map((s) => s.trim())
          .filter(Boolean),
      ),
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
  const MECH = new Set(["too-long", "duration", "hook-too-long", "sentence-too-long", "repetition"]);
  // CHAINED REPAIR (2026-07-24): under the tighter 22-30s caps a script often fails with mechanical
  // AND ending violations together — the mechanical trim runs first, and any remaining ending-only
  // violations fall through to the ending repair below (which then sees the TRIMMED script).
  if (lastScript && violations.length && violations.every((v) => MECH.has(v.rule) || v.rule.startsWith("ending"))
      && violations.some((v) => MECH.has(v.rule))) {
    let s = [...lastScript.sentences];
    // 0) a repeated body line is deterministically fixable — DROP the later sentence of each
    //    repeated pair (the linter reports "sentences X and Y repeat …"; Y is the later one).
    //    Never drop the hook (0) or the ending pair (last 2). (owner 2026-07-12)
    const dropIdx = new Set();
    for (const v of violations) {
      if (v.rule !== "repetition") continue;
      const m = String(v.detail).match(/sentences \d+ and (\d+)/);
      if (m) { const y = parseInt(m[1], 10) - 1; if (y > 0 && y < s.length - 2) dropIdx.add(y); }
    }
    if (dropIdx.size) s = s.filter((_, i) => !dropIdx.has(i));
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
    // 1.5) split any mid-body sentence that runs over the spoken length cap, at a natural
    //      break — a long line should be split, never held. The ending pair is left to its
    //      own beat; a sentence carrying a verbatim quote is left whole (can't break a quote).
    const SENT_CAP = 18;
    s = s.flatMap((sent, i) => {
      if (i >= s.length - 2 || normWords(sent).length <= SENT_CAP) return [sent];
      if (/["“'‘][^"”'’]{10,}["”'’]/.test(sent)) return [sent];
      const m = sent.match(/^(.{12,}?)\s*[,;:—–]\s+(.+)$/);
      if (m) return [m[1].replace(/[,;:—–]\s*$/u, "") + ".", m[2]];
      const w = sent.split(/\s+/);
      const cut = Math.ceil(w.length / 2);
      return [w.slice(0, cut).join(" ").replace(/[,;:]+$/u, "") + ".", w.slice(cut).join(" ")];
    });
    // 2) converge: drop body sentences until BOTH the total is under the word ceiling AND no
    //    body line is still over the sentence cap (an un-splittable quote — Dolly Parton's 152w
    //    held because a 21-word quote line could not be split and was never trimmed). Prefer
    //    dropping the over-cap line; else the last body line. Hook + ending pair stay intact.
    const cap = IG?.script?.maxWords ?? 136;
    const minW = IG?.script?.minWords ?? 88;
    const durCeil = (IG?.script?.maxSec ?? 44) + (IG?.script?.durTolSec ?? 3);
    // the "duration" lint fires on the estimate (words/wps + inter-sentence pauses + endcard tail); the
    // repair must CONVERGE on it too, or a word-legal-but-slightly-long script would HOLD instead of trim
    // (review 2026-07-16). Match lint.mjs's estimate exactly.
    const estOver = (arr) => estimateSeconds(normWords(arr.join(" ")).length) + Math.max(0, arr.length - 1) * (IG?.voice?.tighten?.keepSilence ?? 0.26) + (IG?.endTailSec ?? 1.8) > durCeil;
    const overIdx = (arr) => arr.findIndex((sent, i) => i > 0 && i < arr.length - 2 && normWords(sent).length > SENT_CAP);
    let guard = 0;
    // trim body sentences until word-cap AND sentence-cap AND duration are all satisfied — but NEVER below
    // minWords (that would just swap an over-length hold for a too-short hold). Hook + ending pair stay intact.
    while ((normWords(s.join(" ")).length > cap || overIdx(s) >= 0 || estOver(s)) && normWords(s.join(" ")).length > minW && s.length > 6 && guard++ < 24) {
      const oi = overIdx(s);
      s.splice(oi >= 0 ? oi : s.length - 3, 1);
    }
    const trimmed = { ...lastScript, sentences: s };
    const still = [...lintScript(trimmed, facts.entities, `${article.title} ${facts.storyOneLine || ""}`), ...lintEnding(trimmed.sentences, engage?.goal || "comments")];
    if (!still.length) return { script: trimmed, attempts: 3, trimmed: true };
    // hand the trimmed script + remaining violations to the ending repair below
    lastScript = trimmed;
    violations = still;
  }
  // DETERMINISTIC ENDING REPAIR: if the story cleared every CONTENT gate and ONLY the ending
  // PHRASING is off, BUILD a complete valid ending — drop any trailing ask, GUARANTEE the audience
  // question (comments goal), then append the canonical ask — so a good story never HOLDS on ending
  // phrasing. ROOT CAUSE of the 3-of-7-per-day shortfall (owner 2026-07-15): the old repair swapped in
  // the ask but NEVER supplied the question, so every "ending-ask + ending-question" story held
  // (Chris Pratt, the Beckhams, 90 Day Fiancé all held this way). Ship-instead-of-hold: the writer
  // already had 3 tries at a bespoke question; this is the safety net, not the first choice.
  if (lastScript && violations.every((v) => v.rule.startsWith("ending"))) {
    const goal = engage?.goal || "comments";
    // slug-rotated canonical (owner audit 2026-07-16) — the repair path was stamping the SAME line on
    // every repaired reel; rotation keeps even the safety-net endings varied.
    const canonical = (rotatedExamples(goal, article.slug || "")[0] || engage?.family?.examples?.[0] || '"Let us know in the comments below."').replace(/^"|"$/g, "");
    const s = [...lastScript.sentences];
    // drop a trailing ask-ish line (broadened so more malformed asks are removed, not left in place)
    if (/\b(save|send|show|comment|bookmark|let us know|tell us|drop|sound off|hit the|link in|check (it|this)|follow us)\b/i.test(s[s.length - 1] || "")) s.pop();
    // comments goal: the line before the ask MUST be an audience question — if the tail isn't one,
    // append a short on-topic question anchored to the lead entity (a valid ship beats a hold).
    if (goal === "comments" && !/\?\s*$/.test((s[s.length - 1] || "").trim())) {
      const who = String(facts.entities?.[0]?.name || "").trim();
      s.push(who ? `What's your take on ${who}?` : "What's your take on this?");
    }
    s.push(canonical);
    // stay under BOTH ceilings (words AND estimated duration) — the appended ending can push either
    // over, and a "duration"-only violation after the repair would HOLD a good story (the same trap
    // fixed in the mechanical repair; resurfaced under the tighter 22-30s format). (2026-07-24)
    const cap = IG?.script?.maxWords ?? 105;
    const minW2 = IG?.script?.minWords ?? 70;
    const ceil2 = (IG?.script?.maxSec ?? 32) + (IG?.script?.durTolSec ?? 3);
    const estOver2 = (arr) => estimateSeconds(normWords(arr.join(" ")).length) + Math.max(0, arr.length - 1) * (IG?.voice?.tighten?.keepSilence ?? 0.26) + (IG?.endTailSec ?? 0.9) > ceil2;
    let g = 0;
    while ((normWords(s.join(" ")).length > cap || estOver2(s)) && normWords(s.join(" ")).length > minW2 && s.length > 5 && g++ < 24) s.splice(s.length - 3, 1);
    const repaired = { ...lastScript, sentences: s };
    const still = [...lintScript(repaired, facts.entities, `${article.title} ${facts.storyOneLine || ""}`), ...lintEnding(repaired.sentences, goal)];
    if (!still.length) return { script: repaired, attempts: 3, repairedEnding: true };
  }
  return { script: null, attempts: 3, hold: `script failed lint after 3 attempts: ${violations.map((v) => `${v.rule}(${v.detail?.slice(0, 60)})`).join(", ")}` };
}
