// NETFLIX TOP 10 — FIRST-HAND weekly hours-viewed data (plan §4b — the streaming "win"). Free, no key:
// Netflix publishes its global Top 10 as a downloadable TSV. We fetch the LATEST week and expose the
// English Films + TV rows (Hollywood/English focus) with REAL hours viewed, so a "Netflix Top 10 this
// week — X million hours" article is first-hand, not a rewrite of an outlet. Deterministic; injectable
// fetch so the offline suite stays network-free. Columns (verified live 2026-07-11): week, category,
// weekly_rank, show_title, season_title, weekly_hours_viewed, runtime, weekly_views, cumulative_weeks_in_top_10.
const TSV_URL = "https://www.netflix.com/tudum/top10/data/all-weeks-global.tsv";

const parseNum = (s) => { const n = parseInt(String(s ?? "").replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) ? n : null; };
export const fmtHours = (n) => {
  if (n == null) return null;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million hours`;
  return `${n.toLocaleString("en-US")} hours`;
};

// parseNetflixTsv(text) → { week, films:[row], tv:[row] } for the LATEST week, English lists only.
export function parseNetflixTsv(text) {
  const lines = String(text || "").trim().split(/\r?\n/);
  if (lines.length < 2) return { week: null, films: [], tv: [] };
  const head = lines[0].split("\t").map((h) => h.trim());
  const ci = {
    week: head.indexOf("week"), cat: head.indexOf("category"), rank: head.indexOf("weekly_rank"),
    show: head.indexOf("show_title"), season: head.indexOf("season_title"), hours: head.indexOf("weekly_hours_viewed"),
    runtime: head.indexOf("runtime"), views: head.indexOf("weekly_views"), weeks: head.indexOf("cumulative_weeks_in_top_10"),
  };
  if (ci.week < 0 || ci.show < 0 || ci.hours < 0) return { week: null, films: [], tv: [] };
  const rows = lines.slice(1).map((l) => l.split("\t"));
  const allWeeks = rows.map((r) => (r[ci.week] || "").trim()).filter(Boolean).sort();
  const latest = allWeeks[allWeeks.length - 1] || null;
  const pick = (label) => rows
    .filter((r) => (r[ci.week] || "").trim() === latest && (r[ci.cat] || "").trim() === label)
    .map((r) => {
      const hoursRaw = parseNum(r[ci.hours]);
      return {
        title: (r[ci.show] || "").trim(), season: (r[ci.season] || "").trim() || null,
        rank: parseNum(r[ci.rank]), hoursRaw, hours: fmtHours(hoursRaw),
        views: parseNum(r[ci.views]), runtime: (r[ci.runtime] || "").trim() || null,
        weeksInTop10: parseNum(r[ci.weeks]),
      };
    })
    .filter((x) => x.title)
    .sort((a, b) => (a.rank || 99) - (b.rank || 99));
  return { week: latest, films: pick("Films (English)"), tv: pick("TV (English)") };
}

// fetchNetflixTop10() → the parsed latest week, or empty lists (never throws).
export async function fetchNetflixTop10({ fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(TSV_URL, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return { week: null, films: [], tv: [] };
    return parseNetflixTsv(await r.text());
  } catch { return { week: null, films: [], tv: [] }; }
}

// A compact grounding block for the writer/synthesizer — the ONLY hours figures that are real.
export function netflixBlock(row, { week } = {}) {
  if (!row) return "";
  const L = [`NETFLIX TOP 10 VERIFIED DATA${week ? ` (week of ${week})` : ""} — these are Netflix's OWN published`
    + ` numbers; state them ONLY as given, attributed to "Netflix's Top 10". Invent NO other viewership figure:`];
  L.push(`Title: ${row.title}${row.season ? ` — ${row.season}` : ""}`);
  if (row.rank) L.push(`This week's rank: #${row.rank}`);
  if (row.hours) L.push(`Hours viewed this week: ${row.hours}`);
  if (row.views) L.push(`Views this week: ${row.views.toLocaleString("en-US")}`);
  if (row.weeksInTop10) L.push(`Weeks in the Top 10: ${row.weeksInTop10}`);
  return L.join("\n");
}
