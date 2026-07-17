// AGENT 7 — QA / JUDGE. One job: verify EVERYTHING before publish (plan §10).
//  (1) DETERMINISTIC FIDELITY WALLS (free): number-fidelity + no-invention + scope + platform +
//      word/FAQ floors. An unsupported figure → CUT the sentence (owner cut-don't-hold). A
//      draft saturated with cuts (>4) holds.
//  (2) THE ENGAGEMENT JUDGE (gemini-2.5-flash, temp 0): readability/engagement/humanVoice — the
//      owner's KPI — with soft floors + correction flags the writer can act on.
import { numberFidelity, noInvention, platformGuard, streamingClaimGuard, buildAllowed, stripUnsupportedSentences, firstCleanSentence, normMoney } from "../moneyGuard.mjs";
import { FORMS, GATE, SCOPE_JUNK, scopeOk } from "../config.bo.mjs";
import { agentChat } from "../models.mjs";

// Generic meta headings telegraph the template — banned + machine-detected (owner rule shared across lanes).
const TEMPLATE_H = /^##\s*(why (is )?(this|it) (happening|matter)|how (are|did) .*react|what (does|is) .*mean|who is everyone talking about|what'?s next|what happened)\b/i;
export function findTemplateHeadings(body) {
  return (String(body || "").match(/^##\s.*$/gm) || []).filter((h) => TEMPLATE_H.test(h.trim()));
}

// SELF-HEDGE / AI-TELL / accuracy-meta-commentary — a professional reporter NEVER writes this. Any
// sentence that admits uncertainty about its OWN facts (or sounds like an AI) is CUT (owner cut-don't-hold),
// so a draft that hedged still publishes clean. Legit journalistic attribution ("reportedly", "according
// to") is deliberately NOT matched.
const HEDGE_RE = /\b(as an ai|i (cannot|can'?t|do not|don'?t) (have|verify|confirm|know)|i'?m not (sure|certain)|pinpoint accurate|not (always |entirely |fully |100% )?(pinpoint )?accurate|take (this|it|these|that) with a grain of salt|grain of salt|details (aren'?t|are not|may not be|might not be|can be|are not always) (always )?(pinpoint |entirely |fully )?accurate|may not be (entirely |fully |100% )?accurate|details (are|remain|may be) (fuzzy|murky|unclear|sketchy|hazy)|the exact details (are|remain|may be))\b/i;
export function hedgeCuts(body) {
  return String(body || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s && HEDGE_RE.test(s));
}

// DROP-CHARACTERIZATION — a weekend drop over ~45% is NOT a "strong hold". Flag the spin as a FIXABLE
// correction so the writer re-characterizes it honestly (under 35% = strong hold / 35-45 = solid hold /
// 45-55 = notable drop / over 55 = steep fall).
const HOLD_SPIN_RE = /\b(strong(ly)? (hold|holding|staying power|legs)|holding (strong|up (well|strong)|well)|impressive hold|great hold|holds? (well|strong)|minimal (drop|dip)|barely (dropped|dipped)|excellent hold|remarkable hold)\b/i;
export function dropSpin(body, dropPct) {
  const n = parseFloat(String(dropPct ?? "").replace("%", ""));
  if (!Number.isFinite(n) || n <= 45) return null;
  return HOLD_SPIN_RE.test(String(body || ""))
    ? `drop-spin: a ${Math.round(n)}% weekend drop is a ${n > 55 ? "steep fall" : "notable drop"}, not a "strong hold" — re-characterize it honestly`
    : null;
}

// FORBIDDEN PROFIT/LOSS VERDICTS — the pipeline must NEVER compute a profitability conclusion from
// budget-vs-gross (4/9 live articles shipped "faces a significant theatrical loss" / "on track for
// profitability" / "clawing close to recouping"). Deterministic → CUT, all forms, no exceptions.
const PROFIT_RE = /\b(recoup(s|ed|ing)?|profitab(le|ility)|theatrical (loss|profit)|break[- ]?even|on track (for|to) (a )?(profit|loss|profitability)|face(s|d)? (a )?(significant |steep |major |substantial )?(theatrical )?loss(es)?|(indicat|represent|suggest)(es|ing)? a (significant |steep |major |substantial )?loss|significant loss|substantial loss|mitigate losses|financial miss(es)?|less than half (of )?(its|the) (production )?(cost|budget)|box[- ]office (disappointment|bomb|flop|failure|miss)|lose money|losing money|in the (red|black)|write[- ]?(down|off))\b/i;
// UNSOURCED AUDIENCE/RECEPTION VERDICTS — "franchise fatigue", "audiences are hesitant", "failed to
// connect" with NO named source is invention (9/9 live articles carried these as fact under
// storyStatus: CONFIRMED). Attributed reception (a named outlet/score) is journalism and stays.
const AUDIENCE_VERDICT_RE = /\b(franchise fatigue|audience fatigue|remake fatigue|audiences? (are|were|seem|seems|remain|remains|appear|may)s? (be )?(hesitant|reluctant|divided|cool|lukewarm|skeptical|experiencing)|struggl(es|ed|ing) to (connect|capture|win|resonate|differentiate)|fail(s|ed|ing) to (connect|resonate|win over|capture)|word[- ]of[- ]mouth|dampen(ed|ing)? (enthusiasm|attendance|turnout)|winning over (audiences|moviegoers|critics)|resonat(es|ed|ing) (strongly |deeply )?with (audiences|viewers|moviegoers)|audiences (are )?(flocking|turning out|staying away)|(strong|robust|weak|soft) (audience )?(word[- ]of[- ]mouth|repeat viewings?)|fell (far )?below (studio )?expectations|below (studio )?expectations|weak (start|opening|debut)|rough (financial )?waters|underperform(s|ed|ing)?|reception suggests?|cultural phenomenon)\b/i;
// Both classes are ATTRIBUTION-RESCUED: "Variety reports the film is underperforming" is journalism and
// stays; the SAME sentence with no named source is our own invented verdict and is cut. Split per LINE
// first so a verdict inside a markdown HEADING is cut atomically.
export function verdictCuts(body) {
  return String(body || "").split(/\n+/).flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((s) => s.trim())
    .filter((s) => s && (PROFIT_RE.test(s) || AUDIENCE_VERDICT_RE.test(s)) && !ATTRIBUTED_RE.test(s)).slice(0, 12);
}

// UNATTRIBUTED SPECULATION / ANALYSIS — a professional attributes analysis to a NAMED source; "analysts
// say / industry analysis suggests / questions are being raised" with no name is editorializing → CUT.
const SPECULATION_RE = /\b(industry analysis suggests|analysts? (say|suggest|believe|note|argue|point|caution|warn)|experts? (say|suggest|believe|argue|note)|questions? (are|is) being raised|raising (questions|concerns|red flags|eyebrows|doubts)|it'?s believed|it is believed|widely believed|reports? suggest|sources? (say|suggest|indicate|claim)|many (are )?(wondering|speculating|speculate)|there is speculation|speculation (is|has|about)|critics? argue|pundits?|some (say|argue|believe|wonder)|is believed to|are believed to)\b/i;
export function speculationCuts(body) {
  return String(body || "").split(/(?<=[.!?])\s+/).map((s) => s.trim())
    .filter((s) => s && SPECULATION_RE.test(s)).slice(0, 10);
}

// UNSUPPORTED viewership TREND — a "drop / decline / erosion" claim needs a PRIOR-WEEK number to compare;
// a streaming snapshot holds ONLY this week, so an UNATTRIBUTED trend claim is invented → CUT the sentence.
const VIEW_TREND_RE = /\b(viewership|audience|ratings?|numbers?|hours?)\b[^.!?]*\b(drop|declin|erosion|plunge|slump|attrition|fall|falling|dropping|dwindl|shrink|down\b|slid|tumbl)|\b(drop|declin|fall|erosion|plunge|slump|slid)\b[^.!?]*\b(from (its|the|last|a) (first|previous|last|prior|season|debut)|viewership|audience|debut|premiere)/i;
const ATTRIBUTED_RE = /\b(nielsen|luminate|according to|per |variety|deadline|the hollywood reporter|thr\b|reported by|the numbers)\b/i;
export function trendCuts(body) {
  return String(body || "").split(/(?<=[.!?])\s+/).map((s) => s.trim())
    .filter((s) => s && VIEW_TREND_RE.test(s) && !ATTRIBUTED_RE.test(s)).slice(0, 10);
}

// FABRICATION CHECK appended to the judge — it gets the GROUNDED FACTS and returns an "ungrounded" list.
const GROUNDING_RULE = ` \nFABRICATION CHECK (critical): the GROUNDED FACTS above — the cast list, the premise/genre, the SOURCE REPORTING
prose, and the reported figures — are everything the article may draw on. Add an "ungrounded" array listing only
claims that are CONTRADICTED BY or ABSENT FROM all of that material: an invented plot/premise detail, a SETTING or
NAMED person that appears NOWHERE in the material, a comparison or audience-reaction the material doesn't support,
a TREND/rise/drop not backed by the figures, or unattributed analysis ("analysts say", "questions are being raised").
IMPORTANT: a name, a comparison, or a reception point that APPEARS IN THE SOURCE REPORTING is grounded — do NOT flag
it. Be precise, not trigger-happy — flag genuine fabrications only. Copy the exact offending phrase; empty array if
the article invents nothing. This is the accuracy backbone.`;

// The deterministic walls — pure, no LLM. Exported so the offline suite can exercise them directly.
export function fidelityLocks(job) {
  const { article, gathered = {}, boxData = {}, angle, film } = job;
  const form = FORMS[angle.form] || { words: [300, 550] };
  const body = article?.body || "";
  const words = body.split(/\s+/).filter(Boolean).length;
  const hardBlocks = [];
  const cutClaims = [];

  // SCOPE GUARD — Hollywood / English-language only.
  if (!scopeOk({ originalLanguage: film?.originalLanguage, title: film?.title, overview: film?.overview }))
    hardBlocks.push(`scope: "${film?.title}" is not Hollywood/English-language`);
  if (SCOPE_JUNK.test(body)) hardBlocks.push("scope: non-Hollywood box-office language in body");

  // NUMBER-FIDELITY WALL.
  const allowed = buildAllowed({
    // records carry the film's own real milestone figures ("crossed $1 billion", "passed Oppenheimer's $975.8M")
    // pulled from its coverage — allow them, else the fidelity wall cuts the milestone story into a draft-failure.
    numbers: [...(gathered.numbers || []), ...(gathered.records || [])],
    moneyStrings: [...(boxData.moneyStrings || []), ...(gathered.numbers || [])],
    pcts: [gathered.dropPct].filter(Boolean),
    counts: [gathered.theaters].filter(Boolean),
  });
  // Auto-repair the two derived short fields the shared cutter can't touch (dek/metaDescription): drop
  // any sentence with an unsupported figure so a wrong number there is REMOVED, never dead-held. The
  // body/keyTakeaways/faq figures still route to cutClaims below (cutArticle clears those).
  if (article) for (const f of ["dek", "metaDescription"]) {
    if (!article[f]) continue;
    let cleaned = stripUnsupportedSentences(article[f], allowed);
    // Also purge profit/audience VERDICT sentences from the short derived fields — a dek reading "faces a
    // steep box office disappointment" is the same invention as in the body, and cutArticle can't reach it.
    cleaned = String(cleaned || "").split(/(?<=[.!?])\s+/)
      .filter((s) => !(PROFIT_RE.test(s) || (AUDIENCE_VERDICT_RE.test(s) && !ATTRIBUTED_RE.test(s)))).join(" ").trim();
    if (cleaned !== article[f]) article[f] = cleaned || firstCleanSentence(body, allowed);
  }
  const nf = numberFidelity(article, allowed);
  cutClaims.push(...nf.cutClaims);

  // NO-INVENTION WALL — split / record the source never stated. Chart updates: records are SYSTEM-built
  // only (the milestone claim), so ANY record/ranking language in the profile prose is uncorroborated
  // ("6 highest grossing movie ever") → cut, regardless of what the gatherer scraped.
  const ni = noInvention(article, { hasSplitNumber: gathered.hasSplit, hasRecord: !film?.dailyChart && (gathered.records || []).length > 0 });
  cutClaims.push(...ni.cutClaims);

  // PLATFORM GUARD — NOW-STREAMING + streaming forms must name only a confirmed platform (Netflix for
  // the Netflix Top 10 forms, or a TMDB-confirmed provider). Prevents "now on Disney+" when it's Netflix.
  if (angle.form === "NOW-STREAMING" || (FORMS[angle.form] || {}).streaming) {
    const allowPlat = [...(boxData.providers?.stream || []), ...(boxData.providers?.rent || []), ...(boxData.providers?.buy || []),
      ...(gathered.platform ? [gathered.platform] : [])];
    const pg = platformGuard(article, allowPlat);
    if (!pg.ok) hardBlocks.push(`platform: names ${pg.bad.join(", ")} not in confirmed providers`);

    // STREAMING-AVAILABILITY GUARD — the "now streaming" = rent/buy bug. A streaming CLAIM must be backed by a
    // FLATRATE (subscription) provider, never rent/buy. Rent/buy-only "now streaming" language → cut those
    // sentences; a title/dek hinging on the false claim → HOLD (the writer reframes it as "available to rent/buy").
    const STREAMY = /netflix|\bmax\b|hbo|disney\s*\+|disney plus|hulu|prime video|amazon prime|apple tv\s*\+|apple tv plus|peacock|paramount\s*\+|paramount plus|starz|showtime/i;
    const flatrate = [...(boxData.providers?.stream || []),
      ...((gathered.platform && STREAMY.test(gathered.platform)) ? [gathered.platform] : [])];
    const sc = streamingClaimGuard(article, { flatrate });
    cutClaims.push(...sc.cuts);
    if (sc.hardWrong) hardBlocks.push(`streaming-claim: title/dek says "streaming" but only rent/buy is confirmed for this title — it is NOT on a subscription streaming service`);
  }

  // SELF-HEDGE / AI meta-commentary → CUT the sentence (a pro never doubts its own facts in print).
  cutClaims.push(...hedgeCuts(body));
  // UNATTRIBUTED SPECULATION / unnamed "analysts say / questions are being raised" → CUT.
  cutClaims.push(...speculationCuts(body));
  // PROFIT/LOSS verdicts + unsourced audience-reception verdicts → CUT (deterministic, all forms).
  cutClaims.push(...verdictCuts(body));
  // UNSUPPORTED viewership TREND on a streaming snapshot (we hold one week only) → CUT the invented "drop".
  if ((FORMS[angle.form] || {}).streaming) cutClaims.push(...trendCuts(body));
  // DROP mischaracterization → fixable correction (the writer re-characterizes; the number itself stays).
  const ds = dropSpin(body, gathered.dropPct);
  if (ds) hardBlocks.push(ds);

  // NUMBER RECONCILIATION — if the trade gave domestic + international + worldwide, they must add up. A
  // material mismatch means a mis-extracted/mixed figure; flag it (fixable) so we never publish numbers that
  // contradict each other.
  const dRaw = normMoney(gathered.domestic), iRaw = normMoney(gathered.international), wRaw = normMoney(gathered.worldwide);
  if (dRaw && iRaw && wRaw && Math.abs(dRaw + iRaw - wRaw) / wRaw > 0.12)
    hardBlocks.push(`reconcile: domestic+international ($${Math.round((dRaw + iRaw) / 1e6)}M) does not match worldwide ($${Math.round(wRaw / 1e6)}M) — present each figure as separately reported, never imply a sum`);

  // A draft saturated with unsupported figures/claims is not salvageable-by-cutting. Daily box-office UPDATES
  // get a higher bar: the cheap writer sprinkles invented figures into an otherwise-accurate, movie-heavy piece,
  // so we CUT them and let the (accurate, TMDB-sourced) movie section carry the article, rather than hold it —
  // the published result is clean either way (the cutter removes every flagged figure). The post-cut word floor
  // below still catches anything gutted too short.
  const uniqueCuts = [...new Set(cutClaims.filter((c) => (c || "").length > 8))];
  const cutCeiling = job.film?.dailyChart ? 8 : 4;
  if (uniqueCuts.length > cutCeiling) hardBlocks.push(`fidelity: ${uniqueCuts.length} unsupported figures/claims — draft-level failure`);

  // Floors.
  if (words < Math.min(form.words[0], 180)) hardBlocks.push(`words ${words} < ${Math.min(form.words[0], 180)} (owner-set ~200-word minimum)`);
  // NOTE: no FAQ hard-block here — assemble.ensureFaq deterministically backfills ≥2 REAL FAQs from the verified
  // facts, so every PUBLISHED article carries them. A pre-assemble writer FAQ check was falsely holding good drafts.
  for (const h of findTemplateHeadings(body)) hardBlocks.push(`template-heading: "${h.slice(0, 50)}" — rewrite story-specific`);

  return { words, hardBlocks, cutClaims: uniqueCuts, unsupported: nf.unsupported, invented: ni.blocks };
}

const RUBRIC = `Score this BOX-OFFICE article 0-100 with subscores 0-10: readability (short, scannable), engagement
(does the HOOK — star + number — grab and the structure PULL you down the page), humanVoice (lively trade voice,
zero corporate filler), curiosity, structure (opening→why→worldwide/budget→what's next), infoGain (does the
reader learn the money story), seo (honest title, ONE natural keyword, NOT over-optimized — over-optimization is
a DEFECT), faqQuality, completeness (uses the real figures, no padding), accuracy (numbers presented faithfully,
nothing overstated). Reward a strong stars-first hook + a clear why-up/why-down; punish dull number-dumps,
padding, keyword-stuffing. Score only — never rewrite. STRICT JSON: {"score":0,"subscores":{"readability":0,
"engagement":0,"humanVoice":0,"curiosity":0,"structure":0,"infoGain":0,"seo":0,"faqQuality":0,"completeness":0,
"accuracy":0},"strengths":[""],"weaknesses":[""]}`;

const STREAM_RUBRIC = `Score this STREAMING article 0-100 with subscores 0-10: readability, engagement (does the
HOOK — the title + its hours/rank — grab and PULL you down the page), humanVoice (lively, zero corporate filler),
curiosity, structure (what's #1 → the numbers → why it's popular → cast → what's next), infoGain (the reader learns
what's worth watching + how big it is), seo (honest title, ONE natural keyword, NOT over-optimized — over-optimization
is a DEFECT), faqQuality, completeness (uses the real Netflix hours/rank, no padding), accuracy (hours/rank presented
faithfully, nothing overstated). Reward a strong title-first hook + a clear why-it's-popular; punish dull number-dumps,
padding, keyword-stuffing. Score only — never rewrite. STRICT JSON: {"score":0,"subscores":{"readability":0,
"engagement":0,"humanVoice":0,"curiosity":0,"structure":0,"infoGain":0,"seo":0,"faqQuality":0,"completeness":0,
"accuracy":0},"strengths":[""],"weaknesses":[""]}`;

// review(job) → job.qa = { score, pass, hardBlocks, cutClaims, subscores, weaknesses }
export async function review(job, { chatImpl = null } = {}) {
  const det = fidelityLocks(job);
  const hardBlocks = [...det.hardBlocks];
  const cutClaims = [...det.cutClaims];

  // COST LEVER (§4.3, the 62%-of-spend fix): a chart UPDATE is gated by the FREE deterministic walls alone —
  // its numbers, title, metaTitle, takeaways, FAQs and numbers section are all SYSTEM-BUILT from canonical
  // figures, and the profile prose is screened by the fidelity/hedge/speculation/verdict cuts above. The LLM
  // judge adds nothing here but cost; it stays for FEATURE forms where engagement scoring earns its fee.
  if (job.film?.dailyChart) {
    const clean = hardBlocks.length === 0 && cutClaims.length === 0;
    job.qa = {
      score: clean ? 80 : 50, judged: false,
      pass: clean,
      subscores: {}, deterministic: det, hardBlocks, cutClaims, strengths: [], weaknesses: [],
    };
    return job;
  }

  let j = { score: 0, subscores: {}, strengths: [], weaknesses: [] };
  // A scope/platform/draft-level failure is fatal — don't spend a judge call.
  const fatal = hardBlocks.some((b) => /^scope|^platform|draft-level failure/.test(b));
  if (!fatal) {
    // GROUNDED FACTS — everything the article is allowed to say. Anything else the judge flags as
    // `ungrounded` → cut. This is what stops the thin-source writer inventing plot/setting/cast/reactions.
    const g = job.gathered || {}, bd = job.boxData || {};
    const castList = [...new Set([...(bd.cast || []), ...(g.cast || [])])].filter(Boolean);
    // The judge must see the SAME rich material the writer got — the full source reporting + TMDB
    // premise/genre — or it flags faithfully re-reported facts as "ungrounded" and cuts them, shrinking the
    // article back under the floor (the bug that held good drafts). A prose claim supported by this material
    // IS grounded. NUMBERS stay strict regardless: the deterministic numberFidelity wall above still requires
    // every figure to be in the extracted allowed set, so widening prose-grounding never loosens number safety.
    const sourceProse = (job.bundle?.sources || []).map((s) => (s.text || "").trim()).filter((t) => t.length > 40).join("\n\n").slice(0, 6000);
    const grounded = [
      castList.length ? `Cast (the ONLY real names that may appear): ${castList.join(", ")}` : "Cast: none provided — do NOT name any actors/crew.",
      bd.director ? `Director: ${bd.director}` : "",
      bd.overview ? `Premise (TMDB — grounded): ${bd.overview}` : "",
      bd.genres?.length ? `Genre (TMDB — grounded): ${bd.genres.join(", ")}` : "",
      bd.runtime ? `Runtime: ${bd.runtime} min` : "",
      g.narrative ? `Trade narrative: ${g.narrative}` : "",
      sourceProse ? `SOURCE REPORTING — any prose claim SUPPORTED BY this trade coverage is GROUNDED (do NOT flag it ungrounded); flag only claims that CONTRADICT or are ABSENT from ALL material here:\n${sourceProse}` : "",
      (!g.narrative && !sourceProse) ? "No plot/premise/setting provided — do NOT describe a plot or a setting/location." : "",
      (g.numbers || []).length ? `Reported figures (the ONLY numbers allowed): ${(g.numbers || []).join("; ")}` : "",
      (g.platform || (bd.providers?.stream || []).length) ? `Platform: ${g.platform || (bd.providers.stream || []).join(", ")}` : "",
    ].filter(Boolean).join("\n");
    try {
      const { data } = await agentChat("qa", {
        system: ((FORMS[job.angle.form] || {}).streaming ? STREAM_RUBRIC : RUBRIC) + GROUNDING_RULE,
        user: `GROUNDED FACTS (everything the article may state — anything else is fabrication):\n${grounded}\n\nARTICLE JSON:\n${JSON.stringify({ title: job.article.title, dek: job.article.dek, body: job.article.body, keyTakeaways: job.article.keyTakeaways, faq: job.article.faq }, null, 1).slice(0, 16000)}`,
      }, chatImpl ? { chatImpl } : {});
      if (data?.score != null) j = data;
      const ungrounded = Array.isArray(data?.ungrounded) ? data.ungrounded.filter((x) => typeof x === "string" && x.trim().length > 6).slice(0, 8) : [];
      if (ungrounded.length) {
        cutClaims.push(...ungrounded); // cut the fabricated sentences → publish clean
        j.weaknesses = [...(j.weaknesses || []), ...ungrounded.map((u) => `ungrounded — remove: "${u.slice(0, 80)}"`)]; // + tell the writer (fallback)
      }
    } catch { /* judge outage → score 0 → held, never auto-published */ }
    const s = j.subscores || {};
    for (const k of ["readability", "engagement", "humanVoice"]) {
      if (s[k] != null && s[k] < 5) hardBlocks.push(`soft-floor ${k} ${s[k]} < 5`);
    }
  }

  job.qa = {
    score: j.score || 0,
    pass: (j.score || 0) >= GATE.publishMin && hardBlocks.length === 0 && cutClaims.length === 0,
    subscores: j.subscores || {},
    deterministic: det,
    hardBlocks,
    cutClaims,
    strengths: j.strengths || [],
    weaknesses: j.weaknesses || [],
  };
  return job;
}

// Fixable = engagement soft-floors + template headings + FAQ gap; everything else is a hard stop.
export function classifyBlocks(blocks) {
  const fixable = blocks.filter((b) => /^soft-floor|^template-heading|^seo-faq|^drop-spin|^reconcile/.test(b));
  const block = blocks.filter((b) => !fixable.includes(b));
  return { block, fixable };
}
