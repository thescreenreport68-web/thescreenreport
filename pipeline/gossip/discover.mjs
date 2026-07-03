// GOSSIP — DISCOVERY (Stage 1). Polls gossip/entertainment RSS for fresh candidate stories. fetchImpl + nowMs
// are injectable so the harness runs offline + deterministically. Output: [{outlet,tier,title,url,summary,ageMin}].
import { tierOf } from "./policy.mjs";

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";

// Gossip-lead feeds (established desks first). Discovery signal only — never copied/quoted; the content finder
// re-fetches the source for the receipts.
export const GOSSIP_FEEDS = [
  { outlet: "Page Six", url: "https://pagesix.com/feed/" },
  { outlet: "TMZ", url: "https://www.tmz.com/rss.xml" },
  { outlet: "E! News", url: "https://www.eonline.com/syndication/feeds/rssfeeds/topstories.xml" },
  { outlet: "Just Jared", url: "https://www.justjared.com/feed/" },
  { outlet: "People", url: "https://people.com/feed/" },
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
