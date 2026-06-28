// BASE GROUNDING — the Wikipedia-free replacement for lib/wikipedia.mjs gatherFacts (owner rule 2026-06-28:
// no Wikimedia anywhere). Grounds the PRIMARY ENTITY by TYPE, complementing the rest of run.mjs:
//   • PERSON (profile/interview/celebrity)  → TMDB person bio + dated filmography (getPersonFacts).
//   • MUSIC ARTIST (music-profile/news)      → Deezer catalog (interim until PR6 MusicBrainz/Discogs/Last.fm).
//   • TITLE / general                        → nothing here; the AUTHORITATIVE TITLE FACTS block (run.mjs, with
//                                              the TMDB overview/themes added 2026-06-28) + the breaking-event
//                                              facts from topic.sources already ground it. No Wikipedia extract.
// Returns the SAME [{title, extract}] shape the old gatherFacts did, so generate.mjs/gate.mjs are untouched.
import { getPersonFacts, personFactsBlock } from "./tmdb.mjs";
import { musicArtistFacts, musicFactsBlock } from "./music.mjs";

function isPersonTopic(topic) {
  const ft = (topic.formatTag || "").toLowerCase();
  const cat = (topic.category || "").toLowerCase();
  if (["profile", "interview"].includes(ft)) return true;
  if (cat === "celebrity") return true;
  return false;
}

// `topic` (not an entities array). Stashes topic._person for downstream reuse (profile awards).
export async function gatherFacts(topic) {
  const out = [];
  const entity = topic.primaryEntity || topic.title;
  if (!entity) return out;
  const cat = (topic.category || "").toLowerCase();
  const ft = (topic.formatTag || "").toLowerCase();

  // MUSIC ARTIST → full music grounding (MusicBrainz discography + Last.fm popularity + Discogs catalog +
  // Billboard Hot 100 chart). TMDB/OMDb have no music data; this is the PR6 stack (non-Wikimedia).
  if (cat === "music" && (ft === "music-profile" || ft === "music-news")) {
    const m = await musicArtistFacts(entity);
    if (m) { topic._music = m; out.push({ title: "AUTHORITATIVE MUSIC FACTS", extract: musicFactsBlock(m) }); }
    return out;
  }

  // PERSON → TMDB biography + birth/death + dated filmography (replaces the Wikipedia bio extract).
  if (isPersonTopic(topic)) {
    const p = await getPersonFacts(entity);
    if (p) { topic._person = p; out.push({ title: "AUTHORITATIVE PERSON FACTS", extract: personFactsBlock(p) }); }
    return out;
  }

  // TITLE / general → grounded elsewhere in run.mjs (authoritative title block + breaking-event facts). No
  // Wikipedia base extract; the writer's plot depth comes from the TMDB overview + themes in that block.
  return out;
}
