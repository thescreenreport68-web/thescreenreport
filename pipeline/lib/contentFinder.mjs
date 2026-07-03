// CONTENT FINDER v3 (2026-07-03 restructure — "FEED THE WRITER"). The missing organ from the 10/10-fabrication
// diagnosis, rebuilt on the working gossip-automation pattern: for a trending topic, enumerate its sources for
// FREE (FIND's seed URLs + Google-News-RSS search + GDELT artlist), pull the FULL article TEXT + on-the-record
// QUOTES (@extractus/article-extractor primary, Jina Reader fallback — both free), tier each source by the ONE
// outlet trust module, and assemble the VERIFIED-CONTENT BUNDLE the writer is locked to.
//
// v3 policy changes (root-cause fixes from the 2026-07-03 audit):
//  • NO MORE TRUST STARVATION: the old requireTrust bar BLOCKED single-source topics entirely — the writer got
//    a bare headline, padded it, and the verify layers cut/held the result (4/6 held). The owner's 2026-07-01
//    pivot says a single reputable source PUBLISHES, attributed — so a single source gets its text EXTRACTED
//    and the article gets framed/hedged downstream. The ONLY gather-block left is ZERO extractable material.
//  • GNEWS REDIRECTS EXTRACT NOW: news.google.com URLs (the volume lane) were silently dropped from extraction;
//    Jina Reader follows the redirect and reports the RESOLVED publisher URL ("URL Source:"), which we capture
//    for tiering + the hero picker (gossip-proven).
//  • CORROBORATION AS ENRICHMENT: a Google-News-RSS search per topic (aggregator-excluded, headline-must-name-
//    entity) + GDELT widen the bundle instead of gate-keeping it. A corroborating body must MENTION the entity
//    to be admitted, and NEVER contributes quotes (a real quote from a DIFFERENT story about the same person
//    must not be attributable to THIS one) — quotes come from SEED sources only.
//
// The trend layer says a topic is HOT; this layer gathers the TRUTH the writer must stay inside. Nothing here
// proves a claim — verification diffs every claim against THIS bundle. Cost: $0 (all sources free).
import { extract } from "@extractus/article-extractor";
import { gdeltArticles } from "./news.mjs";
import { DOMAIN_OWNER, MAJORS, dom, canonOwner, tierFor, OUTLET_NAME_OWNER, isAggregator, titleNamesEntity, nameTier } from "./outlets.mjs";
export { canonOwner, tierFor }; // long-standing re-exports (tests + callers import them from here)

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";
const JINA_KEY = process.env.JINA_API_KEY || ""; // optional; anonymous works for most sites, key avoids 451s

// Hosts that are never themselves the REPORTER (aggregators/social/video/reference). news.google.com is listed
// but handled specially: it is extractable VIA Jina redirect-resolution (the publisher behind it is the source).
const NON_ARTICLE = /(^|\.)(youtube\.com|youtu\.be|twitter\.com|x\.com|instagram\.com|facebook\.com|reddit\.com|tiktok\.com|news\.google\.com|wikipedia\.org|imdb\.com|rottentomatoes\.com)$/i;
const GNEWS_HOST = /(^|\.)news\.google\.com$/i;

