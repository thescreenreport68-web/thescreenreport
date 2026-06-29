// CONTENT FINDER (trending-news rebuild, Step 2 — 2026-06-29). The missing organ from the 10/10-fabrication
// diagnosis: for a trending topic, enumerate ALL its sources for FREE (GDELT real-URL artlist + Google News RSS
// + the trend finder's own seed URLs), pull the FULL article TEXT + on-the-record QUOTES (article-extractor
// primary, Jina Reader fallback — both free), tier each source by the owner-independence map, and assemble the
// VERIFIED-CONTENT BUNDLE the writer will be locked to. FAIL-CLOSED: zero extractable independent sources ⇒ BLOCK.
//
// The trend layer says a topic is HOT; this layer gathers the TRUTH the writer must stay inside. Nothing here
// proves a claim — verification (Step 3) diffs every claim against THIS bundle. Cost: $0 (all sources free).
import { extract } from "@extractus/article-extractor";
import { gdeltArticles, DOMAIN_OWNER, MAJORS, dom } from "./news.mjs";

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";
const JINA_KEY = process.env.JINA_API_KEY || ""; // optional; anonymous works for most sites, key avoids 451s

// Known tabloids — gathered but tier-flagged so the verify gate can demand a major for sensitive claims.
const TABLOID = new Set(["tmz.com", "dailymail.co.uk", "the-sun.com", "thesun.co.uk", "mirror.co.uk", "pagesix.com", "nypost.com", "radaronline.com", "hollywoodlife.com", "perezhilton.com", "okmagazine.com"]);
// Hosts that are not article sources (aggregators/social/video) — never extract as a "report".
const NON_ARTICLE = /(^|\.)(youtube\.com|youtu\.be|twitter\.com|x\.com|instagram\.com|facebook\.com|reddit\.com|tiktok\.com|news\.google\.com|wikipedia\.org|imdb\.com|rottentomatoes\.com)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const domainOf = (u) => { try { return dom(new URL(u).hostname); } catch { return ""; } };

function tierFor(domain) {
  const d = dom(domain);
  if (MAJORS.has(d)) return { tier: "major", owner: DOMAIN_OWNER[d] };
  if (TABLOID.has(d)) return { tier: "tabloid", owner: d };
  return { tier: "other", owner: d };
}

// Strip an extractor's content HTML down to clean reading text (paragraph-aware).
const htmlToText = (h) => String(h || "")
  .replace(/<(script|style|figure|figcaption)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&#?\w+;/g, " ")
  .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n")
  .trim();

// Pull on-the-record quotes: spans inside quotation marks, 4-45 words (skips fragments + URLs).
function extractQuotes(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/[“"]([^”"]{20,260})[”"]/g)) {
    const q = m[1].replace(/\s+/g, " ").trim();
    const w = q.split(/\s+/).length;
    if (w >= 4 && w <= 45 && /[a-z]/i.test(q) && !/^https?:/.test(q)) out.push(q);
  }
  return [...new Set(out)].slice(0, 8);
}

// Build a robust GDELT DOC query. GDELT ANDs raw words, so "Supergirl movie box office DC" returns ~nothing when
// any single word is missing from an article. A quoted ENTITY + OR-ed keywords is far more reliable. In production
// the trend finder supplies topic.primaryEntity; otherwise we take the leading proper-noun run of the query.
const GQ_STOP = new Set("the a an of to in on for at by and or with as is are was were new movie film show series tv star stars cast news report reports latest dc mcu trailer".split(" "));
function buildGdeltQuery(topic) {
  if (topic.gdeltQuery) return topic.gdeltQuery;
  const raw = (topic.query || topic.title || topic.primaryEntity || "").trim();
  let entity = (topic.primaryEntity || "").trim();
  if (!entity) entity = (raw.match(/^([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,2})/) || [])[1] || raw.split(/\s+/)[0] || raw;
  const entWords = new Set(entity.toLowerCase().split(/\s+/));
  const kw = raw.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !GQ_STOP.has(w) && !entWords.has(w)).slice(0, 3);
  return kw.length ? `"${entity}" (${kw.join(" OR ")})` : `"${entity}"`;
}

