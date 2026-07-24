// SCENE DIRECTOR (REV 3, plan §11.5 #1): maps every sentence to the subjects the audio
// is talking about at that moment — including multi-name beats (2-4 subjects together)
// and event beats. Deterministic (entity-name token matching + event keywords) — no LLM,
// no spend, fully testable offline.
import { normWords } from "../lib/util.mjs";

// STRONG event words only. "set", "filming", "shoot", "tour" were REMOVED (owner 2026-07-12):
// they appear in ordinary movie-news sentences ("one before filming", "on the set") and were
// binding beats to hollow, imageless "event" entities (e.g. a "2008 Vanity Fair interview" that
// then owned a third of the video with no picture). An event owns a beat only on an unambiguous
// event word — or when the event entity itself is named.
const EVENT_HINT_RE =
  /\b(wedding|ceremony|vows|reception|premiere|red carpet|award|awards|oscars|emmys|globes|festival|comic.?con|concert|funeral|memorial|gala|afterparty|after-party)\b/i;

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
    // PEOPLE FIRST (owner 2026-07-12): a named PERSON always owns the beat — people have real
    // photos; a hard-to-image EVENT (a private wedding has NO photo, so its "image" resolves to
    // news-coverage = a reporter's face) must NEVER hijack a beat just because the sentence says
    // "wedding". The event image only owns a beat when NO person is named in that sentence.
    const people = eventEntity ? subjects.filter((s) => s !== eventEntity.name) : subjects;
    if (people.length >= 3) {
      subjects = people.slice(0, 4);
      kind = "group";
    } else if (people.length === 2) {
      subjects = people;
      kind = "duo";
    } else if (people.length === 1) {
      subjects = people;
      kind = "single";
    } else if (eventEntity && (subjects.includes(eventEntity.name) || EVENT_HINT_RE.test(sentences[i]))) {
      // The beat is about the event but names no person. Show the PEOPLE the event is ABOUT — a
      // wedding IS its couple — instead of a generic "event" image (a private event has no photo,
      // so it resolves to news-coverage = a reporter). Use the event entity itself only if it
      // names nobody (then a real public-event photo, e.g. a premiere, is legitimate). (2026-07-12)
      const ev = eventEntity.name.toLowerCase();
      const eventPeople = entities.filter((e) => e.kind !== "event" && entityTokens(e).some((t) => t.length > 2 && ev.includes(t)));
      if (eventPeople.length) {
        subjects = eventPeople.slice(0, 4).map((e) => e.name);
        kind = eventPeople.length >= 3 ? "group" : eventPeople.length === 2 ? "duo" : "single";
      } else {
        subjects = [eventEntity.name];
        kind = "event";
      }
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
