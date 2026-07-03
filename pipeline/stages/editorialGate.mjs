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

1. isStory: is this ONE concrete, CURRENT news EVENT (a casting, release, statement, verdict, chart/box-office
   result, death, renewal, trailer drop...)? false if it is a multi-item roundup, an anniversary retrospective,
   an opinion/analysis essay, a ranked list, an evergreen explainer, or no discernible current event.
2. primaryEntity: the story's TRUE primary subject exactly as the text names it (a person, film, show, or album).
3. coSubjects: up to 3 other named people/works central to the event.
4. work: if the story centers on (or heavily involves) a specific FILM/SHOW, identify it PRECISELY from the
   text: { "title": "...", "year": <the year the TEXT associates with it, or null>, "medium": "movie"|"tv"|null }.
   Many works share a name — the year/medium you extract here selects the right one. null if no specific work.
5. reportingOutlet: which outlet the text shows ACTUALLY reported/broke the core claim (never an aggregator like
   Yahoo/MSN; if our own gathered source IS the reporter, name that outlet). null if unclear.
6. status: "confirmed" (multiple independent reports or on-the-record confirmation) | "official" (an official
   statement/announcement) | "denied" (the claim is denied in the text) | "unconfirmed" (single-source report).
7. form: the best of ${NEWS_FORMS.join("|")} for this event. category: the best of ${CATS.join("|")}.
8. eventSummary: 1-2 plain sentences stating exactly what happened per the text (names, work, what changed).

GATHERED SOURCE REPORTING:
${srcText}

Return STRICT JSON:
{"isStory":true|false,"reason":"...","primaryEntity":"...","coSubjects":["..."],"work":{"title":"...","year":2010,"medium":"tv"}|null,"reportingOutlet":"..."|null,"status":"confirmed|official|denied|unconfirmed","form":"...","category":"...","eventSummary":"..."}`;

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
    return {
      ran: true,
      isStory: data.isStory,
      reject: data.isStory === false,
      reason: data.reason || "",
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
