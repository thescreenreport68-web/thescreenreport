import { _setNumbersSection as qaSetNumbersSection } from "./agents/qa.mjs";
// ASSEMBLE (box-office) — frontmatter per the SITE CONTRACT (site/lib/articles.ts): the structured
// boxOffice{}/records[]/whereToWatch[] fields the UI renders, plus the homepage-placement signals
// (category/subcategory/author/trendScore/signals/eventSlug/eventType/outletCount/storyStatus). The
// structured money fields are built DETERMINISTICALLY from the gatherer's verbatim figures + the TMDB
// data — never from the writer's prose (fidelity). gray-matter via createRequire (same as every lane).
// NEVER emit an undefined key — gray-matter throws.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CONTENT_DIR, BOXOFFICE_AUTHOR_SLUG, EVENT_TYPE, FORMS, SEO } from "./config.bo.mjs";
import { fault, SEV } from "./health.mjs";
import { normMoney, canonicalFigures, numberConsistencyGate } from "./moneyGuard.mjs";
import { loadFrozen, saveFrozen, resolveFrozen } from "./seoFrozen.mjs";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");

const slugify = (s) => {
  const full = (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (full.length <= 80) return full;
  const cut = full.slice(0, 80);
  return cut.includes("-") ? cut.replace(/-[^-]*$/, "") : cut;
};

// ── ONE STORY = ONE URL (owner directive 2026-07-24) ─────────────────────────────────────────────
// A film's daily box-office coverage lives at ONE stable URL — `<film>-box-office-tracker` — that updates
// in place. The old model minted a new day-N slug every day (64 near-duplicate URLs across 15 films),
// which hurt the whole site in Google. The slug is now a function of the FILM ONLY, never the day or the
// number, so the same URL is refreshed daily instead of a new one being created.
export const trackerSlug = (film) => slugify(`${film?.title || "film"}-box-office-tracker`);

// The "## Daily Tracking" table is the tracker's growing, genuinely-unique content: one row per day of
// real reported numbers. On each update we read the table already on the page, add today's row (or replace
// it if we somehow re-run the same day), and re-render — so history accumulates instead of spawning URLs.
const DAY_TABLE_H = "## Daily Tracking";
function parseDailyTable(body) {
  const rows = [];
  const block = String(body || "").split(/\n(?=## )/).find((b) => b.trim().startsWith(DAY_TABLE_H));
  if (!block) return rows;
  for (const line of block.split("\n")) {
    const m = line.match(/^\|\s*(?:Day\s*)?(\d+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*$/i);
    if (!m || /^-+$/.test(m[2].replace(/[|\s:-]/g, ""))) continue; // skip header/separator
    rows.push({ day: Number(m[1]), date: m[2].trim(), daily: m[3].trim(), total: m[4].trim() });
  }
  return rows;
}
function mergeDailyRow(rows, { canon, dateISO }) {
  const day = Number(canon.dayInRelease);
  if (!Number.isFinite(day)) return rows;
  const d = new Date(dateISO);
  const dateStr = isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
  // Word format ($5.5 million) so the new row reads the same as the migrated historical rows in the table.
  const row = {
    day, date: dateStr,
    daily: Number.isFinite(canon.dailyGross?.raw) ? fmtUSDWords(canon.dailyGross.raw) : (canon.dailyGross?.text || "—"),
    total: Number.isFinite(canon.domestic?.raw) ? fmtUSDWords(canon.domestic.raw) : (canon.domestic?.text || "—"),
  };
  const out = rows.filter((r) => r.day !== day); // one row per day; a re-run replaces, never duplicates
  out.push(row);
  out.sort((a, b) => a.day - b.day);
  return out;
}
function renderDailyTable(rows) {
  if (!rows.length) return "";
  const body = rows.map((r) => `| ${r.day} | ${r.date} | ${r.daily} | ${r.total} |`).join("\n");
  return `\n\n${DAY_TABLE_H}\n\nDomestic box-office totals for each reported day of the theatrical run.\n\n| Day | Date | Daily Gross | Domestic Total |\n| --- | --- | --- | --- |\n${body}`;
}

const trimAtWord = (str, max) => {
  const t = (str || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const atSpace = cut.lastIndexOf(" ");
  return (atSpace > max * 0.6 ? cut.slice(0, atSpace) : cut.slice(0, max)).replace(/[\s,;:—–-]+$/, "");
};
// Trailing "as/in/to/the/…" left by a hard length-trim reads broken — strip it (titles + meta share this).
const DANGLING_TAIL = /\s+(in|on|of|to|for|with|and|but|as|the|a|an|that|which|from|about)\s*$/i;
const stripDangling = (s) => { let t = (s || "").trim(); while (DANGLING_TAIL.test(t)) t = t.replace(DANGLING_TAIL, "").trim(); return t.replace(/[\s,;:—–-]+$/, "").trim(); };
// Strip markdown tokens from a META field — a live meta description shipped "## The Movie:…" verbatim
// because a writer put a heading in the description and nothing sanitized it. Descriptions are plain text.
const deMark = (s) => String(s || "")
  .replace(/^#{1,6}\s+/gm, "").replace(/(\*\*|__|\*|_|`)/g, "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();

// Meta description: markdown-free, 140–160 target, and it must END ON A COMPLETE SENTENCE (live audit:
// descriptions were cut mid-sentence). Accumulate whole sentences while they fit; a single over-long
// sentence falls back to a word-trim with an explicit ellipsis (never a silent mid-clause scar).
const tidyMeta = (raw, max) => {
  const t = deMark(raw);
  if (!t) return "";
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = "";
  for (const s of sentences) {
    if (!out) { out = s; continue; }
    if ((out + " " + s).length <= max) out += " " + s;
    else break;
  }
  if (out.length > max) return stripDangling(trimAtWord(out, max - 1)) + "…";
  return /[.!?…]$/.test(out) ? out : out + ".";
};
export const seoFinish = ({ metaTitle, metaDescription }) => ({
  metaTitle: stripDangling(trimAtWord(metaTitle, SEO.metaTitleMax)),
  metaDescription: tidyMeta(metaDescription, SEO.metaDescMax),
});

// ── SEO metaTitle (the reader-facing `title` is left UNTOUCHED) ─────────────────────────────────────
// Owner rules: ≤55 chars, NO brand suffix, FILM title + the concrete number/rank/milestone FRONT-LOADED
// (box-office search is number/rank driven). Always carries a real figure or "#1". Deterministic, so every
// article complies even when the writer's metaTitle drifts long/brand-suffixed/number-less.
const BRAND_SUFFIX_RE = /\s*[|–—:-]\s*(the\s+)?screen\s*report\b.*$/i;
const HAS_FIGURE_RE = /\$\s?\d|\b\d+(\.\d+)?\s?(million|billion|m|b)\b|#\s?\d|\bno\.?\s?1\b|\btops\b|\bweekend\b/i;
const compactUSD = (raw) => {
  const v = normMoney(raw);
  if (v == null) return null;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v % 1e9 ? 1 : 0)}B`;
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${v}`;
};
const quoteFilm = (name) => { const n = String(name || "").trim(); return n ? (/^['"‘“]/.test(n) ? n : `'${n}'`) : ""; };
export function buildMetaTitle(rawMeta, { title, film = {}, gathered = {}, boxData = {}, form = {}, canon = null }) {
  const MIN = SEO.metaTitleMin, MAX = SEO.metaTitleMax;
  // SINGLE SOURCE OF TRUTH: every figure in the metaTitle comes from the canonical set — the same set the
  // boxOffice block, FAQs, and body draw from — so the metaTitle can never contradict the article again.
  const c = canon || canonicalFigures({ gathered, boxData, film });
  const filmName = String(film.title || "").trim();
  const q = quoteFilm(filmName);
  const clean = (s) => stripDangling(String(s || "").replace(BRAND_SUFFIX_RE, "").trim());
  const leads = (s) => !filmName || s.toLowerCase().slice(0, filmName.length + 4).includes(filmName.toLowerCase());

  // Candidate metaTitles (varied length), all FILM-led with a real figure/rank. Pick the LONGEST that fits
  // [45,55]; else the longest ≤55; last resort a trimmed base. So the metaTitle lands in the search-friendly band.
  const cands = [];
  const w = clean(rawMeta);
  // Keep the writer's own metaTitle ONLY if every money figure in it is canonical — a writer metaTitle
  // carrying an invented "$800M" used to win the candidate race and die at the gate (a wasted hold).
  const canonRaws = ["openingWeekend", "domestic", "international", "worldwide", "budget", "dailyGross", "hoursViewed"]
    .map((k) => c?.[k]?.raw).filter((v) => Number.isFinite(v) && v > 0);
  const figsCanonical = (text) => {
    for (const m of String(text || "").matchAll(/\$\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:thousand|million|billion|[KMB](?![a-z])))?|\b\d[\d,]*(?:\.\d+)?\s*(?:million|billion)\b/gi)) {
      const v = normMoney(m[0]);
      if (v != null && !canonRaws.some((a) => Math.abs(v - a) / a <= 0.05)) return false;
    }
    return true;
  };
  if (w && leads(w) && HAS_FIGURE_RE.test(w) && figsCanonical(w)) cands.push(w);
  if (form.streaming) {
    const r = gathered.netflixRank ? `#${gathered.netflixRank}` : null;
    const hrs = c.hoursViewed?.text || gathered.hoursViewed || null;
    if (r && hrs) cands.push(`${q} Hits ${r} on Netflix With ${hrs}`);
    if (r) cands.push(`${q} Climbs to ${r} on Netflix's Top 10 Chart`, `${q} Hits ${r} on Netflix's Top 10`, `${q} Is ${r} on Netflix This Week`);
    if (hrs) cands.push(`${q} Draws ${hrs} on the Netflix Top 10`);
    cands.push(`${q} Is Blowing Up on Netflix's Top 10 Chart`, `${q} Climbs the Netflix Global Top 10`);
  } else {
    // A chart UPDATE's H1 headlines the DOMESTIC total — the metaTitle must headline the SAME metric (the
    // live audit found SERP titles promising "$882M Worldwide" over pages reporting "$410.6M domestic").
    const isDaily = !!film?.dailyChart;
    const useWW = !isDaily && c.worldwide != null && (c.domestic == null || c.worldwide.raw >= c.domestic.raw);
    const fig = useWW ? compactUSD(c.worldwide.text)
      : compactUSD((c.domestic || c.openingWeekend || c.worldwide)?.text);
    const scope = useWW ? "Worldwide" : "Domestic";
    if (fig) {
      cands.push(
        `${q} Crosses ${fig} at the ${scope} Box Office`,
        `${q} Climbs to ${fig} at the ${scope} Box Office`,
        `${q} Hits ${fig} at the ${scope} Box Office`,
      );
      // The scope qualifier is LOAD-BEARING for a worldwide figure — it may never be trimmed away (a
      // "$280M at the Box Office" metaTitle over a $116M-domestic page is a lie). Unqualified shorter
      // fallbacks exist ONLY for domestic figures, where US trade convention reads them as domestic.
      if (!useWW) cands.push(`${q} Reaches ${fig} at the Box Office`, `${q} Hits ${fig} at the Box Office`);
    }
    cands.push(`${q} Box Office: ${fig || "The Latest Numbers Explained"}`, `${q} Box Office Report and Latest Numbers`);
  }
  const fit = cands.map(clean).filter((cnd) => cnd && leads(cnd));
  const inRange = fit.filter((cnd) => cnd.length >= MIN && cnd.length <= MAX).sort((a, b) => b.length - a.length);
  if (inRange.length) return inRange[0];
  const underMax = fit.filter((cnd) => cnd.length <= MAX).sort((a, b) => b.length - a.length);
  if (underMax.length) return underMax[0];
  return stripDangling(trimAtWord(fit[0] || w || cleanTitle(title), MAX)) || cleanTitle(title);
}

// Basic SEO KEYWORDS (tags) on EVERY article — non-stuffy, drawn from the real facts (film, cast, category,
// year). Guarantees ≥4 relevant tags; readability is untouched (they live in frontmatter, never the prose).
function ensureTags(article, { film = {}, form = {}, gathered = {} }) {
  const seen = new Set(); const out = [];
  const push = (t) => { t = String(t || "").trim(); const k = t.toLowerCase(); if (t && t.length <= 40 && !seen.has(k) && out.length < 8) { seen.add(k); out.push(t); } };
  for (const t of (Array.isArray(article.tags) ? article.tags : [])) push(t);
  if (film.title) { push(film.title); push(form.streaming ? `${film.title} Netflix` : `${film.title} box office`); }
  for (const c of (gathered.cast || []).slice(0, 2)) push(c);
  push(form.category === "tv" ? "TV shows" : form.streaming ? "Streaming" : "Box office");
  const yr = String(film.year || (film.releaseDate || "").slice(0, 4) || "").trim();
  if (/^\d{4}$/.test(yr)) push(`${yr} movies`);
  return out.slice(0, 8);
}
export function cleanTitle(title) {
  let t = (title || "").trim();
  if (t.length > 100) {
    const cut = t.slice(0, 100);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(", "), cut.lastIndexOf(" — "));
    t = (stop > 40 ? cut.slice(0, stop) : cut.replace(/\s+\S*$/, "")).trim();
  }
  while (DANGLING_TAIL.test(t)) t = t.replace(DANGLING_TAIL, "").trim();
  return t.replace(/[\s,;:—–-]+$/, "").trim();
}
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

// Collapse provider tier variants + dedupe: "Netflix, Netflix Standard with Ads" → "Netflix".
const normPlatform = (p) => {
  const parts = String(p || "").split(/,\s*/)
    .map((s) => s.replace(/\s+(Standard|Basic|Premium|Ad-Supported)(\s+with\s+Ads)?$/i, "").replace(/\s+with\s+Ads$/i, "").trim())
    .filter(Boolean);
  return [...new Set(parts)].join(", ");
};

// Build the structured boxOffice{} strictly from the CANONICAL figure set (single source of truth) —
// the same set the metaTitle, FAQs, and consistency gate use, so the scoreboard can never disagree
// with the rest of the article.
function buildBoxOffice(canon, gathered = {}) {
  const bo = clean({
    domestic: canon.domestic?.text || undefined,
    international: canon.international?.text || undefined,
    worldwide: canon.worldwide?.text || undefined,
    budget: canon.budget?.text || undefined,
    openingWeekend: canon.openingWeekend?.text || undefined,
    theaters: canon.theaters?.text || undefined,
    perTheater: gathered.perTheater || undefined,
    changePct: canon.dropPct?.text || undefined,
  });
  return Object.keys(bo).length ? bo : undefined;
}

// DETERMINISTIC COMPLETENESS — the writer/QA can slip; these guarantee the article is never published
// missing FAQs, carrying a generic template heading, or mislabelling a series as a movie. Non-bypassable.

// ≥2 REAL FAQs with REAL answers — every figure from the CANONICAL set (never two different worldwide
// totals across two FAQs again). A writer FAQ carrying a NON-canonical figure is DROPPED here (deterministic
// salvage — the system backfill replaces it) instead of letting it reach the consistency gate and hold the
// whole article; the gate remains the last wall for anything that slips through.
function ensureFaq(article, { canon = {}, gathered = {}, boxData = {}, film = {}, form = {} }) {
  const canonVals = ["openingWeekend", "domestic", "international", "worldwide", "budget", "dailyGross", "hoursViewed"]
    .map((k) => canon?.[k]?.raw).filter((v) => Number.isFinite(v) && v > 0);
  const faqFigOk = (text) => {
    for (const m of String(text || "").matchAll(/\$\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:thousand|million|billion))?|\b\d[\d,]*(?:\.\d+)?\s*(?:million|billion)\b/gi)) {
      const v = normMoney(m[0]);
      if (v != null && !canonVals.some((a) => Math.abs(v - a) / a <= 0.05)) return false;
    }
    return true;
  };
  // Chart updates use SYSTEM FAQs ONLY — writer FAQs kept smuggling near-canonical figures into scoped
  // contradictions ("$429M ... budget"); the canon-built set below is complete and can never disagree.
  const cand = (film?.dailyChart ? [] : (article.faq || []))
    .filter((f) => f?.q && f?.a && String(f.a).trim().length > 15)
    .filter((f) => faqFigOk(f.q) && faqFigOk(f.a))
    .slice(0, 4);
  const t = film.title || article.title || "the title";
  const add = (q, a) => { a = (a || "").trim(); if (a.length > 15 && cand.length < 4 && !cand.some((f) => f.q === q)) cand.push({ q, a }); };
  if (form.streaming) {
    if (canon.hoursViewed?.text || gathered.hoursViewed) add(`How many hours has '${t}' been viewed on Netflix?`,
      `According to Netflix's Top 10 data${gathered.netflixWeek ? ` for the week of ${gathered.netflixWeek}` : ""}, '${t}' logged ${canon.hoursViewed?.text || gathered.hoursViewed}${gathered.netflixRank ? `, ranking #${gathered.netflixRank} on the chart` : ""}.`);
    add(`Where can I watch '${t}'?`, `'${t}' is streaming on ${gathered.platform || "Netflix"}.`);
    if (gathered.weeksInTop10) add(`How long has '${t}' been in the Netflix Top 10?`,
      `'${t}' has spent ${gathered.weeksInTop10} week${gathered.weeksInTop10 > 1 ? "s" : ""} in the Netflix Top 10.`);
  } else {
    const total = canon.domestic || canon.openingWeekend || canon.worldwide;
    if (total) add(`How much has '${t}' made at the box office?`,
      `'${t}' has grossed ${total.text}${canon.domestic && canon.worldwide ? ` domestically, with ${canon.worldwide.text} worldwide` : canon.theaters ? ` across ${canon.theaters.text} theaters` : ""}.`);
    if (canon.budget) add(`What is the production budget of '${t}'?`, `'${t}' was produced on a reported budget of ${canon.budget.text} before marketing.`);
    if (canon.theaters) add(`How many theaters is '${t}' playing in?`, `'${t}' is currently playing across ${canon.theaters.text} theaters.`);
    if (film?.dailyChart && canon.dayInRelease) add(`How long has '${t}' been in theaters?`, `'${t}' is ${canon.dayInRelease} days into its theatrical run${canon.dailyGross ? `, adding ${canon.dailyGross.text} in its most recent day` : ""}.`);
    if (canon.worldwide && canon.domestic) add(`What is '${t}' worldwide box office total?`, `'${t}' has taken in ${canon.worldwide.text} at the worldwide box office.`);
    if (gathered.platform || (boxData.providers?.stream || []).length) add(`Where can I watch '${t}'?`,
      `'${t}' is available on ${gathered.platform || (boxData.providers.stream || []).join(", ")}.`);
  }
  return cand.slice(0, 4);
}

// Strip GENERIC template headings (## or **bold?** pseudo-headings) — story-specific headings are kept.
const TEMPLATE_HEADING_RE = /^(why (is|are|did|does|has)\b|how (big|did|are|does|much|is)\b|what(?:'s| is| are| does| comes|'s next| happens| happened| behind| next)\b|where (can|to|is)\b|who (is|are|stars)\b|is (it|this|the)\b|what comes next\b)/i;
function deTemplate(body) {
  const out = [];
  for (const line of String(body || "").split("\n")) {
    const l = line.trim();
    const heading = /^#{1,6}\s/.test(l) ? l.replace(/^#{1,6}\s*/, "")
      : /^\*\*[^*]+\*\*$/.test(l) ? l.replace(/^\*\*/, "").replace(/\*\*$/, "") : null;
    if (heading !== null && TEMPLATE_HEADING_RE.test(heading.trim())) continue; // drop the generic heading; the paragraph still reads
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// LEDE FIX (SEO heading hygiene): the article TITLE is the page H1; the body must OPEN with a paragraph, not
// a heading. If the writer put the opening hook as an ## H2 (or #), strip the heading markers so the lede is a
// normal paragraph and the H2s below it stay a proper sub-heading hierarchy.
function fixLede(body) {
  const lines = String(body || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (/^#{1,6}\s/.test(lines[i])) lines[i] = lines[i].replace(/^#{1,6}\s+/, "").replace(/^\s*[-–—]\s+/, "");
    break;
  }
  return lines.join("\n");
}

// Bare template-label LINES are pure prompt scaffold the writer leaked — DROP the line (deterministic
// salvage). ONE pattern, shared with the scaffoldViolations wall below, so the salvage and the wall can
// never disagree about what a label is.
//
// The label may appear WITH a colon ("The Movie: …") or ALONE on its own line ("The Movie"). The original
// pattern required the colon, so a bare label was neither stripped NOR blocked and shipped as a stray
// orphan line above the lede — 3 of 8 live articles on 2026-07-17 ("The Movie", "What It Is"). The
// `(:|$)` alternation closes that; a real sentence that merely STARTS with the words ("The Movie was a
// hit") still fails the match and is never touched. Markdown emphasis is tolerated (**The Movie**);
// markdown HEADINGS ("## The Numbers") never match — they start with '#', which is intentional and kept.
const LABEL_LINE_RE = /^(The (Movie|Series|Film)|Closing (Line|Thoughts?)|What It Is|The Cast|The Appeal|The Numbers|The Run|Lead)\s*(:|$)/;
const isLabelLine = (line) => LABEL_LINE_RE.test(String(line).trim().replace(/^[*_]+|[*_]+$/g, "").trim());

function stripLabelLines(body) {
  return String(body || "").split("\n")
    .filter((line) => !isLabelLine(line))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// A TRENDING-TV subject is a series, not a movie — correct the schema type the writer emits.
function fixAbout(about, { film, form }) {
  const arr = Array.isArray(about) ? about.filter((e) => e && e.name && e.type) : [];
  if (!(form.category === "tv")) return arr;
  const ft = String(film.title || "").toLowerCase().trim();
  return arr.map((e) => (e.type === "Movie" && String(e.name).toLowerCase().trim() === ft ? { ...e, type: "TVSeries" } : e));
}

// Display-friendly USD for deterministic titles: "$47.6 Million", "$1.02 Billion", "$519,154".
const fmtUSDWords = (raw) => {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw >= 1e9) return `$${(raw / 1e9).toFixed(2).replace(/0$/, "")} Billion`;
  if (raw >= 1e6) return `$${(raw / 1e6).toFixed(1).replace(/\.0$/, "")} Million`;
  return `$${Math.round(raw).toLocaleString("en-US")}`;
};

// Deterministic "At the Box Office" numbers section — built from the CANONICAL set and appended at ASSEMBLY
// (after every wall has run), so no fidelity/no-invention cut can ever strip the article's own verified
// figures again (the 9/9 numbers-missing live failure). The headline number is GUARANTEED in the prose.
export function numbersSection(canon, filmTitle) {
  const sentences = [];
  const clause = [];
  if (canon.domestic) clause.push(`has grossed ${canon.domestic.text} at the domestic box office`);
  if (canon.dayInRelease) clause.push(`${canon.dayInRelease} days into its theatrical run`);
  if (canon.theaters) clause.push(`while playing across ${canon.theaters.text} theaters`);
  if (clause.length) sentences.push(`${filmTitle} ${clause.join(", ")}.`);
  if (canon.dailyGross) sentences.push(`The film added ${canon.dailyGross.text} in its most recent day of release.`);
  if (canon.worldwide) sentences.push(`Worldwide, it has taken in ${canon.worldwide.text}.`);
  if (canon.budget) sentences.push(`It carries a reported production budget of ${canon.budget.text}.`);
  return sentences.length ? `\n\n## At the Box Office\n\n${sentences.join(" ")}` : "";
}

// SCAFFOLD CHECK — a live article shipped a literal "[Box office section will be inserted here by the
// system.]", another ended on an empty "## Closing Line". No placeholder, empty section, bare template
// label, flattened heading, or under-floor body can reach a reader. Deterministic, publish-blocking.
// Hand QA the same builder so its word floor measures the body the reader actually receives.
qaSetNumbersSection(numbersSection);

export function scaffoldViolations(body, fm) {
  const v = [];
  if (/\[[^\]]{0,80}(system|insert|placeholder|section (will|here)|to be (added|filled))[^\]]{0,80}\]/i.test(body))
    v.push("scaffold: literal system placeholder in body");
  const lines = String(body || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^#{1,6}\s/.test(t)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length || /^#{1,6}\s/.test(lines[j].trim())) v.push(`scaffold: empty section "${t.slice(0, 40)}"`);
    } else if (isLabelLine(t)) { // same pattern the stripper uses — salvage and wall can never disagree
      v.push(`scaffold: bare template label line "${t.slice(0, 40)}"`);
    }
  }
  if (/[^\n]\s##\s/.test(body)) v.push("scaffold: mid-paragraph ## (markdown flattened)");
  const words = String(body || "").split(/\s+/).filter(Boolean).length;
  if (words < 180) v.push(`scaffold: body ${words} words < 180 floor`);
  if ((fm.keyTakeaways || []).length < 3) v.push("scaffold: fewer than 3 keyTakeaways");
  if ((fm.faq || []).filter((f) => f?.q && f?.a).length < 2) v.push("scaffold: fewer than 2 FAQs");
  return v;
}

export function buildBoxOfficeMarkdown({ article, trigger, angle, film, gathered = {}, boxData = {}, image, dateISO, momentum = null, priorDate = null, priorTable = null }) {
  const form = FORMS[angle.form];
  // ── SINGLE SOURCE OF TRUTH: ONE reconciled canonical figure set; EVERY surface below draws from it. ──
  const canon = canonicalFigures({ gathered, boxData, film });
  const isChart = !!film?.dailyChart;
  // Milestone from the tracker's materiality tag ("100m" = crossed $100M since our last report).
  const msRaw = momentum?.tag && /^(\d+)m$/.test(momentum.tag) ? parseInt(momentum.tag, 10) * 1e6 : null;
  const msText = msRaw ? fmtUSDWords(msRaw) : null;
  // Daily factual updates get a DETERMINISTIC title with an HONEST momentum verb from real data — never the
  // writer's spin ("Sinks With Disastrous $43M"), never the tautological "Climbs" (a cume always climbs):
  // a milestone crossing leads with the milestone; otherwise the day's real added gross carries the story.
  let title = cleanTitle(article.title);
  if (isChart && canon.domestic) {
    const day = canon.dayInRelease;
    const dom = fmtUSDWords(canon.domestic.raw);
    const dg = canon.dailyGross ? fmtUSDWords(canon.dailyGross.raw) : null;
    title = cleanTitle(
      msText ? `${film.title} Box Office: Crosses ${msText} Domestically${day ? ` on Day ${day}` : ""}`
      : dg ? `${film.title} Box Office Day ${day || "Update"}: Adds ${dg} as Domestic Total Hits ${dom}`
      : `${film.title} Box Office${day ? ` Day ${day}` : " Update"}: Domestic Total Hits ${dom}`);
  }
  // Chart updates share ONE stable per-film URL (the tracker); everything else keeps a title-derived slug.
  const slug = isChart ? trackerSlug(film) : slugify(title);
  // FROZEN TRACKER SEO: a tracker's headline + standfirst are set ONCE (evergreen, figure-free) and then
  // reused verbatim forever. Without this, buildMetaTitle regenerates the headline from the day's figures
  // on EVERY update — i.e. the title churn that preceded the 96% impressions collapse.
  let frozenSeo = null;
  if (isChart) {
    const map = loadFrozen();
    const r = resolveFrozen(map, slug, film.title);
    if (r.created) saveFrozen(map);
    frozenSeo = r;
  }
  const boxOffice = buildBoxOffice(canon, gathered);
  // Records: a chart UPDATE carries ONLY the system milestone claim (stale opening-phase records were
  // recycling into day-N updates — "second-best AND third-best" in one article). Features keep gathered records.
  const records = isChart
    ? (msText ? [{ claim: `crossed ${msText} at the domestic box office` }] : [])
    : (gathered.records || []).filter(Boolean).map((r) => (typeof r === "string" ? { claim: r } : clean({ claim: r.claim, detail: r.detail })))
      .filter((r) => r.claim);
  // whereToWatch: TMDB providers (NOW-STREAMING / a landed title), or — for a Netflix Top 10 / trending
  // streaming piece — the platform the piece is about (Netflix) so the reader still gets a where-to-watch row.
  let whereToWatch = (boxData.whereToWatch || []).filter((w) => w?.title && w?.platform);
  if (!whereToWatch.length && form?.streaming && gathered?.platform) {
    whereToWatch = [{ title: film.title, platform: gathered.platform, type: "Stream" }];
  }
  whereToWatch = whereToWatch.map((w) => ({ ...w, platform: normPlatform(w.platform) }));

  // Chart updates: takeaways + metaDescription are SYSTEM-BUILT from the canonical set — the headline
  // figure is guaranteed present (live audit: 7/9 takeaway sets carried zero box-office facts, 2 were empty).
  const takeaways = isChart
    ? [
        canon.domestic ? `'${film.title}' has grossed ${canon.domestic.text} at the domestic box office${canon.dayInRelease ? ` through day ${canon.dayInRelease}` : ""}.` : null,
        canon.dailyGross ? `It added ${canon.dailyGross.text} in its most recent day${canon.theaters ? `, playing in ${canon.theaters.text} theaters` : ""}.` : null,
        msText ? `The film has now crossed ${msText} domestically.` : (canon.worldwide ? `The worldwide total stands at ${canon.worldwide.text}.` : (canon.budget ? `It carries a reported ${canon.budget.text} production budget.` : null)),
        (boxData.castRoles?.length ? `${boxData.castRoles[0].name} leads the cast${boxData.director ? ` for director ${boxData.director}` : ""}.` : (canon.worldwide && msText ? `The worldwide total stands at ${canon.worldwide.text}.` : null)),
      ].filter(Boolean).slice(0, 4)
    : (article.keyTakeaways || []);
  const chartMetaDesc = isChart && canon.domestic
    ? `${film.title} has grossed ${canon.domestic.text} at the domestic box office${canon.dayInRelease ? ` through day ${canon.dayInRelease}` : ""}${canon.dailyGross ? `, adding ${canon.dailyGross.text} in its latest daily haul` : ""}. ${boxData.overview ? String(boxData.overview).split(/(?<=[.!?])\s+/)[0] : ""}`.trim()
    : null;

  const fm = clean({
    title,
    slug,
    category: form.category,
    subcategory: form.subcategory,
    author: BOXOFFICE_AUTHOR_SLUG,
    // A tracker preserves its ORIGINAL publish date across every daily update (the article is not new —
    // it is being refreshed) and carries an `updated` freshness signal; Google rewards a stable URL that
    // updates, not a re-dated one. A brand-new tracker has no priorDate, so date = now.
    date: (isChart && priorDate) ? priorDate : dateISO,
    ...(isChart ? { updated: dateISO, boxOfficeTracker: true } : {}),
    dek: frozenSeo ? frozenSeo.dek : (article.dek || ""),
    // A frozen tracker headline bypasses buildMetaTitle entirely — it must ship byte-for-byte, forever.
    ...seoFinish({
      metaTitle: frozenSeo ? frozenSeo.metaTitle : buildMetaTitle(article.metaTitle, { title, film, gathered, boxData, form, canon }),
      metaDescription: chartMetaDesc || article.metaDescription || article.dek || "",
    }),
    tags: ensureTags(article, { film, form, gathered }),
    keyTakeaways: takeaways,
    faq: ensureFaq(article, { canon, gathered, boxData, film, form }),
    about: fixAbout(article.about, { film, form }),
    formatTag: form.formatTag,
    boxOffice,
    records: records.length ? records : undefined,
    whereToWatch: whereToWatch.length ? whereToWatch : undefined,
    // TODO (tracker increment, plan §6): weekendChart[] (the multi-film weekend chart) needs the full
    // trade weekend table + the run ledger — omitted in the lean single unit.
    // Homepage placement contract.
    trendScore: Number.isFinite(trigger.priority) ? trigger.priority : undefined,
    // Homepage trendingScore reads breakout + corroboration + type; enrich the finder's
    // recency/pop/breakout with corroboration (from the real outlet count) + a boxoffice type weight
    // so BO pieces earn trending-rail rank instead of scoring 0 on those axes.
    signals: (() => {
      const s = { ...(trigger.signals || {}) };
      s.corroboration = Math.min(10, gathered.outletCount || (trigger.sources || []).length || 1);
      s.type = 6;
      return Object.keys(s).length ? s : undefined;
    })(),
    eventSlug: trigger.eventSlug,
    eventType: EVENT_TYPE,
    outletCount: gathered.outletCount || (trigger.sources || []).length || undefined,
    storyStatus: "CONFIRMED",
    ...(image ? {
      image: image.image,
      imageAlt: image.alt || article.imageQuery || film.title,
      imageCredit: image.credit || "Photo via source",
      imageWidth: image.imageWidth,
      imageHeight: image.imageHeight,
    } : {}),
  });

  // Chart updates: the verified numbers section is appended HERE — after every QA wall has already run —
  // so the article's own figures are structurally uncuttable. The profile prose (walls-screened) carries the
  // movie; the system carries the money.
  // Order matters: fixLede FIRST (it may de-head a "## The Movie:" lede into a bare label line), THEN
  // stripLabelLines removes any bare label — the reverse order recreated labels after the strip.
  const body = (stripLabelLines(fixLede(deTemplate(article.body || ""))).trim() + (isChart ? numbersSection(canon, film.title) : "")).trim();
  // ── PRE-PUBLISH CONSISTENCY GATE: diff every dollar figure across ALL final surfaces against the
  // canonical set. ANY contradiction (a title claiming $100M when the block says $26.4M, two FAQs with
  // different worldwide totals) blocks the article — a self-contradicting article can never publish again.
  const consistency = numberConsistencyGate(
    { title: fm.title, metaTitle: fm.metaTitle, dek: fm.dek, metaDescription: fm.metaDescription,
      body, keyTakeaways: fm.keyTakeaways, faq: fm.faq },
    canon,
    { recordTexts: (fm.records || []).map((r) => r.claim) },
  );
  // DROP-EMPTY-SECTIONS (before the gate). The verdict/fidelity walls cut sentences, and when they empty a
  // section they leave a bare heading behind — which the scaffold gate then correctly refuses, holding an
  // otherwise-good article. A heading with no prose is not content; REMOVE it rather than lose the piece.
  // (Same deterministic rule already validated repairing 16 legacy articles.)
  const cleanBody = body.split(/\n(?=#{2,6}\s)/).filter((block) => {
    if (!/^#{2,6}\s/.test(block.trim())) return true;
    return block.split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim().length > 0;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // ── SCAFFOLD GATE: no placeholder, empty section, template label, flattened heading, or under-floor
  // body can reach a reader (replaces the deleted fast-accept path with a REAL floor for every form).
  const scaffold = scaffoldViolations(cleanBody, fm);
  // The Daily Tracking table is appended AFTER every gate — like the numbers section, it is system-built
  // from verified per-day figures and structurally uncuttable. It carries HISTORICAL figures that are not
  // in the current-day canon, so it must NOT go through numberConsistencyGate (which would flag every
  // prior day's total as "not a canonical figure"). Merged from the page's existing table + today's row.
  const dailyTable = isChart ? renderDailyTable(mergeDailyRow(priorTable || [], { canon, dateISO })) : "";
  const finalBody = cleanBody + dailyTable;
  const md = matter.stringify("\n" + finalBody + "\n", fm);
  return { slug, frontmatter: fm, md, canon, consistency, scaffold, dailyTable };
}

export function writeBoxOfficeArticle({ article, trigger, angle, film, gathered, boxData, image, dateISO, momentum = null, dir = CONTENT_DIR, dryRun = false }) {
  const isChart = !!film?.dailyChart;

  // ── ONE STORY = ONE URL: a chart update is an IN-PLACE refresh of the film's tracker. Read whatever is
  // already on the page so we PRESERVE its original publish date and GROW its Daily Tracking table instead
  // of starting over. The slug is a pure function of the film, so this path is deterministic.
  let priorDate = null, priorTable = null, trackerExists = false;
  if (isChart) {
    const trackerPath = path.join(dir, trackerSlug(film) + ".md");
    if (fs.existsSync(trackerPath)) {
      trackerExists = true;
      try {
        const g = matter.read(trackerPath);
        priorDate = g.data?.date || null;               // keep the earliest/original date
        priorTable = parseDailyTable(g.content);         // accumulate the history already published
      } catch { /* silent-ok: a corrupt tracker just re-seeds from today; consistency gate still protects it */ }
    }
  }

  const out = buildBoxOfficeMarkdown({ article, trigger, angle, film, gathered, boxData, image, dateISO, momentum, priorDate, priorTable });
  // The consistency + scaffold gates are HARD walls: a self-contradicting or scaffold-broken article is
  // never written to disk, not even in review mode — the caller receives the violations and holds.
  if (!out.consistency.ok || out.scaffold.length) return { ...out, path: path.join(dir, out.slug + ".md"), written: false };

  const target = path.join(dir, out.slug + ".md");
  // ── NO-REWRITE GUARD (owner directive 2026-07-24), with the ONE STORY = ONE URL carve-out ──────────
  // The lane may not churn OTHER published articles. But a chart update refreshing its OWN tracker at the
  // stable per-film URL is exactly the intended model — one URL updated in place, original date preserved,
  // `updated` bumped, history table grown. So: allow the overwrite ONLY when the existing file is a
  // box-office tracker (ours, marked boxOfficeTracker:true). A DIFFERENT article occupying the slug, or any
  // non-tracker collision, is still refused.
  if (!dryRun && fs.existsSync(target)) {
    if (isChart && trackerExists) {
      let existingIsTracker = false;
      try { existingIsTracker = matter.read(target).data?.boxOfficeTracker === true; } catch { existingIsTracker = false; }
      if (!existingIsTracker) {
        fault("assemble:no-rewrite", `refused: ${out.slug}.md exists and is NOT a box-office tracker`, { severity: SEV.WARN });
        return { ...out, path: target, written: false, refusedRewrite: true };
      }
      // else: fall through — this is the tracker updating itself, the intended in-place refresh.
    } else {
      fault("assemble:no-rewrite", `refused to overwrite an already-published article: ${out.slug}.md`, { severity: SEV.WARN });
      return { ...out, path: target, written: false, refusedRewrite: true };
    }
  }
  if (!dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, out.md);
  }
  return { ...out, path: target, written: !dryRun, trackerUpdate: isChart && trackerExists };
}
