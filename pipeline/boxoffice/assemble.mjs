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
import { normMoney, canonicalFigures, numberConsistencyGate } from "./moneyGuard.mjs";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");

const slugify = (s) => {
  const full = (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (full.length <= 80) return full;
  const cut = full.slice(0, 80);
  return cut.includes("-") ? cut.replace(/-[^-]*$/, "") : cut;
};

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
  if (w && leads(w) && HAS_FIGURE_RE.test(w)) cands.push(w); // keep the writer's own if it's already good
  if (form.streaming) {
    const r = gathered.netflixRank ? `#${gathered.netflixRank}` : null;
    const hrs = c.hoursViewed?.text || gathered.hoursViewed || null;
    if (r && hrs) cands.push(`${q} Hits ${r} on Netflix With ${hrs}`);
    if (r) cands.push(`${q} Climbs to ${r} on Netflix's Top 10 Chart`, `${q} Hits ${r} on Netflix's Top 10`, `${q} Is ${r} on Netflix This Week`);
    if (hrs) cands.push(`${q} Draws ${hrs} on the Netflix Top 10`);
    cands.push(`${q} Is Blowing Up on Netflix's Top 10 Chart`, `${q} Climbs the Netflix Global Top 10`);
  } else {
    const useWW = c.worldwide != null && (c.domestic == null || c.worldwide.raw >= c.domestic.raw);
    const fig = useWW ? compactUSD(c.worldwide.text)
      : compactUSD((c.domestic || c.openingWeekend || c.worldwide)?.text);
    const scope = useWW ? "Worldwide" : "Domestic";
    if (fig) cands.push(
      `${q} Crosses ${fig} at the ${scope} Box Office`,
      `${q} Climbs to ${fig} at the ${scope} Box Office`,
      `${q} Hits ${fig} at the ${scope} Box Office`,
      `${q} Reaches ${fig} at the Box Office`,
      `${q} Hits ${fig} at the Box Office`,
    );
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
// totals across two FAQs again). Writer FAQs whose figures survive the consistency gate are kept.
function ensureFaq(article, { canon = {}, gathered = {}, boxData = {}, film = {}, form = {} }) {
  const cand = (article.faq || []).filter((f) => f?.q && f?.a && String(f.a).trim().length > 15).slice(0, 4);
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

// A TRENDING-TV subject is a series, not a movie — correct the schema type the writer emits.
function fixAbout(about, { film, form }) {
  const arr = Array.isArray(about) ? about.filter((e) => e && e.name && e.type) : [];
  if (!(form.category === "tv")) return arr;
  const ft = String(film.title || "").toLowerCase().trim();
  return arr.map((e) => (e.type === "Movie" && String(e.name).toLowerCase().trim() === ft ? { ...e, type: "TVSeries" } : e));
}

// Display-friendly USD for deterministic titles: "$47.6 million", "$1.02 billion", "$519,154".
const fmtUSDWords = (raw) => {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw >= 1e9) return `$${(raw / 1e9).toFixed(2).replace(/0$/, "")} billion`;
  if (raw >= 1e6) return `$${(raw / 1e6).toFixed(1).replace(/\.0$/, "")} million`;
  return `$${Math.round(raw).toLocaleString("en-US")}`;
};

export function buildBoxOfficeMarkdown({ article, trigger, angle, film, gathered = {}, boxData = {}, image, dateISO }) {
  const form = FORMS[angle.form];
  // ── SINGLE SOURCE OF TRUTH: ONE reconciled canonical figure set; EVERY surface below draws from it. ──
  const canon = canonicalFigures({ gathered, boxData, film });
  // Daily factual updates get a DETERMINISTIC title (keyword + the canonical number) — the live test tick
  // proved the writer titles daily updates with invented spin ("Sinks With Disastrous $43M Opening",
  // "77% Drop"); a tracker report's headline must be the system's own verified number, not the model's.
  let title = cleanTitle(article.title);
  if (film?.dailyChart && canon.domestic) {
    const day = canon.dayInRelease;
    const dom = fmtUSDWords(canon.domestic.raw);
    title = cleanTitle(`${film.title} Box Office${day ? ` Day ${day}` : " Update"}: Domestic Total Climbs to ${dom}`);
  }
  const slug = slugify(title);
  const boxOffice = buildBoxOffice(canon, gathered);
  const records = (gathered.records || []).filter(Boolean).map((r) => (typeof r === "string" ? { claim: r } : clean({ claim: r.claim, detail: r.detail })))
    .filter((r) => r.claim);
  // whereToWatch: TMDB providers (NOW-STREAMING / a landed title), or — for a Netflix Top 10 / trending
  // streaming piece — the platform the piece is about (Netflix) so the reader still gets a where-to-watch row.
  let whereToWatch = (boxData.whereToWatch || []).filter((w) => w?.title && w?.platform);
  if (!whereToWatch.length && form?.streaming && gathered?.platform) {
    whereToWatch = [{ title: film.title, platform: gathered.platform, type: "Stream" }];
  }
  whereToWatch = whereToWatch.map((w) => ({ ...w, platform: normPlatform(w.platform) }));

  const fm = clean({
    title,
    slug,
    category: form.category,
    subcategory: form.subcategory,
    author: BOXOFFICE_AUTHOR_SLUG,
    date: dateISO,
    dek: article.dek || "",
    ...seoFinish({ metaTitle: buildMetaTitle(article.metaTitle, { title, film, gathered, boxData, form, canon }), metaDescription: article.metaDescription || article.dek || "" }),
    tags: ensureTags(article, { film, form, gathered }),
    keyTakeaways: article.keyTakeaways || [],
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

  const body = fixLede(deTemplate(article.body || "")).trim();
  // ── PRE-PUBLISH CONSISTENCY GATE: diff every dollar figure across ALL final surfaces against the
  // canonical set. ANY contradiction (a title claiming $100M when the block says $26.4M, two FAQs with
  // different worldwide totals) blocks the article — a self-contradicting article can never publish again.
  const consistency = numberConsistencyGate(
    { title: fm.title, metaTitle: fm.metaTitle, dek: fm.dek, metaDescription: fm.metaDescription,
      body, keyTakeaways: fm.keyTakeaways, faq: fm.faq },
    canon,
    { recordTexts: (fm.records || []).map((r) => r.claim) },
  );
  const md = matter.stringify("\n" + body + "\n", fm);
  return { slug, frontmatter: fm, md, canon, consistency };
}

export function writeBoxOfficeArticle({ article, trigger, angle, film, gathered, boxData, image, dateISO, dir = CONTENT_DIR, dryRun = false }) {
  const out = buildBoxOfficeMarkdown({ article, trigger, angle, film, gathered, boxData, image, dateISO });
  // The consistency gate is a HARD wall: a self-contradicting article is never written to disk, not even
  // in review mode — the caller receives the violations and holds.
  if (!out.consistency.ok) return { ...out, path: path.join(dir, out.slug + ".md"), written: false };
  if (!dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, out.slug + ".md"), out.md);
  }
  return { ...out, path: path.join(dir, out.slug + ".md"), written: !dryRun };
}
