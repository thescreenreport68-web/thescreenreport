// DAILY BOX-OFFICE CHART — the volume engine for ~15 box-office articles/day (owner: "cover every movie in
// theaters, day 11 → day 12 with real higher numbers"). Box office accumulates EVERY day, so every film in
// release has a genuinely NEW, HIGHER cume each day — that is a real, accurate story, not a weekly one. This
// pulls the DAILY domestic chart (free, via the shared contentFinder — Box Office Mojo / The Numbers / trade
// dailies) and LLM-extracts the ranked film list with each film's latest daily gross + running domestic cume +
// day/weekend in release. The finder turns EACH into a BO-UPDATE candidate; the strictly-higher materiality gate
// (tracker.mjs) guarantees we never reuse yesterday's number. NO paid APIs — the numbers are facts we rewrite in
// our own voice (owner's rule). This module only READS + EXTRACTS; it invents nothing.
import fs from "node:fs";
import path from "node:path";
import { findContent } from "../lib/contentFinder.mjs";
import { agentChat } from "./models.mjs";
import { scopeOk, DAILY_GROSS_FLOOR, MAX_DAYS_IN_RELEASE, LONG_RUN_DAILY_FLOOR, DATA_DIR } from "./config.bo.mjs";
import { normMoney } from "./moneyGuard.mjs";
import { assertCount, fault, SEV } from "./health.mjs";

const SYS = `You extract structured data from a DAILY / weekend DOMESTIC box-office chart or report. You are given
the text of one or more box-office chart pages (Box Office Mojo / The Numbers / Deadline / Variety class). Return
the ranked list of films CURRENTLY IN THEATERS, and for EACH film: the exact title, its most recent DAILY gross
(yesterday's, if the chart is daily) OR its latest weekend gross, its running DOMESTIC cumulative total (total-to-
date), its day-over-day % change, its theater count, and its day- or weekend-in-release if stated. Copy figures
EXACTLY as printed — never round, never invent, never guess a number the chart didn't state; use null for a field
the text doesn't give. Hollywood / English-language films ONLY (skip Bollywood / other-language titles). Output
STRICT JSON only.`;

const SCHEMA = `{"films":[{"title":"","dailyGross":"e.g. \\"$3.2 million\\" or null","cume":"running domestic total, e.g. \\"$188.4 million\\", or null","dailyChangePct":"day-over-day % change, e.g. \\"-59%\\", or null","theaters":"theater count, e.g. \\"3,575\\", or null","dayInRelease":"e.g. \\"Day 12\\" / \\"third weekend\\" / null","rank":1}]}`;

// fetchDailyChart() → { films: [{title, dailyGross, cume, dayInRelease, rank}], date }
// The daily chart lives at STABLE URLs (contentFinder needs seed URLs, not an open query): The Numbers'
// /daily-box-office-chart is always the latest clean per-film chart; Box Office Mojo's /date/<day>/ is the
// per-film backup. We fetch one, LLM-extract every film's daily gross + running cume + day-in-release.
// Injected findImpl/chatImpl keep the offline suite network-free.
// COST LEVER (§4.2 "extract once, publish many"): the chart changes ONCE a day, but the lane ticks hourly —
// re-scraping + re-LLM-extracting 24×/day was pure waste (and tripped the extractor's rate limit). The parsed
// chart is cached on disk for the LA day; every tick after the first reads the cache for ~$0.000.
const CHART_CACHE = path.join(DATA_DIR, "chartCache.json");
// Bump when the parser changes shape/completeness. A cache written by an OLDER extractor is ignored, so a
// lossy chart (the LLM's 6-of-17) can never hold the whole LA day hostage after a parser fix ships.
const PARSER_VERSION = 2;
const laDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(ms));
export function readChartCache({ nowMs = Date.now(), file = CHART_CACHE } = {}) {
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    if (c?.laDay === laDay(nowMs) && c?.parserVersion === PARSER_VERSION && Array.isArray(c.films) && c.films.length) return c;
  } catch {}
  return null;
}
export function writeChartCache(chart, { nowMs = Date.now(), file = CHART_CACHE } = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ laDay: laDay(nowMs), parserVersion: PARSER_VERSION, fetchedAt: new Date(nowMs).toISOString(), ...chart }, null, 1));
  } catch {}
}

