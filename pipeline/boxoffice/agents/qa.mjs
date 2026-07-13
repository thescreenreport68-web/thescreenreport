// AGENT 7 — QA / JUDGE. One job: verify EVERYTHING before publish (plan §10).
//  (1) DETERMINISTIC FIDELITY WALLS (free): number-fidelity + no-invention + scope + platform +
//      word/FAQ floors. An unsupported figure → CUT the sentence (owner cut-don't-hold). A
//      draft saturated with cuts (>4) holds.
//  (2) THE ENGAGEMENT JUDGE (gemini-2.5-flash, temp 0): readability/engagement/humanVoice — the
//      owner's KPI — with soft floors + correction flags the writer can act on.
import { numberFidelity, noInvention, platformGuard, buildAllowed, stripUnsupportedSentences, firstCleanSentence, normMoney } from "../moneyGuard.mjs";
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
const GROUNDING_RULE = ` \nFABRICATION CHECK (critical): you are also given GROUNDED FACTS. Add an "ungrounded" array to your JSON
listing EVERY specific claim in the article NOT supported by those facts — an invented plot/premise detail,
a SETTING or LOCATION, any NAMED person not in the cast list, a comparison to another film/filmmaker, an
audience-reaction claim ("moved to tears", "everyone's talking"), a TREND/rise/drop/decline not backed by the
numbers given, or unattributed analysis/opinion ("analysts say", "questions are being raised"). Copy the exact
offending phrase. Empty array if the article invents nothing. This is the accuracy backbone — be thorough.`;

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
    numbers: gathered.numbers || [],
    moneyStrings: [...(boxData.moneyStrings || []), ...(gathered.numbers || [])],
    pcts: [gathered.dropPct].filter(Boolean),
    counts: [gathered.theaters].filter(Boolean),
  });
  // Auto-repair the two derived short fields the shared cutter can't touch (dek/metaDescription): drop
  // any sentence with an unsupported figure so a wrong number there is REMOVED, never dead-held. The
  // body/keyTakeaways/faq figures still route to cutClaims below (cutArticle clears those).
  if (article) for (const f of ["dek", "metaDescription"]) {
    if (!article[f]) continue;
    const cleaned = stripUnsupportedSentences(article[f], allowed);
    if (cleaned !== article[f]) article[f] = cleaned || firstCleanSentence(body, allowed);
  }
  const nf = numberFidelity(article, allowed);
  cutClaims.push(...nf.cutClaims);

  // NO-INVENTION WALL — split / record the source never stated.
  const ni = noInvention(article, { hasSplitNumber: gathered.hasSplit, hasRecord: (gathered.records || []).length > 0 });
  cutClaims.push(...ni.cutClaims);

  // PLATFORM GUARD — NOW-STREAMING + streaming forms must name only a confirmed platform (Netflix for
  // the Netflix Top 10 forms, or a TMDB-confirmed provider). Prevents "now on Disney+" when it's Netflix.
  if (angle.form === "NOW-STREAMING" || (FORMS[angle.form] || {}).streaming) {
    const allowPlat = [...(boxData.providers?.stream || []), ...(boxData.providers?.rent || []), ...(boxData.providers?.buy || []),
      ...(gathered.platform ? [gathered.platform] : [])];
    const pg = platformGuard(article, allowPlat);
    if (!pg.ok) hardBlocks.push(`platform: names ${pg.bad.join(", ")} not in confirmed providers`);
  }

  // SELF-HEDGE / AI meta-commentary → CUT the sentence (a pro never doubts its own facts in print).
  cutClaims.push(...hedgeCuts(body));
  // UNATTRIBUTED SPECULATION / unnamed "analysts say / questions are being raised" → CUT.
  cutClaims.push(...speculationCuts(body));
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

  // A draft saturated with unsupported figures/claims is not salvageable-by-cutting.
  const uniqueCuts = [...new Set(cutClaims.filter((c) => (c || "").length > 8))];
  if (uniqueCuts.length > 4) hardBlocks.push(`fidelity: ${uniqueCuts.length} unsupported figures/claims — draft-level failure`);

  // Floors.
  if (words < Math.min(form.words[0], 180)) hardBlocks.push(`words ${words} < ${Math.min(form.words[0], 180)} (owner-set ~200-word minimum)`);
  if ((article?.faq || []).filter((f) => f?.q && f?.a).length < 2) hardBlocks.push("seo-faq: fewer than 2 real FAQs");
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

  let j = { score: 0, subscores: {}, strengths: [], weaknesses: [] };
  // A scope/platform/draft-level failure is fatal — don't spend a judge call.
  const fatal = hardBlocks.some((b) => /^scope|^platform|draft-level failure/.test(b));
  if (!fatal) {
    // GROUNDED FACTS — everything the article is allowed to say. Anything else the judge flags as
    // `ungrounded` → cut. This is what stops the thin-source writer inventing plot/setting/cast/reactions.
    const g = job.gathered || {}, bd = job.boxData || {};
    const castList = [...new Set([...(bd.cast || []), ...(g.cast || [])])].filter(Boolean);
    const grounded = [
      castList.length ? `Cast (the ONLY real names that may appear): ${castList.join(", ")}` : "Cast: none provided — do NOT name any actors/crew.",
      bd.director ? `Director: ${bd.director}` : "",
      g.narrative ? `Source narrative (the only plot/context there is): ${g.narrative}` : "No plot/premise/setting provided — do NOT describe a plot or a setting/location.",
      (g.numbers || []).length ? `Reported figures: ${(g.numbers || []).join("; ")}` : "",
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
