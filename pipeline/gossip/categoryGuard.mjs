// GOSSIP — CATEGORY GUARD (deterministic backstop). The #1 categorization failure is a NON-musician (a reality
// star / actor) mislabeled "musician" by the LLM and filed under Music — a category mix-up that hurts SEO. Only a
// genuine recording artist has a Deezer/MusicBrainz artist entry, so when a Music-routed person can't be confirmed
// as a musician we correct the route to Celebrity. FAIL-SAFE: any lookup outage ⇒ trust the categorizer (we only
// override on a CONFIRMED non-musician, never on uncertainty).
import { deezerExists, musicbrainzArtist } from "../lib/music.mjs";
import { routeBySubject } from "./config.gossip.mjs";

// true = confirmed musician; false = confirmed NOT a musician; null = unknown (outage → don't touch).
export async function musicianVerified(name, { deezerImpl = deezerExists, mbImpl = musicbrainzArtist } = {}) {
  if (!name) return null;
  try {
    if ((await deezerImpl(name)) > 5000) return true; // a real, popular Deezer artist (fan count guards name collisions)
    if (await mbImpl(name)) return true;              // in the authoritative open music encyclopedia
    return false;
  } catch {
    return null;
  }
}

// Returns a corrected subjectType ("celebrity") when a Music route can't be confirmed as a real musician; else null.
export async function correctSubjectType(topic, deps = {}) {
  const route = routeBySubject(topic?.subjectType);
  if (route.category !== "music" || !topic?.primaryEntity) return null; // only guards the Music lane
  const ok = await musicianVerified(topic.primaryEntity, deps);
  return ok === false ? "celebrity" : null; // override ONLY on a confirmed non-musician
}
