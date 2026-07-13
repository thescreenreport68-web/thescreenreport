// AGENT 4 — SYNTHESIZER / ANGLE. One job: read the gathered trade numbers + narrative + the TMDB
// context and shape the ENGAGEMENT brief the writer works from: the hook (star + the surprising
// number), the why-up / why-down story, what must be included (plan §8). It invents NOTHING — it
// only selects and structures from the material. deepseek-v4-flash @ temp 0.3.
import { agentChat } from "../models.mjs";
import { boxDataBlock } from "../boxofficeData.mjs";

const SYS = `You are the senior box-office editor distilling raw material into a WRITER'S BRIEF. Engagement is
the #1 KPI: the brief must give the writer a reason to make a reader keep reading. Build it around the HOOK
(the star + the surprising number) and the WHY (why the film is up or down — a hold, a drop, a milestone,
budget vs gross). Use ONLY what the material states — never invent a number, a split, or a record, and never
invent plot/premise, a setting or location, a supporting-cast name, a comparison to another film, or an
audience reaction. Characterize a weekend drop honestly (a drop OVER 45% is NOT a "strong hold"). If the
material is thin, keep the brief tight — do not pad. Output STRICT JSON only.`;

// Deterministic, honest characterization of a weekend drop — handed to the writer so the LLM never has to
// (and never gets to) spin a steep fall as a "strong hold" (owner: a strong hold is under ~45%).
const dropLabelFor = (dropPct) => {
  const n = parseFloat(String(dropPct ?? "").replace("%", ""));
  if (!Number.isFinite(n)) return null;
  return n < 35 ? `a STRONG HOLD (down ${n}%)` : n <= 45 ? `a solid, typical hold (down ${n}%)`
    : n <= 55 ? `a NOTABLE DROP (down ${n}%)` : `a STEEP FALL (down ${n}%)`;
};

// run(job) → job.brief
export async function run(job, { chatImpl = null } = {}) {
  const g = job.gathered || {};
  const gatheredLines = [
    g.openingWeekend ? `Opening weekend: ${g.openingWeekend}` : "",
    g.domestic ? `Domestic: ${g.domestic}` : "",
    g.international ? `International: ${g.international}` : "",
    g.worldwide ? `Worldwide (trade): ${g.worldwide}` : "",
    g.cume ? `Cume: ${g.cume}` : "",
    g.dropPct ? `Weekend drop: ${g.dropPct}` : "",
    g.theaters ? `Theaters: ${g.theaters}` : "",
    g.perTheater ? `Per-theater: ${g.perTheater}` : "",
    g.records?.length ? `Records/milestones stated: ${g.records.join("; ")}` : "",
    g.hoursViewed ? `Netflix hours viewed this week: ${g.hoursViewed}` : "",
    g.netflixRank ? `Netflix Top 10 rank: #${g.netflixRank}` : "",
    g.weeksInTop10 ? `Weeks in the Netflix Top 10: ${g.weeksInTop10}` : "",
    g.cast?.length ? `Stars: ${g.cast.join(", ")}` : "",
    g.narrative ? `Narrative: ${g.narrative}` : "",
  ].filter(Boolean).join("\n");
  const dropLabel = dropLabelFor(g.dropPct);

  const { data } = await agentChat("synthesizer", {
    system: SYS,
    user: `FORM: ${job.angle.form}
FILM: ${job.film.title}${job.film.year ? ` (${job.film.year})` : ""}
${job.film?.overview ? `WHAT IT IS: ${job.film.overview}` : ""}
STAR TO LEAD WITH: ${job.angle.star || (g.cast?.[0] || job.film.title)}

GATHERED (trade report — ground truth, reproduce exactly):
${gatheredLines || "(no explicit trade figures — lean on TMDB context below)"}
${dropLabel ? `WEEKEND-DROP FRAMING (use exactly this — never upgrade it to a stronger hold): the latest weekend is ${dropLabel}.` : ""}

${boxDataBlock(job.boxData)}

JSON:
{"hook":"1-2 sentences: the star + the number that pulls the reader in",
"whyStory":"2-3 sentences: why it's up / why it's down / what it means vs budget",
"mustInclude":["the hard figures/points the article needs, exact"],
"profitAngle":"one line: gross vs budget read, or null if budget unknown",
"suggestedTitle":"stars-first, the number, curiosity — no clickbait","seoKeyword":"one natural keyword phrase"}`,
  }, chatImpl ? { chatImpl } : {});

  if (!data || !data.hook) { job.synthFail = "synthesizer returned no usable brief"; return job; }
  job.brief = {
    dropLabel: dropLabel || null,
    hook: (data.hook || "").slice(0, 400),
    whyStory: (data.whyStory || "").slice(0, 500),
    mustInclude: (Array.isArray(data.mustInclude) ? data.mustInclude : []).slice(0, 8),
    profitAngle: (data.profitAngle || "").slice(0, 200) || null,
    suggestedTitle: (data.suggestedTitle || job.angle.workingTitle).slice(0, 140),
    seoKeyword: (data.seoKeyword || job.film.title).slice(0, 80),
  };
  return job;
}
