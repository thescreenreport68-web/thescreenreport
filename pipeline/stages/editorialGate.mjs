// EDITORIAL GATE (Stage 3.5, 2026-07-03 restructure) — the single most transferable idea from the working
// gossip automation, re-scoped for NEWS: an LLM editor-in-chief reads the ACTUAL gathered source text (AFTER
// extraction) and makes every editorial call from that ground truth, OVERRIDING the discovery metadata that
// upstream stages guessed from a headline:
//   • isStory — reject power: is this ONE concrete, current news EVENT (not a roundup/retrospective/opinion/
//     listicle/evergreen feature)? A deterministic substance floor backstops it (a bundle with almost no text
//     can't be judged a story).
//   • primaryEntity correction — the TRUE subject per the text (kills the wrong-subject class at the root:
//     the Spartacus 1960-film-vs-2010-series failure entered as a mislabeled subject). Drives grounding + hero.
//   • work identification — which WORK (title/year/medium) the reporting actually describes, so structured
//     TMDB grounding resolves the RIGHT same-named title (year-hinted search beats popularity-ranked search).
//   • reportingOutlet — who ACTUALLY reported the core claim per the text (never an aggregator/echo), fixing
//     "according to X" attribution.
//   • status — confirmed / official-statement / denied / unconfirmed per the text, so the writer's framing
//     matches reality (a denied claim is reported AS denied).
//   • eventSummary — 1-2 sentences of what happened, from the text; clean grounding for the writer's lede.
//
// FAIL-SAFE by design: the gate is an ENHANCEMENT — on any LLM/parse error the pipeline proceeds exactly as
// before (no editorial corrections), never blocks. Only a CONFIDENT isStory=false rejects the topic (that is
// the one fail-closed power it has, matching the owner's news-only hard directive).
import { chat } from "../lib/openrouter.mjs";
import { MODELS } from "../config.mjs";
import { NEWS_FORMS } from "../find/categorize.mjs";

// Deterministic substance floor (gossip-proven): a "bundle" with less real text than a paragraph cannot ground
// an article OR an editorial judgment.
export const SUBSTANCE_FLOOR_CHARS = 220;

const CATS = ["movies", "tv", "streaming", "celebrity", "awards", "music"];

