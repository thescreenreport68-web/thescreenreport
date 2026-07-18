// GOSSIP — PROSE GUARDS (2026-07-18 audit fixes B, C). Deterministic sentence-level cuts that run on
// every article body at polish time. Publish-everything is preserved: the guards REPAIR (cut the
// offending sentence), they never hold an article.
//
//   B. SCAFFOLDING BAN — internal verification language must never ship as prose. A live article
//      contained: "The performance was a confirmed event, covered by outlets including TMZ and
//      Yahoo Sports. Every joke mentioned was part of the publicly broadcast monologue."
//   C. ABSENCE-CLAIM BAN — an absence is a claim. A live FAQ asserted "the documents do not specify
//      her age" (they said 15); a live closing said "Neither has commented" (they had). The pipeline
//      cannot verify negatives, so it must not assert them. (The structured whatWeDont list is the
//      designed home for unknowns and is exempt.)

export const SCAFFOLD_RE = /\b(was a confirmed event|covered by outlets including|part of the publicly (broadcast|televised)|according to (the|our) verification|the claims? (was|were|have been) verified|cross-referenced (with|against)|this (article|story) was produced|verified against the (bundle|sources)|all (facts|quotes) (were|have been) (checked|verified))\b/i;

export const ABSENCE_RE = /\b((neither|none of them|no one|nobody) (has|have) (commented|responded|spoken|confirmed)|has not (publicly )?(commented|responded|addressed|confirmed)|did not (immediately )?respond to (a )?request|not publicly known|not immediately clear|remains unclear (whether|if|what)|do(es)? not specify|no details (have|were|have been) (provided|released|given)|declined to (comment|respond)|(are|is) not known at this time)\b/i;

// Abbreviation-safe sentence splitting: never split after a single-capital initial ("David H. Koch")
// or a common title abbreviation — the naive split truncated a live lede at "the David H."
const ABBREV_END = /(\b[A-Z]|\b(?:Mr|Mrs|Ms|Dr|Jr|Sr|St|vs|No|Inc|Ltd|U\.S|U\.K))\.$/;
export function splitSentences(text) {
  const rough = String(text || "").split(/(?<=[.!?]["”']?)\s+/);
  const out = [];
  for (const part of rough) {
    if (out.length && ABBREV_END.test(out[out.length - 1])) out[out.length - 1] += " " + part;
    else out.push(part);
  }
  return out;
}

function cutMatching(body, re) {
  const cut = [];
  const paras = String(body || "").split(/\n{2,}/).map((para) => {
    if (/^#{1,6}\s/.test(para.trim())) return para; // headings untouched
    const kept = splitSentences(para).filter((s) => {
      if (re.test(s)) { cut.push(s.trim().slice(0, 110)); return false; }
      return true;
    });
    return kept.join(" ").trim();
  }).filter(Boolean);
  return { body: paras.join("\n\n"), cut };
}

/** Cut leaked pipeline scaffolding sentences. Returns { body, cut[] }. */
export function cutScaffolding(body) { return cutMatching(body, SCAFFOLD_RE); }

/** Cut unverifiable absence claims from prose. Returns { body, cut[] }. */
export function cutAbsenceClaims(body) { return cutMatching(body, ABSENCE_RE); }

/** FAQ filter: drop any answer that asserts an absence — ensureFaq backfills from real facts. */
export function dropAbsenceFaq(faq = []) {
  const kept = [], dropped = [];
  for (const f of faq) {
    if (f && f.a && ABSENCE_RE.test(f.a)) dropped.push(f.q);
    else kept.push(f);
  }
  return { faq: kept, dropped };
}

// Relative-time reference with NO absolute date anywhere in the body → the stale-time defect
// ("that evening" about a two-day-old event). Detection only — the fix is a surgical correction pass.
const RELTIME_RE = /\b(that (evening|night|morning|day)|last night|tonight|earlier today|this (morning|evening|afternoon))\b/i;
const ABSDATE_RE = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}\b|\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i;
export function relativeTimeUnanchored(body) {
  const m = String(body || "").match(RELTIME_RE);
  if (!m) return null;
  return ABSDATE_RE.test(body) ? null : m[0];
}
