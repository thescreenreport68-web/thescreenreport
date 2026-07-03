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
  // ── MUSIC discovery feeds (decided 2026-06-28) — DISCOVERY SIGNAL ONLY, same legal posture: read the
  // headline to know an event happened, then re-report grounded. Tier-5 indie feeds feed the breakout
  // detector's candidate NAMES; the breakout SIGNAL comes from breakout.mjs (Reddit + Wikipedia), not here.
  { url: "https://www.billboard.com/feed/", outlet: "Billboard", tier: 7, cats: ["music"] },
  { url: "https://www.rollingstone.com/music/feed/", outlet: "Rolling Stone", tier: 7, cats: ["music"] },
  { url: "https://variety.com/v/music/feed/", outlet: "Variety Music", tier: 7, cats: ["music"] },
  { url: "https://pitchfork.com/feed/feed-news/rss", outlet: "Pitchfork", tier: 6, cats: ["music"] },
  { url: "https://www.stereogum.com/feed/", outlet: "Stereogum", tier: 5, cats: ["music"] },
  { url: "https://www.thefader.com/rss", outlet: "The Fader", tier: 5, cats: ["music"] },
  { url: "https://consequence.net/category/music/feed/", outlet: "Consequence", tier: 5, cats: ["music"] },
];

const strip = (s) => {
  if (s && typeof s === "object") s = s["#text"] || "";
  return String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
};

// The publisher article URL (the real <link>). RSS link = a string; Atom link = an element (or array) with
// @_href — prefer rel="alternate". This URL is the grounding seed MAKE's content finder extracts from, so it
// MUST be carried end-to-end (Phase A: the missing URL was the root cause of the writer fabricating on thin facts).
function linkOf(it) {
  let l = it.link;
  if (Array.isArray(l)) l = l.find((x) => !x?.["@_rel"] || x["@_rel"] === "alternate") || l[0];
  if (l && typeof l === "object") l = l["@_href"] || l["#text"] || "";
  l = String(l || "").trim();
  return /^https?:\/\//.test(l) ? l : null;
}

function parseItems(xml) {
  let j;
  try { j = parser.parse(xml); } catch { return []; }
  if (j?.rss?.channel?.item) {
    return [].concat(j.rss.channel.item).map((it) => ({ title: strip(it.title), summary: strip(it.description), date: it.pubDate, url: linkOf(it) }));
  }
  if (j?.feed?.entry) {
    return [].concat(j.feed.entry).map((it) => ({ title: strip(it.title), summary: strip(it.summary || it.content), date: it.published || it.updated, url: linkOf(it) }));
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
        // Apply the freshness gate BEFORE the per-feed cap (was: slice raw order then filter, which silently
        // dropped a fresh item past position 8). Cap the FRESH items so we never under-collect breaking news.
        let kept = 0;
        for (const it of parseItems(await r.text())) {
          if (kept >= maxPerFeed) break;
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
            url: it.url || null, // the publisher article URL — MAKE's content finder extracts the body from this
            pubDate: it.date || null,
            ageMin: isNaN(t) ? null : Math.round((Date.now() - t) / 60000),
            cats: f.cats,
            popularity: 0, // RSS items are ranked by freshness + corroboration, not TMDB popularity
          });
          kept++;
        }
      } catch {
        /* a flaky feed must never break the run */
      }
    })
  );
  return out;
}
