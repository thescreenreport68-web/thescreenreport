// STAGE: SCRIPT ENGINE v3 (owner-approved master plan 2026-07-03; research: SCRIPT_RESEARCH.json).
// UNIVERSAL by design: one retention skeleton × 9 GENRE playbooks — the writer classifies the story's
// genre, applies that playbook, and is enforced for FREE: an in-call SELF-VERIFY checklist + a
// deterministic code PRE-GATE with one guided regeneration (owner 2026-07-03: no paid judge). ACCURACY RAILS UNCHANGED: facts only from the
// (already verify-gated) article, one story only, no invented quotes/numbers/dates.
import { chat } from "../lib/openrouter.mjs";
import { VIDEO } from "./config.mjs";

const SYS = `You write 30-40 second spoken scripts for The Screen Report's vertical news videos (energetic female narrator, karaoke captions). You write TOLD STORIES for the ear — never compressed articles.

═══ THE SKELETON (hard structure, ~2.7 words/sec) ═══
BEAT 1 · HOOK [0-3s] 1 line, 8-13 words: the story's single most extreme concrete detail. No greeting, date, source, or setup. Withhold exactly ONE key noun (the who, the how-much, or the why) so the viewer needs beat 2.
BEAT 2 · GROUND [3-9s] 1-2 lines: answer ONLY what the hook planted. Reuse a noun/pronoun from the hook.
BEAT 3 · RE-HOOK [~10s] 1 line, 8-12 words: a second escalation — bigger number, contradiction, or open loop. (Banned in death/tribute.)
BEAT 4 · DEVELOP [12-26s] 3-4 lines: the substance — quote, numbers, timeline — ordered by ASCENDING surprise, each line a BUT/SO consequence of the previous ("and then" chains are banned). The one direct quote goes here.
BEAT 5 · TURN [25-33s] 1-2 lines: the complication or why-it-matters.
BEAT 6 · CLOSE [33-40s] 1-2 lines: pay off the hook's loop, THEN one forward-looking gap tied to a real date/decision OR an opinion-bait question. Final sentence ≤8 words. NEVER "follow for more" / any generic outro — the last 2 seconds must still be information. End the CTA-ish line with "Full story at The Screen Report, link in bio." folded in naturally BEFORE the final kicker question when possible.

═══ GENRE PLAYBOOKS (classify first, then obey) ═══
casting: lead with the MORE famous noun (role vs actor), withhold the other until beat 2; credibility beat; fan-debate kicker.
boxoffice: NEVER open with the raw number — open with the VERDICT (record/upset/disaster); numbers only land against an anchor (budget, rival, record).
quote: lead with the spiciest 3-6 words of the quote itself; attribution trails.
death: REGISTER EXCEPTION — somber, name-first, no teasing, no withholding, no opinion-bait, no exclamation.
trailer: shared-stakes direct address ("If you were waiting for…").
evergreen: superlative + time anchor ("still #1 after 66 years").
controversy: conflict verb in the first 5 words (sued, banned, fired, refused).
nostalgia: "X years ago today…" + a today-connection.
awards: superlative + recency; who got snubbed = the kicker.

═══ STYLE LAWS ═══
Present tense. Active concrete verbs ("walked off set", not "a departure occurred"). One idea per sentence, ≤15 words, punch 3-5-word sentences after long ones. Second person where natural. Numbers rounded FOR THE EAR ("almost two hundred million", never "$198.4M"). Attribution once, trailing, gossip-style: "— that's per Variety." Narrator reacts like a sharp friend, not a wire service.
HARD BANS: greetings; "today we're talking about"; background before the event; passive voice; "According to X," as an opener; "and then"; "reportedly" more than once; "iconic", "beloved", "fans are excited", "in a surprising turn of events"; encyclopedia phrasing ("It follows X doing Y"); two consecutive sentences of similar length; any line adding no new fact.

═══ ACCURACY RAILS (non-negotiable) ═══
Use ONLY facts stated in the article. ONE story. No invented quotes/numbers/dates. Keep attribution for surprising claims. Death/tragedy → somber register throughout.

═══ SELF-VERIFY BEFORE ANSWERING (mandatory — fix silently, then output) ═══
Audit your draft against EVERY item; rewrite any failing line before you answer:
1. Total words 80-105 (HARD max 110); hook ≤13 words; final sentence ≤8 words.
2. Hook contains the story's most extreme concrete detail + exactly ONE withheld noun. No greeting/date/source.
3. Between every pair of adjacent lines you can insert BUT or SO and it reads naturally (no "and then" lists).
4. Every line adds one NEW fact — delete any line that only rephrases.
5. At least one 3-6 word punch sentence; no two consecutive sentences of similar length.
6. Facts ordered by ASCENDING surprise; the best fact lands at ~75-85% of the script.
7. The ending pays off the hook's loop AND opens a forward gap or question. No generic outro.
8. Zero banned phrases; attribution (if any) trails once, gossip-style.
9. Genre playbook obeyed (death = somber register, no teasing, no question ending).
10. Every named person/title in every line appears in that line's visual.entities.

═══ OUTPUT CONTRACT ═══
- "say" = voice text (respell hard names phonetically: "Saoirse"→"Sur-sha"); "show" = same line, correct spelling.
- "emphasis": per line, the 1-3 surprise-carrying words (must appear in "show").
- "visual" per line: {"about":"single|group|primary","entities":[{"kind":"person|title|character","name":"...","ofTitle":"..."}]} — entities MUST include EVERY person and title NAMED in that line's say text (miss one and the screen shows the wrong thing). "character" = actor as role, ofTitle = the production.
- Captions: instagram (2-3 lines + 8-12 COMPLETE hashtags), facebook (conversational + question), pinterest {title<=90, description<=350}, youtube {title<=90 incl #Shorts, description}, x (<=230 chars, 1-2 complete hashtags, NO link).
Return ONLY the JSON.`;

