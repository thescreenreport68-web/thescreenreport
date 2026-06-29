// CONTENT FINDER (trending-news rebuild, Step 2 — 2026-06-29). The missing organ from the 10/10-fabrication
// diagnosis: for a trending topic, enumerate ALL its sources for FREE (the trend finder's seed URLs + GDELT's
// real-URL artlist), pull the FULL article TEXT + on-the-record QUOTES (@extractus/article-extractor primary,
// Jina Reader fallback — both free), tier each source by the owner-independence map, and assemble the
// VERIFIED-CONTENT BUNDLE the writer is locked to. FAIL-CLOSED: zero extractable sources — OR no trusted /
// corroborated source (no major outlet AND <2 independent owners) — ⇒ BLOCK.
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

// Race a promise against a timeout that CLEARS its timer (no leaked setTimeout on the fast path).
const withTimeout = (p, ms) => {
  let id;
  return Promise.race([
    Promise.resolve(p).then((v) => { clearTimeout(id); return v; }, (e) => { clearTimeout(id); throw e; }),
    new Promise((_, rej) => { id = setTimeout(() => rej(new Error("timeout")), ms); }),
  ]);
};
const domainOf = (u) => { try { return dom(new URL(u).hostname); } catch { return ""; } };

// SSRF guard — only fetch PUBLIC http(s) URLs; block file://, localhost, and private/link-local IP ranges.
export function safeHttpUrl(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return false;
    const h = x.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    return true;
  } catch { return false; }
}

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

