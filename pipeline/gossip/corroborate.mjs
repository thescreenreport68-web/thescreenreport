// GOSSIP — MULTI-SOURCE CORROBORATION (Step 4). Once a rumor surfaces, FIND the other articles about it across
// outlets and hand the writer a RICHER multi-source bundle to rewrite FAITHFULLY (no invention). More real
// material = fewer fabrications, a higher publish rate, correct tiering (a wire-reported fact is a FACT, not
// "speculation"), and a fallback story photo when the primary outlet's image fails.
//
// TWO free, keyless finders, merged:
//   • GDELT artlist — direct publisher URLs, but it barely indexes celebrity/gossip desks (returns 0 for most
//     gossip, even days later), so on its own it left stories thin.
//   • Google News RSS — indexes the gossip/celebrity outlets in real time and hands us the OUTLET NAME + its
//     homepage domain (so we can tier it) for every covering outlet. Its per-article <link> is a Google redirect,
//     which our extractor resolves through Jina Reader (verified).
import { topicQuery } from "../lib/news.mjs";
import { entityKey, decodeEntities } from "./normalize.mjs";

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";
export const registrableDomain = (d) => (d || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(":")[0];
const strip = (s) => decodeEntities(String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// Bounded fetch — a finder is enrichment; a slow GDELT/Google-News endpoint must never stall the run.
const FINDER_TIMEOUT_MS = 8000;
const defaultFetch = (url, opts = {}) => fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(FINDER_TIMEOUT_MS) });

// AGGREGATORS / republishers — they re-surface other outlets' stories, so their presence is NOT independent
// corroboration and their name is NOT the reporter. Excluding them stops a thin social post from being elevated to
// "reported by Yahoo" just because Yahoo echoed it (the Normani failure).
const AGGREGATORS = new Set([
  "yahoo.com", "news.yahoo.com", "msn.com", "aol.com", "news.google.com", "flipboard.com", "smartnews.com",
  "apple.news", "bing.com", "newsbreak.com", "ground.news", "headtopics.com", "biztoc.com",
]);
const isAggregator = (domain) => AGGREGATORS.has((domain || "").toLowerCase());

// Does a headline plausibly name THIS story's subject? (drops "Kenneth Walker" / "June Walker" noise from a
// "Dick Van Dyke walker" query). Require the full name or the surname.
function titleNamesEntity(title, entity) {
  const t = entityKey(title || "");            // folded: "Hernández" in the outlet matches "Hernandez"
  const e = entityKey(entity || "");
  if (!e) return true;
  const surname = e.split(/\s+/).pop() || "";
  return t.includes(e) || (surname.length > 2 && t.includes(surname));
}

// GDELT artlist → corroborating article URLs (direct publisher URLs). Fail-safe ([] on any issue).
async function fromGDELT(topic, { fetchImpl, seedDomain = "", max = 6 } = {}) {
  const q = topicQuery(topic);
  if (!q) return [];
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=20&timespan=96h&sort=hybridrel`;
    const r = await fetchImpl(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const text = await r.text();
    if (!text.trim().startsWith("{")) return []; // GDELT returns plain text on a bad query
    const arts = JSON.parse(text).articles || [];
    const out = [];
    for (const a of arts) {
      const d = registrableDomain(a.domain || a.url);
      if (!a.url || !d) continue;
      out.push({ url: a.url, domain: d, outlet: d, title: a.title || "" });
      if (out.length >= max) break;
    }
    return out;
  } catch {
    return [];
  }
}

// Google News RSS → { url:<google redirect, resolvable via Jina>, domain:<publisher homepage>, outlet:<name> }.
// This is the finder that actually SEES gossip coverage. Filtered to items whose headline names the subject.
async function fromGoogleNews(topic, { fetchImpl, max = 6 } = {}) {
  const q = topicQuery(topic);
  if (!q) return [];
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetchImpl(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const xml = await r.text();
    const out = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const block = m[1];
      const title = strip((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
      if (!titleNamesEntity(title, topic.primaryEntity)) continue;
      const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
      const outlet = strip((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]);
      const domain = registrableDomain((block.match(/<source url="([^"]+)"/) || [])[1] || "");
      if (!link || !domain || isAggregator(domain)) continue; // aggregators are not independent reporters
      out.push({ url: link, domain, outlet: outlet || domain, title });
      if (out.length >= max) break;
    }
    return out;
  } catch {
    return [];
  }
}

// Merged corroboration: one entry per DISTINCT domain (a domain from either finder counts once), the seed domain
// excluded. Google News first (it reliably names the covering outlets), GDELT second (direct URLs it happened to
// find). Best-effort: any finder failing just yields the other's results.
export async function findCorroboratingUrls(topic, { fetchImpl = defaultFetch, seedDomain = "", max = 6 } = {}) {
  const [gn, gd] = await Promise.all([
    fromGoogleNews(topic, { fetchImpl, max: max + 2 }).catch(() => []),
    fromGDELT(topic, { fetchImpl, seedDomain, max: max + 2 }).catch(() => []),
  ]);
  const seen = new Set([registrableDomain(seedDomain)].filter(Boolean));
  const out = [];
  for (const e of [...gn, ...gd]) {
    if (!e.domain || seen.has(e.domain) || isAggregator(e.domain)) continue;
    seen.add(e.domain);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}