// ── DETERMINISTIC CHART PARSER (the volume fix, 2026-07-19) ──────────────────────────────────────
// The LLM extractor silently returned 6 of 17 rows (dropping The Odyssey's $51.28M #1 opening with NO
// error) — one unlogged completion was the lane's entire box-office supply. These chart pages are
// PUBLISHED TABLES rendered one field per line, so a deterministic parse is both complete and strictly
// safer than a model transcription: it cannot hallucinate or mistranscribe a row, and it costs $0.
//   Rank / Prev / Title / Gross / DailyΔ / WeeklyΔ / Theaters / TheaterAvg / TotalGross / DaysInRelease
// Fields the page leaves blank simply don't emit a token, so each field is claimed only if its own
// shape matches (money vs percent vs bare number) — a missing column can never shift the next value
// into the wrong field.
const MONEY_TOK = /^\$[\d,]+$/;
const PCT_TOK = /^[+-][\d.,]+%$/;
const NUM_TOK = /^[\d,]+$/;
const PREV_TOK = /^\((new|\d+)\)$/i;

export function parseChartText(text) {
  const toks = String(text || "").split("\n").map((t) => t.trim()).filter(Boolean);
  const films = [];
  for (let i = 0; i < toks.length; i++) {
    // Row anchor = <rank><prev>. Rank is a number OR "-" for a title that fell off the ranked list but
    // still reports a gross (Star Wars, Devil Wears Prada 2 …) — those were silently skipped before.
    const isRank = /^\d{1,3}$/.test(toks[i]) || toks[i] === "-";
    if (!isRank || !PREV_TOK.test(toks[i + 1] || "")) continue;
    const rank = toks[i] === "-" ? null : Number(toks[i]);
    let j = i + 2;
    const titleParts = [];
    while (j < toks.length && !MONEY_TOK.test(toks[j]) && titleParts.length < 12) { titleParts.push(toks[j]); j++; }
    if (!titleParts.length || j >= toks.length) continue;
    const title = titleParts.join(" ").replace(/\s+/g, " ").trim();
    const dailyGross = toks[j++];
    let dailyChangePct = null, weeklyChangePct = null, theaters = null, perTheater = null, cume = null, days = null;
    if (PCT_TOK.test(toks[j] || "")) dailyChangePct = toks[j++];
    if (PCT_TOK.test(toks[j] || "")) weeklyChangePct = toks[j++];
    if (NUM_TOK.test(toks[j] || "") && !MONEY_TOK.test(toks[j] || "")) theaters = toks[j++];
    if (MONEY_TOK.test(toks[j] || "")) perTheater = toks[j++];
    if (MONEY_TOK.test(toks[j] || "")) cume = toks[j++];
    if (/^\d{1,4}$/.test(toks[j] || "")) days = Number(toks[j++]);
    films.push({
      rank, title, dailyGross, cume, dailyChangePct, weeklyChangePct, theaters, perTheater,
      daysInRelease: days, dayInRelease: days ? `Day ${days}` : null,
    });
    i = j - 1;
  }
  return films;
}

// The page states its own row count ("Reporting movies: 17") and its own chart date — use BOTH rather
// than trusting a computed date or an unverified parse. A short parse is now LOUD, never silent.
export function chartMetaFromText(text) {
  const rm = String(text || "").match(/Reporting movies:\s*(\d+)/i);
  const dm = String(text || "").match(/Box Office\s+\w+day,\s+([A-Z][a-z]+ \d{1,2}, \d{4})/);
  const parsedDate = dm ? new Date(dm[1] + " UTC") : null;
  return {
    reportedRows: rm ? Number(rm[1]) : null,
    date: parsedDate && !isNaN(parsedDate) ? parsedDate.toISOString().slice(0, 10) : null,
  };
}

