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

// TOP NEWS CHANNELS ONLY (owner directive 2026-07-03: "focus ONLY on top news channels — Variety, THR,
// Deadline… their latest stories; write them in our own way; trust their facts"). We deliberately DROPPED the
// quiz/listicle/anime factories (ScreenRant, Collider, SlashFilm) and the indie music blogs (Pitchfork/Stereogum/
// The Fader/Consequence) — those were the source of the junk (quizzes, "X ranked" listicles, anime/game coverage,
// the SAO leak). Every feed here is a major, fact-checked trade → its story IS the verification; we re-report it
// faithfully + attributed, never inventing beyond it. Tier is just a display/ranking hint now (no corroboration).
const FEEDS = [
  { url: "https://variety.com/feed/", outlet: "Variety", tier: 7, cats: ["movies", "tv", "celebrity"] },
  { url: "https://deadline.com/feed/", outlet: "Deadline", tier: 7, cats: ["movies", "tv", "celebrity"] },
  { url: "https://www.hollywoodreporter.com/feed/", outlet: "THR", tier: 7, cats: ["movies", "tv", "celebrity"] },
  { url: "https://www.thewrap.com/feed/", outlet: "TheWrap", tier: 7, cats: ["movies", "tv", "celebrity"] },
  { url: "https://ew.com/feed/", outlet: "Entertainment Weekly", tier: 7, cats: ["movies", "tv", "celebrity"] },
  { url: "https://people.com/feed/", outlet: "People", tier: 7, cats: ["celebrity"] },
  { url: "https://www.indiewire.com/feed/", outlet: "IndieWire", tier: 7, cats: ["movies", "tv"] },
  // ── MUSIC — the top music trades only (Billboard, Rolling Stone, Variety's music desk).
  { url: "https://www.billboard.com/feed/", outlet: "Billboard", tier: 7, cats: ["music"] },
  { url: "https://www.rollingstone.com/music/feed/", outlet: "Rolling Stone", tier: 7, cats: ["music"] },
  { url: "https://variety.com/v/music/feed/", outlet: "Variety Music", tier: 7, cats: ["music"] },
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