export async function editorialGate({ topic, bundle, model = MODELS.judge }) {
  const sources = (bundle && bundle.sources) || [];
  const totalChars = sources.reduce((n, s) => n + (s.text || "").length, 0);
  if (totalChars < SUBSTANCE_FLOOR_CHARS) {
    return { ran: false, isStory: false, reject: true, reason: `substance floor: ${totalChars} chars of gathered text < ${SUBSTANCE_FLOOR_CHARS}` };
  }
  const srcText = sources
    .map((s, i) => `[SOURCE ${i + 1} · ${s.domain || s.owner || "?"} · tier:${s.tier}]\n${(s.text || "").slice(0, 3500)}`)
    .join("\n\n")
    .slice(0, 15000);

  const user = `You are the editor-in-chief of a Hollywood/entertainment NEWS site. Below is the ACTUAL gathered source
reporting for a story our discovery layer filed as:
  headline: ${topic.title}
  claimed subject: ${topic.primaryEntity || "?"}
  claimed form: ${topic.formatTag || "news"} · category: ${topic.category || "?"}

Read the gathered text and decide — from THE TEXT ONLY (the discovery metadata above may be WRONG; your job is
to correct it):

1. isStory: does the text report ANY concrete entertainment happening we can turn into a news brief — a casting,
   deal, release/premiere, trailer, box-office or chart result, an award, a wedding/engagement/split, a death, an
   arrest, a renewal/cancellation, an on-the-record statement or reveal, a tour/album announcement? Say TRUE for
   all of these — INCLUDING a story framed as a "who-attended"/"reactions"/color piece IF a real event sits under
   it (we'll just write the event). Say FALSE only for a genuine NON-article: an interactive quiz or personality
   poll, a pure shopping/product listicle with no news, or text with no discernible happening at all. Do NOT reject
   something merely for being a feature or having multiple names — if there's a real event, it's a story.
2. inScope: is this ENGLISH-LANGUAGE HOLLYWOOD / Western entertainment — a film, TV show, streaming title, a
   film/TV/music celebrity, or Western/English-language music? Say FALSE (out of scope) for: VIDEO GAMES / gaming,
   ANIME or MANGA (Japanese animation/comics), NON-ENGLISH regional cinema (Bollywood, K-drama, etc. with no major
   Hollywood tie-in), sports, politics, or tech. When unsure on a borderline anime/game item, say false.
3. primaryEntity: the story's TRUE primary subject exactly as the text names it (a person, film, show, or album).
4. coSubjects: up to 3 other named people/works central to the event.
5. work: if the story centers on (or heavily involves) a specific FILM/SHOW, identify it PRECISELY from the
   text: { "title": "...", "year": <the year the TEXT associates with it, or null>, "medium": "movie"|"tv"|null }.
   Many works share a name — the year/medium you extract here selects the right one. null if no specific work.
6. reportingOutlet: which outlet the text shows ACTUALLY reported/broke the core claim (never an aggregator like
   Yahoo/MSN; if our own gathered source IS the reporter, name that outlet). null if unclear.
7. status: "confirmed" (multiple independent reports or on-the-record confirmation) | "official" (an official
   statement/announcement) | "denied" (the claim is denied in the text) | "unconfirmed" (single-source report).
8. form: the best of ${NEWS_FORMS.join("|")} for this event. category: the best of ${CATS.join("|")}.
9. eventSummary: 1-2 plain sentences stating exactly what happened per the text (names, work, what changed).
10. currency: "current" if the CORE happening this story reports is NEW — it broke in roughly the last few days (a
   fresh casting/deal/release/premiere/trailer, a box-office result for a film currently in theaters, an award just
   handed out, a death/arrest, an on-the-record statement just made). Say "stale" ONLY if the story's CENTRAL subject
   is an OLD event, record, milestone, or anniversary being RE-SURFACED and is not itself new news — e.g. "X remains
   the highest-grossing film of all time", a box-office record the film set MONTHS ago written up now, a "N years
   later" retrospective, or a re-report of an award/citizenship/honor the person received long ago. A genuinely
   current event that merely MENTIONS past context is "current". When unsure, say "current".

GATHERED SOURCE REPORTING:
${srcText}

Return STRICT JSON:
{"isStory":true|false,"inScope":true|false,"currency":"current|stale","reason":"...","primaryEntity":"...","coSubjects":["..."],"work":{"title":"...","year":2010,"medium":"tv"}|null,"reportingOutlet":"..."|null,"status":"confirmed|official|denied|unconfirmed","form":"...","category":"...","eventSummary":"..."}`;

  try {
    const { data } = await chat({
      model,
      system: "You are a precise, skeptical news editor. Judge ONLY from the provided text. Output strict JSON only.",
      user,
      json: true,
      maxTokens: 500,
      temperature: 0,
    });
    if (!data || typeof data.isStory !== "boolean") return { ran: false, reject: false, reason: "unparseable editorial verdict" };
    // REJECT only a true non-article OR an OUT-OF-SCOPE item (video games / anime / non-English regional). Note:
    // inScope defaults to TRUE when the model omits it, so we never over-reject on a parse gap — the scope drop is
    // deliberate and explicit only.
    const inScope = data.inScope !== false;
    // CURRENCY (2026-07-04): reject a STALE story — an old record/milestone/anniversary/honor re-surfaced as if it
    // were new news (the Zootopia-Dec-2025-record + Eisenberg-2025-citizenship class). Defaults to "current" on any
    // parse gap so we NEVER over-reject fresh news; the stale drop is deliberate and explicit only.
    const currency = data.currency === "stale" ? "stale" : "current";
    const reject = data.isStory === false || !inScope || currency === "stale";
    return {
      ran: true,
      isStory: data.isStory,
      inScope,
      currency,
      reject,
      reason: reject
        ? (currency === "stale" ? `stale: not current news — ${data.reason || "an old event/record/honor re-surfaced, not new"}`
          : !inScope ? `out of scope: ${data.reason || "not English-language Hollywood/Western entertainment"}`
          : (data.reason || "not a story"))
        : (data.reason || ""),
      primaryEntity: typeof data.primaryEntity === "string" && data.primaryEntity.trim().length >= 2 ? data.primaryEntity.trim() : null,
      coSubjects: Array.isArray(data.coSubjects) ? data.coSubjects.filter((x) => typeof x === "string").slice(0, 3) : [],
      work: data.work && typeof data.work.title === "string" && data.work.title.trim()
        ? { title: data.work.title.trim(), year: Number(data.work.year) || null, medium: ["movie", "tv"].includes(data.work.medium) ? data.work.medium : null }
        : null,
      reportingOutlet: typeof data.reportingOutlet === "string" && data.reportingOutlet.trim() ? data.reportingOutlet.trim() : null,
      status: ["confirmed", "official", "denied", "unconfirmed"].includes(data.status) ? data.status : "unconfirmed",
      form: NEWS_FORMS.includes(data.form) ? data.form : null,
      category: CATS.includes(data.category) ? data.category : null,
      eventSummary: typeof data.eventSummary === "string" ? data.eventSummary.trim().slice(0, 400) : "",
    };
  } catch (e) {
    // FAIL-SAFE: the pipeline proceeds without editorial corrections (never a new failure mode).
    return { ran: false, reject: false, reason: "editorial gate error: " + (e?.message || e) };
  }
}
