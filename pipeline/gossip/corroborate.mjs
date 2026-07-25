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
// 🔴 2026-07-25 — MEASURED: GDELT answers in 11-15s (three samples: 15.1s, 14.7s, and one 429 at 11s).
// The old 8s ceiling meant it ALWAYS timed out — the cloud diagnostics logged "gdelt: timeout (6001ms)"
// every single tick. That mattered far more than it looks: GDELT is the only finder that returns DIRECT
// publisher URLs. Google News returns redirect links, and the article reader now hard-blocks those
// ("AbuseAlleviationError: anonymous access to domain news.google.com blocked"). So losing GDELT left
// every candidate unreadable, which is why every published article shipped single-source.
// The two finders run in parallel, so the wall-clock cost of this is ~15s once per topic, not 15s each.
const FINDER_TIMEOUT_MS = Number(process.env.GOSSIP_FINDER_TIMEOUT_MS ?? 20000);
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
// 🔴 2026-07-25 — GDELT ENFORCES ONE REQUEST PER 5 SECONDS. Measured: a second call inside that window
// returns HTTP 429 with the plain-text body "Please limit requests to one every 5 seconds". We never
// spaced our calls, so on any tick that drained more than one topic GDELT simply stopped answering —
// and GDELT is the only finder returning DIRECT publisher URLs (Google News returns redirect links the
// article reader hard-blocks). Silent 429s were therefore a direct cause of single-source articles.
const GDELT_MIN_GAP_MS = Number(process.env.GOSSIP_GDELT_GAP_MS ?? 5200);
let gdeltNextAt = 0;
async function gdeltPace() {
  const wait = gdeltNextAt - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, GDELT_MIN_GAP_MS)));
  gdeltNextAt = Date.now() + GDELT_MIN_GAP_MS;
}

async function fromGDELT(topic, { fetchImpl, seedDomain = "", max = 6 } = {}) {
  const q = topicQuery(topic);
  if (!q) return [];
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=20&timespan=96h&sort=hybridrel`;
    let text = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      await gdeltPace();
      const r = await fetchImpl(url, { headers: { "User-Agent": UA } });
      if (!r.ok) { if (attempt === 0) continue; return []; }
      text = await r.text();
      // the rate-limit reply is 200-with-plain-text as often as it is a 429 — detect it either way
      if (!/limit requests to one every/i.test(text)) break;
      if (attempt === 0) { console.log("[gdelt] rate-limited — pausing once before retry"); text = ""; }
    }
    if (!text.trim().startsWith("{")) return []; // GDELT returns plain text on a bad query
    const arts = JSON.parse(text).articles || [];
    const out = [];
    for (const a of arts) {
      const d = registrableDomain(a.domain || a.url);
      if (!a.url || !d) continue;
      // fromGoogleNews gates every hit with titleNamesEntity; GDELT had NO such check, so an unrelated
      // wire story counted as corroboration and could flip an unverified rumour to a higher tier.
      // Only REJECT when we actually have a title that fails to name the entity (or a URL slug that does).
      // A GDELT hit with no title at all must not be dropped — that would silently kill corroboration.
      const gTitle = String(a.title || "").trim();
      const gSlug = (() => { try { return decodeURIComponent(new URL(a.url).pathname).replace(/[-_/]+/g, " "); } catch { return ""; } })();
      if (gTitle && !titleNamesEntity(gTitle, topic?.primaryEntity) && !titleNamesEntity(gSlug, topic?.primaryEntity)) continue;
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
    // Bound the window like the siblings do (fromGDELT uses timespan=96h, trendingSearch uses when:2d).
  // Unbounded, a years-old article body entered the writer's grounding as current material.
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:7d")}&hl=en-US&gl=US&ceid=US:en`;
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
/** A Google News / aggregator redirect link — the reader hard-blocks these, so the body is unreachable. */
export const isRedirectUrl = (u) => /^https?:\/\/(?:news\.google\.com|news\.yahoo\.com\/rss)/i.test(String(u || ""));

export async function findCorroboratingUrls(topic, { fetchImpl = defaultFetch, seedDomain = "", max = 6 } = {}) {
  const [gn, gd] = await Promise.all([
    fromGoogleNews(topic, { fetchImpl, max: max + 2 }).catch(() => []),
    fromGDELT(topic, { fetchImpl, seedDomain, max: max + 2 }).catch(() => []),
  ]);
  const seen = new Set([registrableDomain(seedDomain)].filter(Boolean));
  const out = [];
  // Direct publisher URLs first: a news.google.com link cannot be read at all (the reader 403s that
  // domain outright), so trying one wastes an extraction slot that a readable candidate could have used.
  const readableFirst = [...gd, ...gn].sort((a, b) => (isRedirectUrl(a.url) ? 1 : 0) - (isRedirectUrl(b.url) ? 1 : 0));
  for (const e of readableFirst) {
    if (!e.domain || seen.has(e.domain) || isAggregator(e.domain)) continue;
    seen.add(e.domain);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}
