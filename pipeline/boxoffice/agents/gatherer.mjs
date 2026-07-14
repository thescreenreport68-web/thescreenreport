// AGENT 2 — GATHERER. One job: pull the trade box-office REPORT for the film (shared contentFinder)
// and extract EVERY reported number + the narrative + cast to strict JSON, VERBATIM (plan §8). The
// top outlet IS ground truth (plan §3) — we reproduce its figures exactly, never re-check them.
// flash-lite @ temp 0: literal extraction only.
import { findContent } from "../../lib/contentFinder.mjs";
import { agentChat } from "../models.mjs";
import { FORMS } from "../config.bo.mjs";

const SYS = `You are a box-office data extractor. You are given the full text of one or more trade
box-office reports (Deadline / Variety / THR class) that OFTEN cover MANY films in one weekend roundup.
Extract figures and records ONLY for THE SUBJECT FILM named below — IGNORE every number, record, or
milestone about any OTHER film or a studio-wide total (e.g. a record about a different film's rating,
genre, or a rival release is NOT this film's). Extract the subject film's figures EXACTLY as printed —
never round, never convert, never invent, never guess a split the report didn't state. If a field isn't
in the text for THIS film, leave it null / empty. Output STRICT JSON only.`;

const SCHEMA = `{
"openingWeekend":"e.g. \\"$45.2 million\\" or null","domestic":"or null","international":"or null",
"worldwide":"or null","cume":"running domestic/worldwide total, or null","dropPct":"e.g. \\"48%\\" or null",
"theaters":"e.g. \\"4,337\\" or null","perTheater":"e.g. \\"$10,420\\" or null",
"otherNumbers":["any other reported money figure or percentage FOR THIS FILM, verbatim"],
"records":["records/milestones the report states ABOUT THIS FILM ONLY, verbatim — NEVER another film's or a studio-wide record"],
"cast":["named stars of THIS film"],
"narrative":"2-4 sentences: the why-up/why-down story the trade tells, in the trade's framing (no invented facts)",
"hasDomesticInternationalSplit":true}`;