// Per-fetch/extract time budgets. Extraction runs in the hot path — a hung source must be abandoned, never
// allowed to stall the run (gossip proved 9s works; we allow slightly more for slow trade CMSes).
const EXTRACTOR_MS = 12000;
const JINA_MS = 14000;
// Race a promise against a timeout that CLEARS its timer and unrefs it (no leaked handle keeping the process alive).
const withTimeout = (p, ms) => {
  let id;
  return Promise.race([
    Promise.resolve(p).then((v) => { clearTimeout(id); return v; }, (e) => { clearTimeout(id); throw e; }),
    new Promise((_, rej) => { id = setTimeout(() => rej(new Error("timeout")), ms); if (typeof id?.unref === "function") id.unref(); }),
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

// Clean Jina Reader markdown output → readable text (links → their text, images/URLs dropped).
const mdToText = (m) => String(m || "")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/^#{1,6}\s+/gm, "")
  .replace(/[*_`>|]/g, " ")
  .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n")
  .trim();

// ── QUOTES ──────────────────────────────────────────────────────────────────────────────────────────────────
// On-the-record quotes ONLY. The naive /[“"]...[”"]/ regex FABRICATES quotes on straight-ASCII-quote articles:
// it pairs one span's CLOSING quote with the NEXT span's OPENING quote across the narrative prose between them (the
// audit reproduced 3/3 fabricated). A fabricated quote in the bundle would PASS verification (which diffs claims
// AGAINST the bundle) — the exact existential-accuracy failure the rebuild kills. So we fail SAFE: pair curly
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

// ── QUERY BUILDING ──────────────────────────────────────────────────────────────────────────────────────────
// GDELT ANDs raw words, so "Supergirl movie box office DC" returns ~nothing if any single word is missing. A quoted
// ENTITY + OR-ed keywords is far more reliable (Google News search accepts the same shape). Returns NULL for a
// degenerate entity so we never fire a garbage query like '""' / '"the"' — caller then relies on seedUrls.
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

// ── EXTRACTION ──────────────────────────────────────────────────────────────────────────────────────────────
// Extract one URL: article-extractor first (clean publisher pages), Jina Reader fallback (JS/bot-walled AND the
// resolver for Google-News redirect links). Jina is called WITHOUT X-Return-Format so its "URL Source:" header
// line survives — that is the RESOLVED publisher URL (gossip-proven), which re-tiers the source correctly and
// gives the hero picker a real article page to pull og:image from.
async function extractOne(url, { gnewsRedirect = false } = {}) {
  if (!safeHttpUrl(url)) return null;
  if (!gnewsRedirect) {
    try {
      const a = await withTimeout(extract(url), EXTRACTOR_MS);
      if (a && a.content) {
        const text = htmlToText(a.content);
        if (text.length > 350) return { resolvedUrl: a.url || url, title: a.title || null, text, published: a.published || null, via: "extractor" };
      }
    } catch { /* fall through */ }
  }
  try {
    const h = { "User-Agent": UA };
    if (JINA_KEY) h["Authorization"] = "Bearer " + JINA_KEY;
    const r = await withTimeout(fetch("https://r.jina.ai/" + url, { headers: h, signal: AbortSignal.timeout(JINA_MS) }), JINA_MS + 1000);
    if (r.ok) {
      const raw = await r.text();
      const resolved = (raw.match(/URL Source:\s*(\S+)/i) || [])[1] || "";
      const bodyIdx = raw.indexOf("Markdown Content:");
      const text = mdToText(bodyIdx >= 0 ? raw.slice(bodyIdx + 17) : raw);
      if (text.length > 350) {
        return { resolvedUrl: /^https?:\/\//.test(resolved) && safeHttpUrl(resolved) ? resolved : (gnewsRedirect ? null : url), title: null, text: text.slice(0, 9000), published: null, via: "jina" };
      }
    }
  } catch { /* fall through */ }
  return null;
}

// ── CORROBORATION FINDER (gossip port) ──────────────────────────────────────────────────────────────────────
// Google News RSS SEARCH for THIS story → { url:<google redirect, Jina-resolvable>, domain:<real publisher>,
// outlet:<name> } per covering outlet. This is the finder that actually SEES entertainment coverage in real time
// (GDELT barely indexes celebrity desks). Aggregators excluded; the headline must name the entity.
const stripXml = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
async function gnewsSearch(query, entity, { max = 6 } = {}) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const out = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const block = m[1];
      const title = stripXml((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
      if (!titleNamesEntity(title, entity)) continue;
      const link = stripXml((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
      const outlet = stripXml((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]);
      const domain = dom(((block.match(/<source url="([^"]+)"/) || [])[1] || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]);
      if (!link || !domain || isAggregator(domain)) continue; // aggregators are not independent reporters
      out.push({ url: link, domain, outlet: outlet || domain, title });
      if (out.length >= max) break;
    }
    return out;
  } catch { return []; }
}

// Map a FIND topic.sources[] entry (outlet + numeric tier + url + summary) → a bundle source. With a URL we key
// owner/tier the SAME way extracted sources do (so the trust math + dedup are consistent); without a URL we fall
// back to the FIND outlet name + its numeric tier (>=7 major, <=4 tabloid, else other).
export function inlineSource(s) {
  const text = String(s.summary || "").trim();
  if (text.length < 40) return null; // a real sentence of reporting, not a bare label
  const url = s.url && safeHttpUrl(s.url) ? s.url : null;
  const d = url ? dom(domainOf(url)) : "";
  // Tier by the real publisher domain ONLY when the URL is a real article host; a gnews redirect
  // (news.google.com) or any non-article host falls back to the FIND outlet name + its numeric tier
  // (so a Variety-via-gnews item keeps its major tier instead of being mis-tiered as the redirect host).
  if (d && !NON_ARTICLE.test(d)) {
    const t = tierFor(d);
    return { url, domain: d, owner: t.owner || (s.outlet || "").toLowerCase(), tier: t.tier, title: s.headline || null, text, quotes: extractQuotes(text), via: "find-summary", date: null };
  }
  const nameLower = (s.outlet || "").toLowerCase().trim();
  if (!nameLower) return null;
  // Map the display name to its parent owner so it collapses with an extracted source from the same outlet
  // (else "Variety"-via-gnews and an extracted variety.com both count as independent owners — a trust-gate bypass).
  const owner = OUTLET_NAME_OWNER[nameLower] || nameLower;
  const tier = s.tier >= 7 ? "major" : s.tier <= 4 ? "tabloid" : "other";
  // url stays NULL here: a gnews-redirect/non-article URL must not ride on the inline source (the hero picker
  // would fetch og:image from news.google.com) — the EXTRACTION path resolves redirects and carries the real URL.
  return { url: null, domain: "", owner, tier, title: s.headline || null, text, quotes: extractQuotes(text), via: "find-summary", date: null };
}

// MAIN. topic = { query|title|primaryEntity, sources?[{outlet,tier,url,headline,summary}], seedUrls?[] }.
// Returns the verified-content bundle; BLOCKS only on ZERO extractable/inline material (fail-closed on nothing,
// never starved on single-source — the owner's pivot policy, finally enforced in the collection layer).
export async function findContent(topic, { maxSources = 6, maxExtract = 8, skipGdelt = false } = {}) {
  const query = (topic.query || topic.title || topic.primaryEntity || "").trim();
  if (!query) return { blocked: true, reason: "no query", query: "" };
  const ent = (topic.primaryEntity || "").trim();
  const entLc = ent.toLowerCase();
  const surnameLc = ent.split(/\s+/).pop()?.toLowerCase() || "";
  // Entity-mention gate for CORROBORATING bodies (gossip port): a real article about THIS story names the
  // subject — require the full name OR the surname so a loosely-related hit about someone else is never admitted.
  const mentionsEntity = (txt) => { const t = (txt || "").toLowerCase(); return !ent || t.includes(entLc) || (surnameLc.length > 2 && t.includes(surnameLc)); };

  // 0) INLINE bundle from FIND's already-gathered reporting (the gossip gatherBundle pattern) — the cheapest real
  //    material, kept per-owner so a paywalled/redirect/un-indexed story still grounds the writer in real text.
  const findSources = Array.isArray(topic.sources) ? topic.sources : [];
  const inlineByOwner = new Map();
  for (const s of findSources) {
    const isrc = inlineSource(s);
    const k = isrc && canonOwner(isrc.owner);
    if (isrc && k && !inlineByOwner.has(k)) inlineByOwner.set(k, isrc);
  }

  // 1) ENUMERATE candidate URLs for FULL-TEXT extraction:
  //    SEEDS — FIND's own source URLs (freshest; INCLUDING news.google.com redirects, now Jina-resolvable) +
  //    explicit seedUrls. CORR — Google-News search for this story + GDELT artlist (skipped when FIND already
  //    corroborated — the double-GDELT fix).
  const gq = buildGdeltQuery(topic);
  const [gnFound, gdelt] = await Promise.all([
    gq ? gnewsSearch(gq, ent, { max: 6 }).catch(() => []) : [],
    (!skipGdelt && gq) ? gdeltArticles(gq, { sinceHours: 168, maxRecords: 50 }).catch(() => []) : [],
  ]);
  const seedEntries = [
    ...(topic.seedUrls || []).map((u) => ({ url: u, outlet: null })),
    ...findSources.filter((s) => s.url).map((s) => ({ url: s.url, outlet: s.outlet || null })),
  ];
  const candidates = [
    ...seedEntries.map((s) => ({ url: s.url, outlet: s.outlet, title: null, domain: domainOf(s.url), date: null, from: "seed" })),
    ...gnFound.map((a) => ({ url: a.url, outlet: a.outlet, title: a.title, domain: a.domain, date: null, from: "corr" })),
    ...gdelt.map((a) => ({ url: a.url, outlet: null, title: a.title, domain: a.domain, date: a.date, from: "corr" })),
  ];
  // Dedup one candidate per OUTLET. A news.google.com redirect can't dedup by host (they'd all collapse) — key it
  // by the outlet name FIND/gnews attached; a plain URL keys by its publisher domain. Non-article hosts (social/
  // reference) are dropped; gnews redirects are KEPT for Jina resolution.
  const byKey = new Map();
  for (const c of candidates) {
    const d = c.domain || domainOf(c.url);
    if (!c.url || !safeHttpUrl(c.url)) continue;
    const isGnews = GNEWS_HOST.test(domainOf(c.url));
    if (!isGnews && (!d || NON_ARTICLE.test(d) || isAggregator(d))) continue;
    const key = isGnews ? (c.domain && !GNEWS_HOST.test(c.domain) ? c.domain : "gnews:" + canonOwner(c.outlet || c.url)) : d;
    if (!byKey.has(key)) byKey.set(key, { ...c, domain: d, gnewsRedirect: isGnews });
  }
  // extract best sources first: seeds, then majors, then the rest
  const ordered = [...byKey.values()].sort((a, b) => {
    const rank = (x) => (x.from === "seed" ? 0 : MAJORS.has(dom(x.domain)) ? 1 : 2);
    return rank(a) - rank(b);
  }).slice(0, maxExtract);

  // 2) EXTRACT full text (+ quotes for SEEDS only) per candidate until enough independent owners.
  const extracted = [];
  const owners = new Set();
  const failures = [];
  for (const c of ordered) {
    const ex = await extractOne(c.url, { gnewsRedirect: c.gnewsRedirect });
    if (!ex) { failures.push(c.domain || c.outlet || c.url.slice(0, 40)); continue; }
    // A corroborating article must actually be about THIS story (gossip's entity-mention admission gate).
    if (c.from !== "seed" && !mentionsEntity(ex.text)) { failures.push((c.domain || c.outlet || "?") + ":off-entity"); continue; }
    // Tier by the RESOLVED publisher domain (a gnews redirect resolves to the real outlet via Jina).
    const realDomain = dom(domainOf(ex.resolvedUrl || "")) || dom(c.domain || "");
    if (GNEWS_HOST.test(realDomain) || isAggregator(realDomain)) {
      // Jina followed the redirect for the TEXT but its "URL Source:" line was missing — the material is real
      // (entity-gated: a Google interstitial never names the subject) but we can't attribute a publisher URL.
      // Admit TEXT-ONLY, tiered by the outlet name FIND attached, url:null (never hero-fetch news.google.com).
      if (c.gnewsRedirect && c.outlet && mentionsEntity(ex.text)) {
        const owner = OUTLET_NAME_OWNER[(c.outlet || "").toLowerCase().trim()] || (c.outlet || "").toLowerCase();
        // One text-only source per OWNER: three PMC trades carrying the same syndicated scoop must not eat
        // three bundle slots (they are ONE editorial source; the resolved-URL path dedups by domain instead).
        if (owners.has(canonOwner(owner))) continue;
        // Tier by the outlet NAME via the shared map (a "Variety"-via-gnews text-only source is still major).
        const nt = findSources.find((s) => s.outlet === c.outlet)?.tier ?? nameTier(c.outlet);
        extracted.push({ url: null, domain: "", owner, tier: nt >= 7 ? "major" : nt <= 4 ? "tabloid" : "other", title: c.title, text: ex.text.slice(0, 6000), quotes: c.from === "seed" ? extractQuotes(ex.text) : [], via: ex.via + "+unresolved", date: c.date || null, corroborating: c.from !== "seed" });
        owners.add(canonOwner(owner));
        if (extracted.length >= maxSources && owners.size >= 2) break;
        continue;
      }
      failures.push((c.outlet || realDomain) + ":unresolved-redirect"); continue;
    }
    const t = realDomain ? tierFor(realDomain) : { tier: (findSources.find((s) => s.outlet === c.outlet)?.tier ?? 5) >= 7 ? "major" : "other", owner: (c.outlet || "").toLowerCase() };
    extracted.push({
      url: ex.resolvedUrl || c.url, domain: realDomain, owner: t.owner, tier: t.tier,
      title: ex.title || c.title || null, text: ex.text.slice(0, 6000),
      // SEED-ONLY QUOTES (gossip rule): a verbatim quote from a corroborating article about a possibly-different
      // moment must never be handed to the writer as THIS story's evidence.
      quotes: c.from === "seed" ? extractQuotes(ex.text) : [],
      via: ex.via, date: ex.published || c.date || null, corroborating: c.from !== "seed",
    });
    owners.add(canonOwner(t.owner));
    if (extracted.length >= maxSources && owners.size >= 2) break;
  }

  // 3) MERGE: full-text extracted sources are best; KEEP an inline-summary source for any owner we could NOT
  //    extract, so the writer always has real reporting even when every URL is paywalled/redirect/un-indexed.
  const extractedOwners = new Set(extracted.map((s) => canonOwner(s.owner)));
  const inlineKept = [...inlineByOwner.values()].filter((s) => !extractedOwners.has(canonOwner(s.owner)));
  const sources = [...extracted, ...inlineKept];
  const allOwners = new Set(sources.map((s) => canonOwner(s.owner)));
  const majorCount = sources.filter((s) => s.tier === "major").length;

  // ALL covering outlets seen by the finders (even un-extracted) — the framing/verify layers tier off this
  // (gossip's corroboratingOutlets signal: "N independent outlets carried it" survives fetch failures).
  const coveringOutlets = [...new Map([
    ...sources.filter((s) => s.domain || s.owner).map((s) => [canonOwner(s.owner), { outlet: s.title ? s.domain || s.owner : s.domain || s.owner, domain: s.domain || "", tier: s.tier }]),
    ...gnFound.map((a) => [canonOwner(tierFor(a.domain).owner), { outlet: a.outlet, domain: a.domain, tier: tierFor(a.domain).tier }]),
  ]).values()];

  // 4) FAIL-CLOSED on NOTHING — never hand the writer a topic with NO real source text at all (extracted OR
  //    inline). This is the ONLY gather-block: an untrusted-but-real single source extracts + flags instead.
  if (sources.length === 0) {
    return { blocked: true, reason: gq ? "no extractable sources and no inline reporting" : "no queryable entity, seeds, or inline reporting", query, candidatesFound: byKey.size, triedExtract: ordered.length };
  }
  return {
    blocked: false,
    query,
    sources,
    independentOwners: [...allOwners],
    // SINGLE-SOURCE flag: only one independent owner corroborates this story → the writer must stick to the
    // source's exact wording (no interpretation), the article is framed ATTRIBUTED (pivot policy), and the
    // independent WEB reality-check is this story's corroboration. Surfaced to run.mjs + the monitor.
    singleSource: allOwners.size < 2,
    // trusted = the OLD requireTrust bar, now METADATA for framing instead of a starvation block.
    trusted: majorCount >= 1 || allOwners.size >= 2,
    majorCount,
    coveringOutlets,
    extractedCount: extracted.length,
    inlineCount: inlineKept.length,
    totalQuotes: sources.reduce((n, s) => n + (s.quotes?.length || 0), 0),
    candidatesFound: byKey.size,
    triedExtract: ordered.length,
    extractFailures: failures,
  };
}
