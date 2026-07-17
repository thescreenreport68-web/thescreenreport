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
import { scopeOk, DAILY_GROSS_FLOOR, DATA_DIR } from "./config.bo.mjs";
import { normMoney } from "./moneyGuard.mjs";

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
const laDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(ms));
export function readChartCache({ nowMs = Date.now(), file = CHART_CACHE } = {}) {
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    if (c?.laDay === laDay(nowMs) && Array.isArray(c.films) && c.films.length) return c;
  } catch {}
  return null;
}
export function writeChartCache(chart, { nowMs = Date.now(), file = CHART_CACHE } = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ laDay: laDay(nowMs), fetchedAt: new Date(nowMs).toISOString(), ...chart }, null, 1));
  } catch {}
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
  for (const seed of seeds) {
    const res = await findImpl(
      { query: "daily box office chart", title: "box office", primaryEntity: "box office chart", sources: [seed] },
      { corroborate: false, maxSources: 2, maxExtract: 2 },
    ).catch(() => null);
    const text = (res?.sources || []).map((s) => s.text || "").join("\n").slice(0, 16000);
    if (res?.blocked || text.length < 200) continue;
    let data = null;
    try { ({ data } = await agentChat("gatherer", { system: SYS, user: `CHART TEXT:\n${text}\n\nJSON: ${SCHEMA}` }, chatImpl ? { chatImpl } : {})); }
    catch { data = null; }
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
      seen.add(key);
      merged.push({ title, dailyGross: f.dailyGross || null, cume: f.cume || null, dailyChangePct: f.dailyChangePct || null, theaters: f.theaters || null, dayInRelease: f.dayInRelease || null, rank: Number(f.rank) || merged.length + 1 });
    }
    if (merged.length >= 8) break; // one good chart is plenty
  }
  merged.sort((a, b) => a.rank - b.rank);
  const chart = { films: merged.slice(0, max), date: ymd(1) };
  if (cache && chart.films.length >= 5) writeChartCache(chart, { nowMs: nowMs || Date.now() }); // only cache a real chart
  return chart;
}
