// spice.mjs — ENGAGEMENT layer for the NEWS lane, SCOPED BY THE OWNER'S BEAT RULE (2026-07-19).
//
// 🔴 THE BEAT RULE (owner, verbatim intent — read this before touching anything here):
//   NEWS owns the ACTUAL NEWS: a film greenlit, a series ordered, cast added, a director attached
//   ("Nolan's next movie and its cast"), renewals, trailers, deals — plus work-related CONFLICT
//   (feuds, backlash, on-set/production drama) WHEN IT IS GENUINELY BIG NEWS.
//   NEWS does NOT own celebrity STATEMENTS/OPINIONS — politics, race, social causes, "star speaks
//   out about X". A separate CELEBRITY-STATEMENT automation owns that beat. Leave it alone unless
//   the story is so big it is unmistakably front-page news.
//
// This file therefore does two jobs:
//   1. spiceBonus()  — a MODEST ranking nudge for genuine work-related conflict, so a real feud or
//      a casting backlash outranks a flat announcement. It is a tie-breaker, not a content strategy.
//   2. isStatementBeat() — identifies opinion/statement stories that belong to the OTHER lane, so
//      FIND can decline them instead of competing.
//
// HARD LINE (unchanged): spice is DETECTED in the sourced headline, never manufactured. Every
// fact/quote/date anchor still applies to a spicy article exactly as to a flat one.

// ── IN SCOPE: conflict that is about the WORK ───────────────────────────────────────────────────
// Feuds, exits, firings, recasts, on-set trouble, backlash against a casting/creative decision.
// These are production stories that happen to be spicy — they are news first.
export const WORK_CONFLICT = /\b(feud|clash(es|ed)?|fired|axed|ousted|exits?|quits?|walks? off|recast|replaced|dropped from|pulled from|shut down|halted|delayed indefinitely|scrapped|shelved|lawsuit|sues?|suing|legal battle|injunction|on-set (incident|accident|clash|tension)|behind[- ]the[- ]scenes (drama|conflict|battle|clash)|creative differences|backlash over (the )?(casting|recast|trailer|ending|design|decision)|fans? (revolt|slam|blast) (the )?(casting|trailer|design|ending))\b/i;

// A revelation that reframes a project — still work news, mild boost.
export const PROJECT_REVELATION = /\b(almost (cast|played|directed|quit)|turned down|nearly (quit|cast)|was (originally|first) (cast|offered)|cut from|deleted (scene|role)|reshoots?|scrapped ending|alternate ending|secret (role|cameo)|hidden)\b/i;

// ── OUT OF SCOPE: the celebrity-STATEMENT beat (a separate automation owns this) ─────────────────
// Opinion/commentary pieces: what a person THINKS about a topic, especially politics/social issues.
// Detected so FIND can decline them — not to rank them.
export const STATEMENT_TOPIC = /\b(politic(s|al)|election|president|senator|congress|parliament|vote[sd]?|campaign|palestine|israel|gaza|ukraine|russia|immigration|abortion|racism|racist|antisemit|islamophob|transphob|homophob|lgbtq|gender identity|climate change|gun (control|violence)|vaccine|religion|feminis[mt]|woke|cancel culture|social justice|black lives matter|me ?too)\b/i;
export const STATEMENT_VERB = /\b(speaks? out|spoke out|opens? up about|weighs? in on|slams?|blasts?|calls? out|hits? back|claps? back|fires? back|responds? to|reacts? to|defends?|condemns?|criticiz(es|ed)|shares? (her|his|their) (thoughts|views|opinion)|gets? candid|breaks? silence|addresses? (the )?(backlash|criticism|rumors|controversy))\b/i;

// TRUE when a headline is really an opinion/statement piece → the statement lane's beat, not ours.
// A work-conflict signal (a feud over a film, a firing, a lawsuit) OVERRIDES: that is still our news.
export const isStatementBeat = (title) => {
  const t = String(title || "");
  if (WORK_CONFLICT.test(t)) return false;                 // conflict about the work stays with news
  if (STATEMENT_TOPIC.test(t)) return true;                // politics/social commentary → theirs
  return STATEMENT_VERB.test(t) && !PROJECT_REVELATION.test(t); // "X slams/speaks out" with no work hook
};

// ── ranking nudge (kept deliberately small) ─────────────────────────────────────────────────────
// Max +6 (was +10 when this lane was briefly chasing drama). A genuine feud or backlash should edge
// out an identical-freshness flat announcement — it must never outrank a bigger real story.
export function spiceBonus(title) {
  const t = String(title || "");
  if (isStatementBeat(t)) return 0;                        // not our beat → no boost at all
  let b = 0;
  if (WORK_CONFLICT.test(t)) b += 4;
  if (PROJECT_REVELATION.test(t)) b += 2;
  return Math.min(6, b);
}

// Kept for the FIND interview guard: a quote-driven headline is admissible ONLY when the quote is
// attached to work conflict/revelation — never for a pure opinion piece.
export const isSpicy = (title) => spiceBonus(title) > 0;
