// GOSSIP — CLAIM GUARD (2026-07-25 review fixes). The hole this closes:
//
//   quoteGuard checks QUOTED text. factGuards check NUMBERS and NAMES. Nothing checked ordinary
//   declarative prose — so the safest-looking part of an article was airtight while the sentences
//   around it were unguarded. A live review found four fabrications, all unquoted:
//     • "The camera panned in … her voice steady, her eyes clear … She leaned forward, not for drama,
//       but for truth."      → nobody watched the video; the pipeline only had a text write-up.
//     • "She's in therapy."  → the source said TREATMENT. A different claim, on a health story.
//     • "Fans were quick to notice her absence … speculation was minimal."  → invented audience.
//     • "Since then, WABI and other outlets have echoed the news."          → invented corroboration.
//
//   ROOT CAUSE of the last two: both phrases were copied out of the WRITER'S OWN PROMPT. The system
//   prompt listed "fans were quick to notice" as an approved gossip idiom, and used "WABI"/"WMUR" as
//   example outlet names in a rule about attribution. The model treated its instructions as material.
//   Those two are fixed at the source in writer.mjs; this module is the net underneath.
//
// DOCTRINE (unchanged): guards REPAIR, they never hold. Invented observation is FLAGGED first so the
// writer can rebuild the lede from real bundle detail (a cut lede is a worse article than a fixed one);
// anything still ungrounded after that pass is CUT. Crowd reaction and phantom outlets are cut outright.
import { splitSentences } from "./proseGuards.mjs";

export const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Corpus = every word we actually gathered, normalised once. */
export function corpusOf(bundle) {
  const parts = [
    ...(bundle?.sources || []).map((s) => s.text || ""),
    ...(bundle?.quotes || []),
    ...((bundle?.details?.facts) || []),
    ...((bundle?.details?.quotes) || []).map((q) => q?.text || ""),
    ...((bundle?.background?.whoTheyAre) || []),
  ];
  return norm(parts.join(" \n "));
}

// A phrase is grounded if a distinctive run of it appears in what we gathered.
export function groundedPhrase(phrase, corpus, { min = 10 } = {}) {
  const t = norm(phrase);
  if (!t || t.length < min) return true;               // too short to judge — don't cut on noise
  if (corpus.includes(t)) return true;
  const toks = t.split(" ").filter((w) => w.length > 3);
  if (!toks.length) return true;
  return toks.filter((w) => corpus.includes(w)).length / toks.length >= 0.85;
}

// ── A. INVENTED OBSERVATION ────────────────────────────────────────────────────────────────────────
// Physical manner, facial/vocal detail, camera work, room atmosphere. The pipeline reads TEXT. It has
// never seen a face or a room, so any of this that is not in the source is invention by definition.
export const OBSERVATION_RE = new RegExp([
  "\\b(?:her|his|their|the)\\s+(?:voice|eyes?|face|gaze|tone|hands?|smile|expression|posture|jaw)\\b(?![^.?!]{0,20}\\bsaid\\b)",
  "\\bthe camera\\s+(?:panned|zoomed|cut|lingered|caught|found|held)",
  "\\b(?:lean(?:ed|ing)|sat|settled|shifted)\\s+(?:forward|back|in|across|closer|upright)\\b",
  "\\b(?:did(?:n't| not)|never)\\s+(?:flinch|blink|hesitate|waver)\\b",
  "\\bthe room\\s+(?:fell|went|held)\\s+(?:silent|quiet|still)",
  "\\b(?:paused|hesitated|took a breath|steadied herself|steadied himself)\\b",
  "\\bwith (?:a|an) (?:calm|steadiness|stillness|quiet|ease|smile|composure) that\\b",
  "\\b(?:landing|landed|hung|hanging) like\\b",
  "\\bnot for (?:drama|effect|show), but\\b",
].join("|"), "i");

// ── B. INVENTED PUBLIC REACTION ────────────────────────────────────────────────────────────────────
// A claim about what an audience did or felt is a claim. We can only make it if we gathered it.
export const CROWD_RE = new RegExp([
  "\\bfans?\\s+(?:were quick to|rushed|flooded|erupted|lit up|took to|wondered|noticed|speculated|are wondering|began)",
  "\\b(?:social media|the internet|timelines?|comment sections?)\\s+(?:erupted|exploded|lit up|reacted|went)",
  "\\bspeculation (?:was|has been|remained)\\s+(?:minimal|rampant|rife|limited|quiet)",
  "\\b(?:commenters|viewers|followers|the public)\\s+(?:were|was|noticed|wondered|rushed|flooded|speculated)",
  "\\b(?:many|some|most) (?:fans|viewers|followers|readers)\\s+(?:wondered|noticed|assumed|believed|thought)",
].join("|"), "i");

// ── C. PHANTOM CORROBORATION ───────────────────────────────────────────────────────────────────────
// Naming an outlet we never gathered — "WABI and other outlets have echoed the news" — manufactures
// corroboration. Broadcast call signs (W/K + 2-4 letters) and known mastheads only, and only when the
// sentence is actually making an attribution claim, so ordinary prose is never touched.
const CALLSIGN_RE = /\b[WK][A-Z]{2,4}(?:-TV)?\b/g;
const MASTHEAD_RE = /\b(?:TMZ|People|PEOPLE|Page Six|Us Weekly|E! News|Variety|Deadline|Billboard|Rolling Stone|The Sun|Daily Mail|Hollywood Reporter|Entertainment Tonight|ET Online|Complex|Pitchfork|Vulture|HuffPost|BuzzFeed|Reuters|AP|Associated Press|CNN|NBC|ABC|CBS|Fox News|BBC)\b/g;
const ATTRIBUTION_CTX = /\b(?:told|per|reports?|reported|according to|echoed|confirmed to|first reported|writes|noted|cited|citing|and other outlets)\b/i;

