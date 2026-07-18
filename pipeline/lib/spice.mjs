// spice.mjs — ENGAGEMENT/SPICE scoring layer (owner directive 2026-07-18, Odyssey week).
// The owner's mandate: celebrity-said-THIS quote news and genuinely contested stories are a PRIORITY
// content stream, not filler — "they said this, they said that" press-tour beats around a tentpole are
// exactly what readers click. This lib is the single home for the spice classes so FIND admission
// (findrun), ranking (score.mjs) and tests all share one definition.
//
// HARD LINE (unchanged, non-negotiable): spice is DETECTED in the sourced headline, never manufactured.
// The writer may only amplify tension that verifiably exists — all fact/quote/date anchors still apply.

// Verbal-conflict / bold-statement class — the "celebrity said this" stream (strongest signal).
export const SPICY_QUOTE = /\b(slams?|blasts?|rips (into )?|fires? back|claps? back|calls? out|hits? back|snaps? at|shades?|mocks?|torches|breaks? silence|speaks? out|finally (addresses|responds)|responds? to (critics|backlash|rumors)|defends?|denies|refuses? to|walks? back|apologizes?|admits?|confesses|reveals? (why|how|what|the truth)|gets? (brutally )?honest|doesn'?t hold back|warns?|shuts? down|dismisses|rejects)\b/i;
// Contested-situation class — feuds, backlash, splits, exits with friction.
export const CONTROVERSY = /\b(feud|backlash|controversy|outrage|slammed|criticized|under fire|divides?|divided|sparks? (debate|outrage|backlash)|fans? (are )?(furious|divided|split)|drama|clash(es)?|tension|fallout|scandal)\b/i;
// Bold-revelation class — softer but still a hook.
export const REVELATION = /\b(shock(s|ing|ed)?|stuns?|surpris(es|ing)|bombshell|unexpected(ly)?|never (knew|told)|secret|behind[- ]the[- ]scenes (drama|conflict|battle)|almost (quit|died|turned down)|turned down|walked (away|off)|nearly)\b/i;

// Score bonus for the ranking layer: conflict-quote beats revelation beats mild controversy-mention.
// Capped +10 so spice TIL TS priority but never outranks a true Tier-S hard-news event on spice alone.
export function spiceBonus(title) {
  const t = String(title || "");
  let b = 0;
  if (SPICY_QUOTE.test(t)) b += 7;
  if (CONTROVERSY.test(t)) b += 4;
  if (REVELATION.test(t)) b += 3;
  return Math.min(10, b);
}

// FIND admission: a quote/interview-style headline IS news when it carries a spicy verb — "Zendaya slams…",
// "Tom Holland admits…", "Damon breaks silence on…". Only flat evergreen chat ("reflects on her career")
// stays out. Used by findrun's interview guard as the exemption.
export const isSpicy = (title) => SPICY_QUOTE.test(String(title || "")) || CONTROVERSY.test(String(title || ""));