// run(job) → job.gathered + job.trigger.sources filled — or job.gatherFail = reason.
export async function run(job, { findImpl = findContent, chatImpl = null } = {}) {
  const film = job.film;
  if ((FORMS[job.angle?.form] || {}).streaming) return gatherStreaming(job, { findImpl, chatImpl });
  // Extract box-office figures from a set of source articles (used for the first pass + the deep fallback).
  const extractFrom = async (srcs) => {
    const reportText = srcs.map((s) => `[${s.owner || s.domain || "source"}]\n${s.text}`).join("\n\n---\n\n").slice(0, 16000);
    try {
      const { data } = await agentChat("gatherer", { system: SYS, user: `FILM: ${film.title}\nTRADE REPORT TEXT:\n${reportText}\n\nReturn JSON: ${SCHEMA}` }, chatImpl ? { chatImpl } : {});
      return data || null;
    } catch { return null; }
  };
  const hasGrossFig = (d) => d && (d.openingWeekend || d.domestic || d.international || d.worldwide || d.cume ||
    (Array.isArray(d.otherNumbers) && d.otherNumbers.some((n) => /\$|\bmillion\b|\bbillion\b/i.test(String(n)))));
  const searchTop = (query, seed) => findImpl({ query, title: film.title, primaryEntity: film.title, sources: seed || [] }, { corroborate: true, maxSources: 8, maxExtract: 10 }).catch(() => null);

  // FIRST pass — the finder's box-office query, searched WIDE across the top Hollywood outlets.
  const res = (await searchTop(job.angle?.queries?.[0] || `${film.title} box office`, job.trigger?.sources || [])) || { blocked: true };
  const sources = (!res.blocked && res.sources?.length) ? [...res.sources] : [];
  let data = sources.length ? await extractFrom(sources) : null;

  // 🔴 DEEP-SEARCH FALLBACK (owner): if there's still NO box-office figure, look HARDER at the big movie-news
  // channels (Variety / Deadline / THR / TMZ) with explicit box-office queries — the numbers are out there, we
  // just widen the net. Merge the new sources, re-extract, and stop as soon as a real figure appears.
  if (!hasGrossFig(data)) {
    for (const dq of [`${film.title} box office weekend gross`, `${film.title} opening weekend domestic`]) {
      const r2 = await searchTop(dq, sources);
      if (r2 && !r2.blocked && r2.sources?.length)
        for (const s of r2.sources) if (!sources.some((m) => (m.url && m.url === s.url) || m.text === s.text)) sources.push(s);
      const d2 = await extractFrom(sources);
      if (d2) data = d2;
      if (hasGrossFig(data)) break;
    }
  }

  if (!sources.length) { job.gatherFail = `under floor: no trade box-office report (${res.reason || "no sources"})`; return job; }
  if (!data) { job.gatherFail = "extractor returned no JSON"; return job; }
  // Real trade sources → used by the image picker + outletCount.
  job.trigger.sources = sources.filter((s) => s.url).map((s) => ({ url: s.url, outlet: s.owner, tier: s.tier }));
  job.bundle = { sources };

  const numbers = [data.openingWeekend, data.domestic, data.international, data.worldwide, data.cume,
    data.dropPct, data.theaters, data.perTheater, ...(Array.isArray(data.otherNumbers) ? data.otherNumbers : [])].filter(Boolean);

  job.gathered = {
    openingWeekend: data.openingWeekend || null, domestic: data.domestic || null,
    international: data.international || null, worldwide: data.worldwide || null,
    cume: data.cume || null, dropPct: data.dropPct || null, theaters: data.theaters || null,
    perTheater: data.perTheater || null,
    numbers,
    records: (Array.isArray(data.records) ? data.records : []).filter(Boolean),
    cast: (Array.isArray(data.cast) ? data.cast : []).filter(Boolean).slice(0, 8),
    narrative: (data.narrative || "").slice(0, 800),
    hasSplit: !!data.hasDomesticInternationalSplit && !!(data.domestic || data.international),
    sources: sources.map((s) => ({ owner: s.owner, tier: s.tier, url: s.url || null })),
    outletCount: sources.filter((s) => s.url || s.owner).length,
  };

  // Fail-closed floor: a BO-OPENING with NO opening/weekend/gross number anywhere (trade OR TMDB) is
  // thin — hold it, don't manufacture a number (plan §5 floors).
  // Fail-closed floors per form (plan §5) — never manufacture the missing fact:
  //  BO-OPENING  → an opening/weekend/gross figure (trade OR TMDB)
  //  BO-UPDATE   → at least one reported number that moved
  //  NOW-STREAMING → a TMDB-CONFIRMED platform (never assert "now streaming" without one)
  const form = FORMS[job.angle.form];
  const g = job.gathered;
  const isOTT = !!job.boxData?.isOTT;
  const prov = job.boxData?.providers || {};
  // NOW-STREAMING = a real SUBSCRIPTION (flatrate) landing, NEVER rent/buy: a $19.99 Amazon/Apple rental is
  // "available to rent", not "now streaming" (the live Michael bug). Require a flatrate stream provider.
  const hasStreamPlatform = !!(prov.stream?.length);
  // A REAL theatrical box-office figure — a $ gross the trade reported (or a TMDB theatrical worldwide) —
  // NOT a stray theater count or percentage. Stops a Netflix film / thin roundup number passing as "box office".
  const hasGross = !!(g.openingWeekend || g.domestic || g.international || g.worldwide || g.cume
    || (job.boxData?.worldwide && !isOTT) || (g.numbers || []).some((n) => /\$|\b(million|billion)\b/i.test(String(n))));
  const isBoxOfficeForm = form?.needsOpeningNumber || form?.needsNewNumber;

  if (isBoxOfficeForm && isOTT)
    job.gatherFail = "under floor: streaming original — no theatrical box office (belongs in a streaming form)";
  else if (form?.needsOpeningNumber && !hasGross)
    job.gatherFail = "under floor: no opening/weekend/gross figure in the report";
  else if (form?.needsNewNumber && !hasGross)
    job.gatherFail = "under floor: no new box-office number to report";
  else if (form?.needsPlatform && !hasStreamPlatform)
    job.gatherFail = "under floor: no subscription-streaming platform — rent/buy is not 'now streaming'";
  return job;
}

