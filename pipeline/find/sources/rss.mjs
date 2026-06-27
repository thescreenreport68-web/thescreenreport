// v2 real-time DISCOVERY driver — entertainment-news RSS/Atom feeds. The <pubDate> is the breaking
// clock: we keep only fresh items and carry their age so the scorer can favour "just posted".
// LEGAL: feeds are a DISCOVERY SIGNAL only — we read the headline/short summary to know an event
// happened, then re-report the underlying FACT in our own words grounded on Wikipedia/TMDB + the
// corroborated headlines across outlets. We never copy/store/link the outlet's article text.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";

// Outlet tier = corroboration weight (App-L): wire/AP 8, major trade 7, major celebrity outlet 6,
// reputable secondary/aggregator 5, tabloid 4. verify.mjs uses tier≥7 as the "single-source-publishable
// major" threshold (owner policy); lone tier-5/6 reports wait for corroboration.
const FEEDS = [
  { url: "https://variety.com/feed/", outlet: "Variety", tier: 7, cats: ["movies", "tv", "celebrity"] },
  { url: "https://deadline.com/feed/", outlet: "Deadline", tier: 7, cats: ["movies", "tv"] },
  { url: "https://www.hollywoodreporter.com/feed/", outlet: "THR", tier: 7, cats: ["movies", "tv", "celebrity"] },
  { url: "https://people.com/feed/", outlet: "People", tier: 6, cats: ["celebrity"] },
  { url: "https://www.indiewire.com/feed/", outlet: "IndieWire", tier: 6, cats: ["movies", "tv"] },
  { url: "https://collider.com/feed/", outlet: "Collider", tier: 5, cats: ["movies", "tv"] },
  { url: "https://www.slashfilm.com/feed/", outlet: "SlashFilm", tier: 5, cats: ["movies"] },
  { url: "https://screenrant.com/feed/", outlet: "ScreenRant", tier: 5, cats: ["movies", "tv"] },
];

const strip = (s) => {
  if (s && typeof s === "object") s = s["#text"] || "";
  return String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
};

function parseItems(xml) {
  let j;
  try { j = parser.parse(xml); } catch { return []; }
  if (j?.rss?.channel?.item) {
    return [].concat(j.rss.channel.item).map((it) => ({ title: strip(it.title), summary: strip(it.description), date: it.pubDate }));
  }
  if (j?.feed?.entry) {
    return [].concat(j.feed.entry).map((it) => ({ title: strip(it.title), summary: strip(it.summary || it.content), date: it.published || it.updated }));
  }
  return [];
}

export async function discoverRSS({ maxPerFeed = 8, freshHours = 72 } = {}) {
  const out = [];
  const cutoff = Date.now() - freshHours * 3600 * 1000;
  await Promise.all(
    FEEDS.map(async (f) => {
      try {
        const r = await fetch(f.url, { headers: { "User-Agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
        if (!r.ok) return;
        const items = parseItems(await r.text()).slice(0, maxPerFeed);
        for (const it of items) {
          if (!it.title) continue;
          const t = it.date ? Date.parse(it.date) : NaN;
          if (!isNaN(t) && t < cutoff) continue; // freshness gate
          out.push({
            source: "rss:" + f.outlet,
            outlet: f.outlet,
            sourceTier: f.tier,
            kind: "rss-news",
            mediaType: "news",
            title: it.title,
            summary: (it.summary || "").slice(0, 400),
            pubDate: it.date || null,
            ageMin: isNaN(t) ? null : Math.round((Date.now() - t) / 60000),
            cats: f.cats,
            popularity: 0, // RSS items are ranked by freshness + corroboration, not TMDB popularity
          });
        }
      } catch {
        /* a flaky feed must never break the run */
      }
    })
  );
  return out;
}