export async function fetchDailyChart({ findImpl = findContent, chatImpl = null, nowMs = null, max = 25, cache = true } = {}) {
  if (cache) {
    const cached = readChartCache({ nowMs: nowMs || Date.now() });
    if (cached) return { films: cached.films, date: cached.date, fromCache: true };
  }
  const d = new Date(nowMs || Date.now());
  const ymd = (off) => new Date(d.getTime() - off * 86400000).toISOString().slice(0, 10);
  const seeds = [
    { url: "https://www.the-numbers.com/daily-box-office-chart", owner: "The Numbers", tier: 1 }, // latest, clean per-film
    { url: `https://www.boxofficemojo.com/date/${ymd(1)}/`, owner: "Box Office Mojo", tier: 1 },   // yesterday, per-film
    { url: `https://www.boxofficemojo.com/date/${ymd(2)}/`, owner: "Box Office Mojo", tier: 1 },
  ];
  const seen = new Set();
  const merged = [];
  let chartDate = null;
  for (const seed of seeds) {
    const res = await findImpl(
      { query: "daily box office chart", title: "box office", primaryEntity: "box office chart", sources: [seed] },
      { corroborate: false, maxSources: 2, maxExtract: 2 },
    ).catch(() => null);
    // 64KB: these chart pages run ~3KB, but a 16KB cap silently truncated the lower ranks off a long chart.
    const text = (res?.sources || []).map((s) => s.text || "").join("\n").slice(0, 64000);
    if (res?.blocked || text.length < 200) continue;

    // DETERMINISTIC FIRST — a published table parses exactly; the LLM is only a fallback for a page whose
    // shape we don't recognise. A short parse is announced, never silently accepted.
    const meta = chartMetaFromText(text);
    let rows = parseChartText(text);
    // The page states its own row count; a shortfall is the exact shape of the bug that hid a $51.28M #1
    // opening for days. Recorded as a FAULT (surfaces in report.faults + a workflow annotation), never a
    // bare log that scrolls past.
    assertCount(`chart:${seed.owner}`, rows.length, meta.reportedRows, { label: "chart rows" });
    let data = rows.length >= 5 ? { films: rows } : null;
    if (!data) {
      try { ({ data } = await agentChat("gatherer", { system: SYS, user: `CHART TEXT:\n${text}\n\nJSON: ${SCHEMA}` }, chatImpl ? { chatImpl } : {})); }
      catch { data = null; }
      if (data?.films?.length) console.log(`  chart: deterministic parse found ${rows.length} rows, LLM fallback returned ${data.films.length}`);
    }
    // Use the page's OWN chart date; seeds carrying a DIFFERENT day are rejected so a union can never
    // blend two chart days into one article's numbers.
    if (data?.films?.length) {
      if (!chartDate) chartDate = meta.date || null;
      else if (meta.date && meta.date !== chartDate) { console.log(`  chart: skipping ${seed.owner} (date ${meta.date} != ${chartDate})`); continue; }
    }
    for (const f of data?.films || []) {
      const title = String(f?.title || "").trim();
      if (!title) continue;
      const key = title.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (seen.has(key)) continue;
      if (!(f.cume || f.dailyGross)) continue;                 // must carry a real domestic figure
      if (!scopeOk({ title, overview: "" })) continue;         // Hollywood / English-language only
      // ACTIVE box office ONLY — skip a film winding down / released long ago (owner: don't post about
      // months-ago films). Daily gross below the floor = essentially done its theatrical run. When the daily
      // figure is missing we keep it (the chart is rank-ordered by daily gross, so it's still a top title).
      const daily = normMoney(f.dailyGross);
      if (daily != null && daily < DAILY_GROSS_FLOOR) continue;
      // ACTIVE RELEASE ONLY (owner: never post about a film from months ago) — but "old" alone is the wrong
      // test: Backrooms at day 50 was still doing $215k/day as a top-11 title, which is a real story, while
      // Devil Wears Prada 2 at day 78 was doing $12k on 40 screens, which is not. So a long-running film is
      // dropped only once it is ALSO no longer doing real business.
      if (Number.isFinite(f.daysInRelease) && f.daysInRelease > MAX_DAYS_IN_RELEASE
          && (daily == null || daily < LONG_RUN_DAILY_FLOOR)) continue;
      seen.add(key);
      merged.push({
        title, dailyGross: f.dailyGross || null, cume: f.cume || null, dailyChangePct: f.dailyChangePct || null,
        theaters: f.theaters || null, perTheater: f.perTheater || null, dayInRelease: f.dayInRelease || null,
        daysInRelease: Number.isFinite(f.daysInRelease) ? f.daysInRelease : null,
        rank: Number(f.rank) || merged.length + 1, source: seed.owner,
      });
    }
    // No early break: the chart IS the day's supply. Stopping at 8 rows capped box-office output at 8/day
    // regardless of how many films were actually in theaters — the single largest cause of low volume.
  }
  merged.sort((a, b) => a.rank - b.rank);
  // Zero films is never a real day — there are always films in US theaters. It means every seed failed,
  // which previously looked identical to "nothing worth covering".
  if (!merged.length) fault("chart", "chart parse produced ZERO films from all seeds — supply outage, not a quiet day", { severity: SEV.CRITICAL });
  const chart = { films: merged.slice(0, max), date: chartDate || ymd(1) };
  // Write the cache when this parse is at least as complete as what's already cached — a lossy morning
  // fetch must never freeze a thin chart in place for the whole LA day.
  if (cache && chart.films.length >= 5) {
    const prev = readChartCache({ nowMs: nowMs || Date.now() });
    if (!prev || chart.films.length >= (prev.films || []).length) writeChartCache(chart, { nowMs: nowMs || Date.now() });
  }
  return chart;
}
