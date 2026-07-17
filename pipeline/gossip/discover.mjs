// GOSSIP — DISCOVERY (Stage 1). Polls gossip/entertainment RSS for fresh candidate stories. fetchImpl + nowMs
// are injectable so the harness runs offline + deterministically. Output: [{outlet,tier,title,url,summary,ageMin}].
import { tierOf } from "./policy.mjs";
import { decodeGnewsUrl } from "../lib/gnewsDecode.mjs";

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";

// Gossip-lead feeds (established desks first). Discovery signal only — never copied/quoted; the content finder
// re-fetches the source for the receipts.
export const GOSSIP_FEEDS = [
  { outlet: "Page Six", url: "https://pagesix.com/feed/" },
  { outlet: "TMZ", url: "https://www.tmz.com/rss.xml" },
  { outlet: "E! News", url: "https://www.eonline.com/syndication/feeds/rssfeeds/topstories.xml" },
  { outlet: "Just Jared", url: "https://www.justjared.com/feed/" },
  { outlet: "People", url: "https://people.com/feed/" },
  // Phase 1 widening (all live-verified 2026-07-17) — everything publishable is bounded by this surface.
  { outlet: "Us Weekly", url: "https://www.usmagazine.com/feed/" },
  { outlet: "Entertainment Tonight", url: "https://www.etonline.com/news/rss" },
  { outlet: "The Shade Room", url: "https://theshaderoom.com/feed/" },
  { outlet: "Dlisted", url: "https://dlisted.com/feed/" },
  { outlet: "OK! Magazine", url: "https://okmagazine.com/feed/" },
  { outlet: "Life & Style", url: "https://www.lifeandstylemag.com/feed/" },
];

const strip = (s) =>
  String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();

function parseItems(xml, outlet) {
  const items = [];
  for (const m of (xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title = strip((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
    const link = strip((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
    const desc = strip((b.match(/<description>([\s\S]*?)<\/description>/) || [])[1]);
    const pub = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
    if (title) items.push({ outlet, tier: tierOf(outlet), title, url: link, summary: desc, pubDate: pub });
  }
  return items;
}

async function defaultFetch(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

export async function discoverGossip({ fetchImpl = defaultFetch, feeds = GOSSIP_FEEDS, freshHours = 48, nowMs } = {}) {
  const now = nowMs ?? Date.now();
  const out = [];
  for (const f of feeds) {
    try {
      for (const it of parseItems(await fetchImpl(f.url), f.outlet)) {
        const t = it.pubDate ? Date.parse(it.pubDate) : NaN;
        const ageMin = isNaN(t) ? null : Math.round((now - t) / 60000);
        if (ageMin != null && ageMin / 60 > freshHours) continue; // stale
        out.push({ outlet: it.outlet, tier: it.tier, title: it.title, url: it.url, summary: it.summary, ageMin });
      }
    } catch {
      /* a feed being down is not fatal */
    }
  }
  // freshest first (unknown age sinks to the bottom)
  return out.sort((a, b) => (a.ageMin ?? 1e9) - (b.ageMin ?? 1e9));
}

// ── Phase 1: ONE trending search per FIND run (the news lane's owner-locked "never RSS-only" rule). ──
// Rotating query packs over the hot gossip story classes; Google News RSS surfaces stories our 11 desks
// haven't posted yet. Links are gnews redirects → decoded to the real publisher URL (shared decoder).
export const TREND_QUERIES = [
  'celebrity feud OR shade OR "calls out"',
  'celebrity split OR divorce OR breakup',
  'celebrity dating OR "new couple" OR romance rumors',
  'celebrity lawsuit OR arrested OR "court documents"',
  'celebrity engaged OR wedding OR "baby news"',
  'reality star drama OR feud',
];

export async function trendingSearch({ fetchImpl = defaultFetch, decodeImpl = decodeGnewsUrl, nowMs, max = 10, queryIndex } = {}) {
  const now = nowMs ?? Date.now();
  const q = TREND_QUERIES[(queryIndex ?? new Date(now).getUTCHours()) % TREND_QUERIES.length];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&hl=en-US&gl=US&ceid=US:en`;
  const out = [];
  try {
    const xml = await fetchImpl(url);
    for (const m of (xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      if (out.length >= max) break;
      const b = m[1];
      const rawTitle = strip((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
      const link = strip((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
      const outlet = strip((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]) || "Google News";
      const pub = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
      const t = pub ? Date.parse(pub) : NaN;
      const ageMin = isNaN(t) ? null : Math.round((now - t) / 60000);
      if (!rawTitle || (ageMin != null && ageMin / 60 > 48)) continue;
      const title = rawTitle.replace(new RegExp(`\\s*[-–]\\s*${outlet.replace(/[.*+?^$()|[\\]{}]/g, "\\$&")}\\s*$`), "");
      // decode the gnews redirect to the real publisher URL (best-effort; keep the item either way)
      let realUrl = link;
      try { const dec = await decodeImpl(link, { fetchImpl: fetch }); if (dec) realUrl = dec; } catch { /* keep gnews link */ }
      out.push({ outlet, tier: tierOf(outlet), title, url: realUrl, summary: "", ageMin, viaTrending: true });
    }
  } catch { /* trending is enrichment — never fatal */ }
  return out;
}