// 2026-07-25 — a live run flagged "Page Six" as unsourced when Page Six WAS the source. Exact-match
// lookup could not see it: the outlet arrives as a URL ("pagesix.com/2026/...") as often as a display
// name, and "pagesixcom2026" never equals "pagesix". Match as a SUBSTRING of everything we know about
// the sources instead. A false positive here deletes real attribution, so this side must be generous.
function outletHaystack(bundle) {
  const parts = [];
  for (const s of bundle?.sources || []) for (const piece of [s.outlet, s.url, s.title]) if (piece) parts.push(String(piece));
  return norm(parts.join(" ")).replace(/ /g, "");
}

/** Outlet names asserted in prose that we never actually gathered. */
export function unsourcedOutlets(body, bundle) {
  const known = outletHaystack(bundle);
  const corpus = corpusOf(bundle).replace(/ /g, "");
  const hits = new Map();
  for (const para of String(body || "").split(/\n{2,}/)) {
    if (/^#{1,6}\s/.test(para.trim())) continue;
    for (const unit of splitSentences(para)) {
      if (!ATTRIBUTION_CTX.test(unit)) continue;
      const masked = unit.replace(/["“][^"”]*["”]/g, " ");   // never judge inside a quote
      for (const m of [...(masked.match(CALLSIGN_RE) || []), ...(masked.match(MASTHEAD_RE) || [])]) {
        const key = norm(m).replace(/ /g, "");
        if (!key || known.includes(key)) continue;      // it IS one of our sources
        if (corpus.includes(key)) continue;              // named inside the text we gathered
        if (!hits.has(m)) hits.set(m, unit.trim().slice(0, 140));
      }
    }
  }
  return [...hits.entries()].map(([outlet, sentence]) => ({ outlet, sentence }));
}

// ── the cutter ─────────────────────────────────────────────────────────────────────────────────────
function cutBy(body, test, protect = []) {
  const cut = [];
  const paras = String(body || "").split(/\n{2,}/).map((para) => {
    if (/^#{1,6}\s/.test(para.trim())) return para;
    const kept = [];
    for (const unit of splitSentences(para)) {
      if (protect.some((p) => p && unit.includes(p))) { kept.push(unit); continue; }
      const parts = unit.split(/(?<=[.!?]["”']?)\s+/);
      const survivors = parts.filter((p) => {
        const why = test(p);
        if (!why) return true;
        cut.push(`${why}: ${p.trim().slice(0, 110)}`);
        return false;
      });
      if (survivors.length) kept.push(survivors.join(" "));
    }
    return kept.join(" ").trim();
  }).filter(Boolean);
  return { body: paras.join("\n\n"), cut };
}

// A sentence that CARRIES a verbatim quote is reporting the source's own words — judge only the prose
// around it, never delete a real quote because its framing tripped a pattern.
const stripQuotes = (t) => String(t).replace(/["“][^"”]*["”]/g, " ");

/**
 * Cut invented public reaction and phantom-outlet attribution. Returns { body, cut[] }.
 * Anything the sources actually contain survives — this only removes claims we cannot trace.
 */
export function cutUngroundedClaims(body, bundle, protect = []) {
  const corpus = corpusOf(bundle);
  const phantom = new Set(unsourcedOutlets(body, bundle).map((x) => x.outlet));
  return cutBy(body, (sentence) => {
    const prose = stripQuotes(sentence);
    if (CROWD_RE.test(prose) && !groundedPhrase(prose.match(CROWD_RE)[0], corpus)) return "invented public reaction";
    for (const o of phantom) if (sentence.includes(o)) return `unsourced outlet (${o})`;
    return null;
  }, protect);
}

/** Cut invented observation. Run this only AFTER the surgical pass has had its chance to repair. */
export function cutInventedObservation(body, bundle, protect = []) {
  const corpus = corpusOf(bundle);
  return cutBy(body, (sentence) => {
    const prose = stripQuotes(sentence);
    const m = prose.match(OBSERVATION_RE);
    if (!m) return null;
    return groundedPhrase(m[0], corpus, { min: 6 }) ? null : "invented observation";
  }, protect);
}

/** FLAG invented observation for the surgical pass (repair beats deletion for a lede). */
export function inventedObservations(body, bundle) {
  const corpus = corpusOf(bundle);
  const out = [];
  for (const para of String(body || "").split(/\n{2,}/)) {
    if (/^#{1,6}\s/.test(para.trim())) continue;
    for (const unit of splitSentences(para)) {
      const m = stripQuotes(unit).match(OBSERVATION_RE);
      if (m && !groundedPhrase(m[0], corpus, { min: 6 })) out.push({ phrase: m[0].trim(), sentence: unit.trim().slice(0, 160) });
    }
  }
  return out;
}

/**
 * Build surgical-fix instructions from everything above. Empty array = nothing to repair.
 * These go through the SAME correction path as every other deterministic trigger.
 */
export function claimFixIssues(body, bundle) {
  const issues = [];
  for (const { phrase, sentence } of inventedObservations(body, bundle).slice(0, 4)) {
    issues.push(`INVENTED OBSERVATION — "${phrase}" in: "${sentence}". We only ever read a TEXT report; we did not watch this, so we cannot describe a face, a voice, a gesture, a camera move, or a room. Rewrite that sentence using only what the sources actually state, or cut it.`);
  }
  for (const { outlet, sentence } of unsourcedOutlets(body, bundle).slice(0, 3)) {
    issues.push(`UNSOURCED OUTLET — "${outlet}" is named as reporting or echoing this story in: "${sentence}". That outlet is not among our sources. Name only outlets that appear in the bundle, or cut the attribution.`);
  }
  return issues;
}