// STREAMING gather (NETFLIX-TOP10 / TRENDING-TV) — Netflix's OWN hours + rank are the verified numbers;
// a best-effort trade pull adds the "why it's popular" narrative + cast. Never fail-closed on the trade
// pull (the Netflix data is the backbone). The platform is Netflix — the source is its own chart.
const STREAM_SYS = `You extract ONLY: a 1-3 sentence narrative on WHY a title is popular this week (from the
given sources — no invented numbers or viewership figures) and the named stars/creators. STRICT JSON only.`;
async function gatherStreaming(job, { findImpl = findContent, chatImpl = null } = {}) {
  const film = job.film;
  const nf = film.netflix || {};
  const form = FORMS[job.angle.form];
  const platform = "Netflix";
  const records = nf.rank ? [`#${nf.rank} on Netflix's Top 10 this week`] : [];

  let narrative = "", cast = [], outletCount = 0;
  try {
    const q = job.angle?.queries?.[0] || `${film.title} netflix`;
    const res = await findImpl({ query: q, title: film.title, primaryEntity: film.title, sources: [] }, { corroborate: true, maxSources: 5, maxExtract: 6 })
      .catch(() => ({ blocked: true }));
    if (res && !res.blocked && res.sources?.length) {
      job.trigger.sources = res.sources.filter((s) => s.url).map((s) => ({ url: s.url, outlet: s.owner, tier: s.tier }));
      job.bundle = res;
      outletCount = res.sources.filter((s) => s.url || s.owner).length;
      const reportText = res.sources.map((s) => `[${s.owner || s.domain || "src"}]\n${s.text}`).join("\n\n---\n\n").slice(0, 8000);
      try {
        const { data } = await agentChat("gatherer", { system: STREAM_SYS,
          user: `TITLE: ${film.title}\nSOURCES:\n${reportText}\n\nJSON: {"narrative":"why it's popular, 1-3 sentences, no invented numbers","cast":["named stars/creators"]}`,
        }, chatImpl ? { chatImpl } : {});
        narrative = (data?.narrative || "").slice(0, 600);
        cast = (Array.isArray(data?.cast) ? data.cast : []).filter(Boolean).slice(0, 8);
      } catch { /* narrative is garnish; Netflix data carries the piece */ }
    }
  } catch { /* trade pull is best-effort */ }

  job.gathered = {
    openingWeekend: null, domestic: null, international: null, worldwide: null, cume: null, dropPct: null,
    theaters: null, perTheater: null,
    numbers: [nf.hours, nf.views && nf.views >= 1e6 ? `${(nf.views / 1e6).toFixed(1)} million` : null].filter(Boolean),
    records, cast,
    narrative: narrative || (nf.hours ? `${film.title} drew ${nf.hours} on Netflix this week.` : ""),
    hasSplit: false,
    hoursViewed: nf.hours || null, hoursRaw: nf.hoursRaw || null, netflixRank: nf.rank || null,
    weeksInTop10: nf.weeksInTop10 || null, platform, netflixWeek: nf.week || null,
    sources: (job.bundle?.sources || []).map((s) => ({ owner: s.owner, tier: s.tier, url: s.url || null })),
    outletCount,
  };

  if (form?.needsHours && !nf.hoursRaw) job.gatherFail = "under floor: no Netflix hours data";
  else if (form?.needsPlatform && !platform) job.gatherFail = "under floor: no confirmed platform";
  return job;
}
