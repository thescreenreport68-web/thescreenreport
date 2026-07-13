// DATA MODULE (deterministic — NO LLM) — TMDB worldwide gross + production budget + current
// watch-providers for the resolved film (plan §8 "Data module"). This is the structured truth the
// writer grounds on and the fidelity wall trusts alongside the gatherer's trade numbers. Reuses the
// shared TMDB lib (getBoxOffice, getTitleFacts, toWhereToWatch) — never re-implements it.
import { getBoxOffice, getTitleFacts, toWhereToWatch } from "../lib/tmdb.mjs";

// run(job) → job.boxData = { title, year, worldwide, worldwideRaw, budget, budgetRaw, releaseDate,
//   providers{stream,rent,buy}, whereToWatch[], cast[], status, moneyStrings[] }  — or job.boxData = null.
// Fail-SOFT: TMDB is context, not a gate. A miss just means the writer has the trade numbers only
// (the gatherer's report is the box-office backbone; TMDB adds worldwide+budget context).
const normTitle = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// The resolved TMDB entity is trustworthy for cast/director ONLY if its title closely matches what we
// asked for AND (for a current/trending title) it isn't an OLD same-name film. A common title like
// "I Will Find You" can otherwise match a wrong same-name film whose cast would poison the article —
// a cast-less piece is fine, a WRONG-cast piece is fake news.
export function castTrustworthy(facts, requestedTitle, { nowYear } = {}) {
  if (!facts || !facts.title) return false;
  const a = normTitle(facts.title), b = normTitle(requestedTitle);
  if (!(a === b || a.includes(b) || b.includes(a))) return false;
  const fy = parseInt(facts.year) || null;
  if (nowYear && fy && fy < nowYear - 6) return false; // a 2026 chart-topper resolving to a 1990s film = wrong entity
  return true;
}

export async function run(job, { boxOfficeImpl = getBoxOffice, factsImpl = getTitleFacts } = {}) {
  const title = job?.film?.title || job?.trigger?.title;
  if (!title) { job.boxData = null; return job; }
  const yearHint = job?.film?.year || null;
  const isTV = job?.angle?.form === "TRENDING-TV";

  const [bo, facts] = await Promise.all([
    isTV ? Promise.resolve(null) : boxOfficeImpl(title, "movie").catch(() => null),
    factsImpl(title, isTV ? "tv" : "movie", yearHint).catch(() => null),
  ]);
  const nowYear = parseInt(String(job?.film?.netflix?.week || job?.film?.releaseDate || yearHint || "").slice(0, 4)) || null;
  const castTrusted = castTrustworthy(facts, title, { nowYear });

  const providers = facts?.providers || { stream: [], rent: [], buy: [] };
  const whereList = [{
    title, year: bo?.year || facts?.year || "",
    type: "movie", providers,
  }];
  const whereToWatch = (providers.stream.length || providers.rent.length || providers.buy.length)
    ? toWhereToWatch(whereList) : [];

  // The fmtUSD strings we actually hand the writer — the fidelity wall normalizes THESE so a
  // faithfully-copied TMDB figure always clears (see moneyGuard.buildAllowed).
  const moneyStrings = [bo?.worldwide, bo?.budget].filter(Boolean);

  job.boxData = {
    title: bo?.title || facts?.title || title,
    year: bo?.year || facts?.year || "",
    worldwide: bo?.worldwide || null, worldwideRaw: bo?.worldwideRaw || facts?.revenueRaw || 0,
    budget: bo?.budget || null, budgetRaw: bo?.budgetRaw || facts?.budgetRaw || 0,
    releaseDate: bo?.releaseDate || facts?.theatrical || "",
    providers,
    whereToWatch,
    cast: castTrusted ? (facts?.cast || []).map((c) => c.name).filter(Boolean).slice(0, 8) : [],
    // castRoles keeps the {name, character} pairs TMDB already returned (boxofficeData used to throw the
    // character away). "Actor as Character" is rich, faithful material the writer develops into a full
    // cast paragraph — the single biggest source of the length the writer was starved of.
    castRoles: castTrusted ? (facts?.cast || []).filter((c) => c?.name).slice(0, 8) : [],
    director: castTrusted ? (facts?.director || "") : "",
    genres: Array.isArray(facts?.genres) ? facts.genres.filter(Boolean).slice(0, 4) : [],
    runtime: facts?.runtime || null,
    overview: facts?.overview || "",
    status: facts?.status || "",
    isOTT: !!facts?.isOTT,
    castTrusted,
    moneyStrings,
  };
  return job;
}

// A plain-text grounding block for the writer/synthesizer: REAL, verified material to DEVELOP the article
// from (cast+characters, premise, genre, runtime, the money) — never invent beyond it.
export function boxDataBlock(b) {
  if (!b) return "";
  const L = [`TMDB VERIFIED CONTEXT for ${b.title}${b.year ? ` (${b.year})` : ""} — real material to DEVELOP into full paragraphs; use these EXACT figures and NEVER invent a number, split, name, character, or record:`];
  if (b.overview) L.push(`Premise (develop this into the "what it is"): ${b.overview}`);
  if (b.genres?.length) L.push(`Genre: ${b.genres.join(", ")}`);
  if (b.runtime) L.push(`Runtime: ${b.runtime} minutes`);
  if (b.director) L.push(`Director: ${b.director}`);
  if (b.castRoles?.length) L.push(`Cast — develop who each plays: ${b.castRoles.map((c) => c.character ? `${c.name} as ${c.character}` : c.name).join("; ")}`);
  else if (b.cast?.length) L.push(`Top cast: ${b.cast.join(", ")}`);
  if (b.worldwide) L.push(`Worldwide box office (lifetime, TMDB): ${b.worldwide}`);
  if (b.budget) L.push(`Production budget (before marketing): ${b.budget}`);
  if (b.releaseDate) L.push(`US release date: ${b.releaseDate}`);
  const stream = b.providers?.stream?.length ? b.providers.stream.join(", ") : null;
  if (stream) L.push(`CURRENTLY STREAMING (US, TMDB/JustWatch — the ONLY correct platform): ${stream}`);
  else if (b.providers?.rent?.length) L.push(`Available to rent/buy (US): ${b.providers.rent.slice(0, 4).join(", ")}`);
  return L.join("\n");
}