// ── QUOTES ──────────────────────────────────────────────────────────────────────────────────────────────────
// On-the-record quotes ONLY. The naive /[“"]...[”"]/ regex FABRICATES quotes on straight-ASCII-quote articles:
// it pairs one span's CLOSING quote with the NEXT span's OPENING quote across the narrative prose between them (the
// audit reproduced 3/3 fabricated). A fabricated quote in the bundle would PASS Step-3 verification (which diffs
// claims AGAINST the bundle) — the exact existential-accuracy failure the rebuild kills. So we fail SAFE: pair curly
// quotes by their distinct open/close chars; pair straight quotes by ALTERNATION; and keep a span ONLY if it reads
// like a real sentence AND has an attribution cue nearby. Missing a real quote is harmless; inventing one is not.
export function looksLikeQuote(q) {
  const w = q.split(/\s+/).filter(Boolean).length;
  if (w < 5 || w > 45) return false;                         // a real sentence, not a title/fragment/essay
  if (!/[a-z]/.test(q)) return false;                        // drop ALL-CAPS title cards
  if (/^https?:|@\w|\b(read more|click here|subscribe|getty images|associated press|advertisement|sign up)\b/i.test(q)) return false;
  if (/^[A-Z][\w'’]+ ?: /.test(q) && w < 12) return false;   // "Jackass: Best and Last" caption/title pattern
  if (!/[a-z]\s+\S/i.test(q)) return false;                  // at least two real words
  return true;
}
const ATTR_VERB = "(?:said|says|told|asked|adds?|added|noted?|wrote|writes|states?|stated|explains?|explained|recalls?|recalled|admitted|continued|argued|insists?|insisted|joked|confirmed|reveals?|revealed|responded|according to|in a statement|in an? interview)";
const QSPAN = `["“]([^"”“]{15,300})["”]`; // a single quoted span (no inner quote mark — can't cross-span)
export function extractQuotes(text) {
  const t = String(text || "").replace(/\s+/g, " ");
  const found = new Set();
  // Anchor on the JOURNALISTIC ATTRIBUTION GRAMMAR so we can only ever capture a genuinely-attributed quote (this
  // sidesteps the cross-span fabrication entirely): (1) attribution THEN quote — `said[, ...]: "quote"`; (2) quote
  // THEN attribution — `"quote," [Name/pronoun] said`. Each span is then sanity-checked by looksLikeQuote.
  const pats = [
    new RegExp(`\\b${ATTR_VERB}\\b[^"“”]{0,45}[:,]\\s*${QSPAN}`, "gi"),
    new RegExp(`${QSPAN}[",]?\\s*[—–-]?\\s*(?:[A-Z][\\w.'’]+\\s+){0,4}${ATTR_VERB}\\b`, "gi"),
  ];
  for (const re of pats) {
    for (const m of t.matchAll(re)) {
      const q = (m[1] || "").replace(/\s+/g, " ").trim();
      if (looksLikeQuote(q)) found.add(q);
    }
  }
  return [...found].slice(0, 8);
}

// ── GDELT QUERY ─────────────────────────────────────────────────────────────────────────────────────────────
// GDELT ANDs raw words, so "Supergirl movie box office DC" returns ~nothing if any single word is missing. A quoted
// ENTITY + OR-ed keywords is far more reliable. In production the trend finder supplies topic.primaryEntity; else we
// take the leading proper-noun run of the query. Returns NULL for a degenerate entity (empty / single stopword /
// <3 chars) so we never fire a garbage query like '""' / '"the"' / '"box"' — caller then relies on seedUrls.
const GQ_STOP = new Set("the a an of to in on for at by and or with as is are was were new movie film show series tv star stars cast news report reports latest dc mcu trailer today".split(" "));
export function buildGdeltQuery(topic) {
  if (topic.gdeltQuery) return topic.gdeltQuery;
  const raw = (topic.query || topic.title || topic.primaryEntity || "").trim();
  let entity = (topic.primaryEntity || "").trim();
  if (!entity) entity = ((raw.match(/^([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,2})/) || [])[1] || "").trim();
  const eWords = entity.toLowerCase().split(/\s+/).filter(Boolean);
  if (!eWords.length || entity.replace(/[^a-z0-9]/gi, "").length < 3) return null;
  if (eWords.length === 1 && GQ_STOP.has(eWords[0])) return null;
  const entWords = new Set(eWords);
  const kw = raw.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !GQ_STOP.has(w) && !entWords.has(w)).slice(0, 3);
  return kw.length ? `"${entity}" (${kw.join(" OR ")})` : `"${entity}"`;
}

// Extract one URL: article-extractor first (clean publisher pages), Jina Reader fallback (JS/bot-walled).
async function extractOne(url) {
  if (!safeHttpUrl(url)) return null;
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
export async function findContent(topic, { maxSources = 6, maxExtract = 16, requireTrust = true } = {}) {
  const query = (topic.query || topic.title || topic.primaryEntity || "").trim();
  if (!query) return { blocked: true, reason: "no query", query: "" };

  // 1) ENUMERATE candidate source URLs (free): the trend finder's seed URLs (freshest, real publisher URLs) +
  //    GDELT's real-URL artlist on a FOCUSED query. (Google News RSS is intentionally NOT used for extraction — its
  //    links are news.google.com redirects that don't resolve cleanly; GDELT supplies real URLs and seeds the rest.)
  const gq = buildGdeltQuery(topic);
  const gdelt = gq ? await gdeltArticles(gq, { sinceHours: 168, maxRecords: 50 }).catch(() => []) : [];
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

  // 3) FAIL-CLOSED — never hand the writer a topic without real, trusted, corroborated source text.
  const majorCount = sources.filter((s) => s.tier === "major").length;
  if (sources.length === 0) {
    return { blocked: true, reason: gq ? "no extractable sources" : "no queryable entity and no seed URLs", query, candidatesFound: byDomain.size, triedExtract: ordered.length };
  }
  if (requireTrust && majorCount < 1 && owners.size < 2) {
    return { blocked: true, reason: "untrusted: no major outlet and <2 independent owners", query, majorCount, independentOwners: [...owners], domains: sources.map((s) => s.domain), candidatesFound: byDomain.size };
  }
  return {
    blocked: false,
    query,
    sources,
    independentOwners: [...owners],
    majorCount,
    totalQuotes: sources.reduce((n, s) => n + s.quotes.length, 0),
    candidatesFound: byDomain.size,
    triedExtract: ordered.length,
    extractFailures: failures,
  };
}
