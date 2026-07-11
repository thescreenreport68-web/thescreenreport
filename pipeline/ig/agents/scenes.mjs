// SCENE DIRECTOR (REV 3, plan §11.5 #1): maps every sentence to the subjects the audio
// is talking about at that moment — including multi-name beats (2-4 subjects together)
// and event beats. Deterministic (entity-name token matching + event keywords) — no LLM,
// no spend, fully testable offline.
import { normWords } from "../lib/util.mjs";

const EVENT_HINT_RE =
  /\b(wedding|ceremony|vows|reception|premiere|red carpet|award|awards|oscars|emmys|globes|festival|comic.?con|set|filming|shoot|concert|tour|funeral|memorial|gala|afterparty|after-party)\b/i;

// tokens that identify an entity in spoken text (surname alone counts: "Kelce cried")
function entityTokens(e) {
  return normWords(e.name).filter((t) => t.length > 2);
}

export function subjectsInSentence(sentence, entities) {
  const words = new Set(normWords(sentence));
  const hits = [];
  for (const e of entities) {
    const tokens = entityTokens(e);
    if (!tokens.length) continue;
    if (tokens.some((t) => words.has(t))) hits.push(e.name);
  }
  return hits;
}

// beats: one per sentence window — {i, t0, t1, subjects[], kind}
// kind: "single" | "duo" | "group" | "event" | "carry" (no subject named → carry the story's flow)
export function buildBeats({ sentences, windows, entities }) {
  const eventEntity = entities.find((e) => e.kind === "event");
  const beats = [];
  for (let i = 0; i < sentences.length; i++) {
    const win = windows[i] || windows[windows.length - 1] || { t0: 0, t1: 0 };
    let subjects = subjectsInSentence(sentences[i], entities);
    let kind;
    const mentionsEvent =
      (eventEntity && subjects.includes(eventEntity.name)) || EVENT_HINT_RE.test(sentences[i]);
    if (mentionsEvent && eventEntity) {
      // the event owns the beat; people named alongside ride in the hero strip
      subjects = [eventEntity.name, ...subjects.filter((s) => s !== eventEntity.name)].slice(0, 4);
      kind = "event";
    } else if (subjects.length >= 3) {
      subjects = subjects.slice(0, 4);
      kind = "group";
    } else if (subjects.length === 2) {
      kind = "duo";
    } else if (subjects.length === 1) {
      kind = "single";
    } else {
      kind = "carry";
    }
    beats.push({ i, t0: win.t0, t1: win.t1, subjects, kind, text: sentences[i] });
  }
  // carry beats inherit the previous beat's subjects (the audio is still on that thread)
  for (let i = 0; i < beats.length; i++) {
    if (beats[i].kind === "carry" && i > 0 && beats[i - 1].subjects.length) {
      beats[i].subjects = beats[i - 1].subjects.slice(0, 1);
    }
  }
  return beats;
}
