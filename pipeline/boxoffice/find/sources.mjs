// P2 FIND — EVENT SOURCES (BOX_OFFICE_UPGRADE_PLAN §L2). The lane's discovery used to be 100%
// inventory-walking (yesterday's chart, a weekly TSV); these sources make it EVENT-DRIVEN: the trade
// box-office section feeds + targeted Google News RSS searches surface openings, weekend actuals,
// milestones, records, and "now streaming" stories within minutes-to-hours of the trades posting them.
// All free + keyless, self-contained in this lane (no other lane's code is touched). Deterministic —
// no LLM here; categorization happens in events.mjs with ONE batched call.

// The three DEDICATED box-office section feeds (already proven URLs — the news lane polls them but
// discards box-office items by design) + trade main feeds filtered by BO_SCOPE.
export const FEEDS = [
  { url: "https://variety.com/t/box-office/feed/", owner: "Variety", tier: 1, scoped: true },
  { url: "https://deadline.com/tag/box-office/feed/", owner: "Deadline", tier: 1, scoped: true },
  { url: "https://www.hollywoodreporter.com/t/box-office/feed/", owner: "The Hollywood Reporter", tier: 1, scoped: true },
  { url: "https://variety.com/feed/", owner: "Variety", tier: 1 },
  { url: "https://deadline.com/feed/", owner: "Deadline", tier: 1 },
  { url: "https://www.thewrap.com/feed/", owner: "TheWrap", tier: 2 },
];

// The beat's scope test — the inverse of the news sentinel's OFF_SCOPE (which drops exactly this beat).
export const BO_SCOPE = /box[- ]?office|opening (weekend|day|night)|debut(ed|s)? (to|with) \$|gross(es|ed)?|cume\b|crosses \$|\$\d[\d.,]*\s?(million|billion|m\b|b\b)|now streaming|hits (netflix|max|hulu|disney|prime|peacock|paramount)|top ?10|watch[- ]?hours|viewership|weekend (estimates|actuals|preview|projections)|milestone|highest[- ]grossing/i;
// Junk that wastes a categorize slot even when scope-matched (reviews, interviews, galleries, opinion).
export const JUNK_RE = /\breview\b|\binterview\b|photos|gallery|red carpet|trailer\b|opinion|commentary|podcast|recap\b|explained\b|ending\b|awards? (race|season|predictions)|obituary|dies\b/i;

// Google News RSS searches (keyless; `when:` recency operators). Fresher than section feeds for
// off-trade outlets; each item carries its <source> outlet for owner-corroboration.
export const GNEWS_QUERIES = [
  "box office when:1d",
  '"opening weekend" box office when:1d',
  '"now streaming" OR "hits Netflix" OR "arrives on Netflix" when:1d',
  "Netflix top 10 when:2d",
  "streaming viewership hours when:2d",
];

// Minimal deterministic RSS <item> parser — title, link, pubDate, and (gnews) the <source> outlet.
export function parseRss(xml, { maxItems = 20 } = {}) {
  const out = [];
  for (const m of String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const pick = (tag) => (b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i")) || [])[1] || "";
    const clean = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").trim();
    const item = { title: clean(pick("title")), link: clean(pick("link")), pubDate: clean(pick("pubDate")), sourceName: clean(pick("source")) };
    if (item.title) out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

const ageH = (pubDate, nowMs) => {
  const t = Date.parse(pubDate || "");
  return Number.isFinite(t) ? (nowMs - t) / 3600e3 : null;
};

// Sweep the trade feeds → scoped, deduped raw items. Fail-soft per feed (a dead feed never kills a run).
export async function sweepFeeds({ fetchImpl = fetch, nowMs = Date.now(), maxAgeH = 36, maxPerFeed = 14 } = {}) {
  const items = [];
  const seen = new Set();
  for (const feed of FEEDS) {
    try {
      const res = await fetchImpl(feed.url, { headers: { "user-agent": "Mozilla/5.0 (compatible; TSR-radar)" } });
      if (!res?.ok) continue;
      const xml = (await res.text()).slice(0, 400000);
      for (const it of parseRss(xml, { maxItems: maxPerFeed })) {
        const a = ageH(it.pubDate, nowMs);
        if (a != null && a > maxAgeH) continue;
        if (!feed.scoped && !BO_SCOPE.test(it.title)) continue; // main feeds must pass the beat scope
        if (JUNK_RE.test(it.title)) continue;
        const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ title: it.title, url: it.link, owner: feed.owner, tier: feed.tier, pubMs: Date.parse(it.pubDate || "") || nowMs, via: "rss" });
      }
    } catch { /* fail-soft */ }
  }
  return items;
}

// Sweep the Google News searches → same shape; the outlet comes from each item's <source> tag.
export async function sweepGnews({ fetchImpl = fetch, nowMs = Date.now(), maxPerQuery = 10 } = {}) {
  const items = [];
  const seen = new Set();
  for (const q of GNEWS_QUERIES) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      const res = await fetchImpl(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; TSR-radar)" } });
      if (!res?.ok) continue;
      const xml = (await res.text()).slice(0, 400000);
      for (const it of parseRss(xml, { maxItems: maxPerQuery })) {
        if (JUNK_RE.test(it.title)) continue;
        // gnews titles end with " - Outlet"; strip it (the <source> tag is the authority).
        const title = it.title.replace(/\s+-\s+[^-]{2,40}$/, "").trim();
        const key = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ title, url: it.link, owner: it.sourceName || "Google News", tier: 3, pubMs: Date.parse(it.pubDate || "") || nowMs, via: "gnews" });
      }
    } catch { /* fail-soft */ }
  }
  return items;
}