const SHAPE = `{"genre":"casting|boxoffice|quote|death|trailer|evergreen|controversy|nostalgia|awards",
 "hook":{"say":"...","show":"...","emphasis":["..."],"visual":{...}},
 "lines":[{"say":"...","show":"...","emphasis":["..."],"visual":{...}}, ...7-11 lines following the skeleton...],
 "onScreenTitle":"<=38 chars kicker",
 "captions":{"instagram":"...","facebook":"...","pinterest":{"title":"...","description":"..."},"youtube":{"title":"...","description":"..."},"x":"..."}}`;

// ═══ PHASE 1 ACCURACY LAYER (owner 2026-07-03: quotes + claims are existential) ═══════════════
// All pure functions — unit-testable without API calls.
export function sliceAtSentence(t, max) {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max * 0.6 ? cut.slice(0, end + 1) : cut; // never cut mid-sentence unless the tail is huge
}
const normQ = (x) => String(x).toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
// THE QUOTE VAULT: every quoted span in the ARTICLE. Script quotes must be exact substrings of these.
export function extractQuotes(article) {
  const out = [];
  for (const m of String(article).matchAll(/[“"]([^”"]{8,400})[”"]/g)) out.push(normQ(m[1]));
  return out;
}
const scriptQuotes = (line) => [...String(line || "").matchAll(/[“"]([^”"]{4,400})[”"]/g)].map((m) => m[1]);
// Returns violations; a quote not found VERBATIM in the vault is a violation (the writer is NEVER asked
// to edit a quote — salvage strips the quote framing instead; see salvage()).
export function quoteCheck(data, vault) {
  const bad = [];
  for (const l of [data.hook, ...(data.lines || [])]) {
    for (const q of [...scriptQuotes(l?.say), ...scriptQuotes(l?.show)]) {
      const nq = normQ(q);
      if (nq.split(" ").length >= 3 && !vault.some((v) => v.includes(nq))) bad.push(`quote not verbatim from the article: "${q.slice(0, 60)}"`);
    }
  }
  return bad;
}
// THE CLAIM GATE: hard specifics in the script (digits, money, %, years) must exist in the article.
const numbersIn = (t) => {
  const out = [];
  for (const m of String(t).matchAll(/\$?([\d,]+(?:\.\d+)?)\s*(million|billion|trillion|[MBK]\b|%|)/gi)) {
    let v = parseFloat(m[1].replace(/,/g, ""));
    const u = (m[2] || "").toLowerCase();
    if (u.startsWith("m")) v *= 1e6; else if (u.startsWith("b")) v *= 1e9; else if (u.startsWith("t")) v *= 1e12; else if (u === "k") v *= 1e3;
    if (!isNaN(v)) out.push(v);
  }
  return out;
};
export function claimCheck(data, article) {
  const ref = numbersIn(article);
  const bad = [];
  for (const l of (data.lines || []).concat([data.hook])) {
    for (const v of numbersIn(l?.show || "")) {
      if (v <= 12) continue; // small counts/ordinals are stylistic, not checkable specifics
      const year = v >= 1900 && v <= 2100 && Number.isInteger(v);
      const ok = ref.some((r) => (year ? r === v : Math.abs(r - v) <= Math.max(r, v) * 0.03));
      if (!ok) bad.push(`unsupported number ${v} in line: "${String(l.show).slice(0, 50)}"`);
    }
  }
  return bad;
}
// SALVAGE: never rewrite a quote — strip unvaulted quote framing; DROP lines with unsupported numbers.
export function salvage(data, vault, article) {
  const d = JSON.parse(JSON.stringify(data));
  const fix = (l) => {
    for (const key of ["say", "show"]) {
      for (const q of scriptQuotes(l?.[key])) {
        if (!vault.some((v) => v.includes(normQ(q))) && normQ(q).split(" ").length >= 3)
          l[key] = l[key].replace(new RegExp(`[“"]\\s*${q.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&")}\\s*[”"]`), q); // de-quote, words stay as reporting
      }
    }
  };
  fix(d.hook);
  d.lines.forEach(fix);
  const refBad = new Set(claimCheck(d, article).map((b) => b.slice(b.indexOf('"'))));
  d.lines = d.lines.filter((l) => ![...refBad].some((b) => b.includes(String(l.show).slice(0, 50))));
  return d;
}

// ── deterministic PRE-GATE (free; research benchmark spec D) — returns [] when clean
export function preGate(data) {
  const bad = [];
  const all = [data.hook, ...(data.lines || [])];
  const spoken = all.map((l) => l?.say || "").join(" ");
  const words = (spoken.match(/\b[\w']+\b/g) || []).length;
  if (words < 75 || words > 112) bad.push(`word count ${words} outside 75-112 (over = video runs past 40s)`);
  const hookWords = (String(data.hook?.say || "").match(/\b[\w']+\b/g) || []).length;
  if (hookWords > 14) bad.push(`hook is ${hookWords} words (max 14)`);
  const BANNED = /\b(welcome|hey guys|hey everyone|today we(?:'re| are) talking|in recent news|it should be noted|fans are excited|as previously reported|in a surprising turn|and then|iconic|beloved)\b/i;
  for (const l of all) if (BANNED.test(String(l?.say || "").replace(/[“"][^”"]*[”"]/g, ""))) bad.push(`banned phrase in: "${String(l.say).slice(0, 60)}"`); // quoted spans exempt — a quote is NEVER rewritten
  if (/^according to/i.test(String(data.hook?.say || ""))) bad.push("hook opens with attribution");
  const last = String(all[all.length - 1]?.say || "");
  if ((last.match(/\b[\w']+\b/g) || []).length > 14) bad.push("final line too long (>14 words)");
  if (/follow (us|for more)/i.test(spoken)) bad.push('generic "follow for more" outro');
  if (/\bit follows\b|\bthe film follows\b|\bthe series follows\b/i.test(spoken)) bad.push("encyclopedia phrasing ('it follows X')");
  const lens = all.map((l) => (String(l?.say || "").match(/\b[\w']+\b/g) || []).length);
  if (!lens.some((n) => n <= 6)) bad.push("no short punch sentence (need one ≤6 words)");
  const tail = all.slice(-2).map((l) => l?.say || "").join(" ");
  if (data.genre === "death") {
    // register exception (Phase 2): an obituary must NEVER end on opinion-bait or hype
    if (/\?/.test(tail)) bad.push("death story must not end with a question");
    if (/!/.test(spoken)) bad.push("death story must not contain exclamations");
  } else if (!/\?|will\b|decides?\b|next\b|soon\b|watch\b/i.test(tail)) bad.push("ending opens no forward gap or question");
  return bad;
}


async function generate({ title, dek, body, category, model, feedback = "" }) {
  const article = `TITLE: ${title}\nDEK: ${dek || ""}\nCATEGORY: ${category || ""}\n\n${sliceAtSentence(String(body || ""), 6500)}`;
  const user = `Write the video script JSON for this article:\n\n${article}\n${feedback ? `\nEDITOR NOTES FROM THE LAST DRAFT (obey them):\n${feedback}\n` : ""}\nJSON shape:\n${SHAPE}`;
  const { data } = await chat({ model, system: SYS, user, json: true, maxTokens: 2800, temperature: 0.6 });
  if (!data?.hook?.say || !Array.isArray(data.lines) || data.lines.length < 5) throw new Error("script: bad shape");
  // Phase 3: per-line hardening — no line may ever speak "undefined" or caption "UNDEFINED"
  const fixLine = (l) => {
    if (!l || typeof l.say !== "string" || !l.say.trim()) return null;
    l.say = l.say.trim();
    l.show = typeof l.show === "string" && l.show.trim() ? l.show.trim() : l.say;
    l.emphasis = Array.isArray(l.emphasis) ? l.emphasis.filter((e) => typeof e === "string") : typeof l.emphasis === "string" ? [l.emphasis] : [];
    return l;
  };
  if (!fixLine(data.hook)) throw new Error("script: hook malformed");
  data.lines = data.lines.map(fixLine).filter(Boolean);
  if (data.lines.length < 5) throw new Error("script: too few valid lines");
  if (typeof data.onScreenTitle === "string" && data.onScreenTitle.length > 38)
    data.onScreenTitle = data.onScreenTitle.slice(0, 38).replace(/\s+\S*$/, ""); // word-boundary truncate
  for (const l of [data.hook, ...data.lines]) {
    const v = l.visual;
    const ents = Array.isArray(v?.entities)
      ? v.entities.filter((e) => e && ["person", "title", "character"].includes(e.kind) && e.name)
          .map((e) => ({ kind: e.kind, name: String(e.name).trim(), ...(e.ofTitle ? { ofTitle: String(e.ofTitle).trim() } : {}) })).slice(0, 6)
      : [];
    l.visual = ents.length ? { about: ["single", "group", "primary"].includes(v.about) ? v.about : ents.length > 1 ? "primary" : "single", entities: ents } : null;
  }
  const spoken = [data.hook, ...data.lines].map((l) => l.say).join(" ");
  return { ...data, spoken, words: (spoken.match(/\b[\w']+\b/g) || []).length };
}

// generate → FREE code-gate → (one guided regeneration on violations) — no paid judge (owner 2026-07-03:
// the writer is hard-coded to the standard via the SELF-VERIFY block; code catches what slips; $0 enforcement)
export async function writeVideoScript({ title, dek, body, category, model = VIDEO.scriptModel }) {
  const vault = extractQuotes(body);
  const check = (d) => [...preGate(d), ...quoteCheck(d, vault), ...claimCheck(d, body)];
  let draft = await generate({ title, dek, body, category, model });
  let probs = check(draft);
  if (probs.length) {
    console.log(`  script regeneration (${probs[0]}${probs.length > 1 ? " +" + (probs.length - 1) : ""})`);
    // NOTE: quote violations regenerate with a no-quotes instruction — the writer is never told to edit a quote
    const fb = probs.map((g) => (g.startsWith("quote") ? "- VIOLATION: a quote was not verbatim — write this script WITHOUT any direct quotes" : `- VIOLATION: ${g}`));
    const second = await generate({ title, dek, body, category, model, feedback: [...new Set(fb)].join("\n") });
    const p2 = check(second);
    if (!p2.length) { draft = second; probs = []; }
    else {
      const best = p2.length <= probs.length ? second : draft;
      const rescued = salvage(best, vault, body);
      const p3 = check(rescued);
      const spoken3 = [rescued.hook, ...rescued.lines].map((l) => l.say).join(" ");
      const w3 = (spoken3.match(/\b[\w']+\b/g) || []).length;
      if (p3.length || rescued.lines.length < 5 || w3 < 70) throw new Error(`script gate BLOCKED story: ${(p3[0] || "too thin after salvage")}`); // videorun skips to next candidate
      rescued.spoken = spoken3; rescued.words = w3;
      draft = rescued; probs = [];
    }
  }
  return { ...draft, gate: [] };
}