// Extract one URL: article-extractor first (clean publisher pages), Jina Reader fallback (JS/bot-walled).
async function extractOne(url) {
  try {
    const a = await withTimeout(extract(url), 22000);
    if (a && a.content) {
      const text = htmlToText(a.content);
      if (text.length > 350) return { resolvedUrl: a.url || url, title: a.title || null, text, published: a.published || null, via: "extractor" };
    }
  } catch { /* fall through */ }
  try {
    const h = { "User-Agent": UA, "X-Return-Format": "text" };
    if (JINA_KEY) h["Authorization"] = "Bearer " + JINA_KEY;
    const r = await withTimeout(fetch("https://r.jina.ai/" + url, { headers: h }), 28000);
    if (r.ok) { const t = await r.text(); if (t && t.length > 350) return { resolvedUrl: url, title: null, text: t.slice(0, 9000), published: null, via: "jina" }; }
  } catch { /* fall through */ }
  return null;
}

// MAIN. topic = { query | title | primaryEntity, seedUrls?[] }. Returns the verified-content bundle (or BLOCK).
export async function findContent(topic, { maxSources = 6, maxExtract = 16 } = {}) {
  const query = (topic.query || topic.title || topic.primaryEntity || "").trim();
  if (!query) return { blocked: true, reason: "no query", query: "" };

  // 1) ENUMERATE candidate source URLs (free): the trend finder's seed URLs (freshest, real publisher URLs) +
  //    GDELT's real-URL artlist on a FOCUSED query (quoted entity + OR-keywords). Google News RSS is intentionally
  //    NOT used for extraction — its links are news.google.com redirect URLs that don't resolve cleanly, and GDELT
  //    already supplies real publisher URLs while the seeds carry the freshest reporting.
  const gdelt = await gdeltArticles(buildGdeltQuery(topic), { sinceHours: 168, maxRecords: 50 }).catch(() => []);
  const seeds = (topic.seedUrls || []).map((u) => ({ url: u, title: null, domain: domainOf(u), date: null, from: "seed" }));
  const candidates = [
    ...seeds,
    ...gdelt.map((a) => ({ url: a.url, title: a.title, domain: a.domain, date: a.date, from: "gdelt" })),
  ];
  // dedup by domain (one report per outlet), drop non-article hosts
  const byDomain = new Map();
  for (const c of candidates) {
    const d = c.domain || domainOf(c.url);
    if (!d || NON_ARTICLE.test(d)) continue;
    if (!byDomain.has(d)) byDomain.set(d, { ...c, domain: d });
  }
  // extract best sources first: seeds, then majors, then the rest
  const ordered = [...byDomain.values()].sort((a, b) => {
    const rank = (x) => (x.from === "seed" ? 0 : MAJORS.has(dom(x.domain)) ? 1 : 2);
    return rank(a) - rank(b);
  }).slice(0, maxExtract);

  // 2) EXTRACT full text + quotes per candidate until enough independent owners.
  const sources = [];
  const owners = new Set();
  const failures = [];
  for (const c of ordered) {
    const ex = await extractOne(c.url);
    if (!ex) { failures.push(c.domain); continue; }
    const t = tierFor(c.domain);
    sources.push({
      url: ex.resolvedUrl || c.url, domain: dom(c.domain), owner: t.owner, tier: t.tier,
      title: ex.title || c.title || null, text: ex.text.slice(0, 6000), quotes: extractQuotes(ex.text),
      via: ex.via, date: ex.published || c.date || null,
    });
    owners.add(t.owner);
    if (sources.length >= maxSources && owners.size >= 2) break;
  }

  // 3) FAIL-CLOSED — never hand the writer a topic with no real source text.
  if (sources.length === 0) {
    return { blocked: true, reason: "no extractable independent sources", query, candidatesFound: byDomain.size, triedExtract: ordered.length };
  }
  return {
    blocked: false,
    query,
    sources,
    independentOwners: [...owners],
    majorCount: sources.filter((s) => s.tier === "major").length,
    totalQuotes: sources.reduce((n, s) => n + s.quotes.length, 0),
    candidatesFound: byDomain.size,
    triedExtract: ordered.length,
    extractFailures: failures,
  };
}
