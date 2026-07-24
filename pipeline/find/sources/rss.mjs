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
  // ── SECTION FEEDS (2026-07-04, NEWS_AUTOMATION_SPEC §6b): topic-concentrated feeds from the SAME top trades so
  // the big FILM / TV / BOX-OFFICE stories that scroll off each outlet's ~10-item MAIN feed within hours are still
  // discovered (the Odyssey-trailer / Supergirl-box-office-bomb blind spot). These bias reach toward exactly the
  // tentpole-movie news we prioritize (movies-first ~80/20). Cross-feed dupes collapse in discover's title de-dup.
  // (URLs live-checked 2026-07-04; Deadline uses /tag/ feeds, THR uses /c/ + /t/ feeds.)
  { url: "https://variety.com/v/film/feed/", outlet: "Variety", tier: 7, cats: ["movies"] },
  { url: "https://variety.com/v/tv/feed/", outlet: "Variety", tier: 7, cats: ["tv"] },
  { url: "https://variety.com/t/box-office/feed/", outlet: "Variety", tier: 7, cats: ["movies"] },
  { url: "https://deadline.com/tag/movies/feed/", outlet: "Deadline", tier: 7, cats: ["movies"] },
  { url: "https://deadline.com/tag/box-office/feed/", outlet: "Deadline", tier: 7, cats: ["movies"] },
  { url: "https://www.hollywoodreporter.com/c/movies/feed/", outlet: "THR", tier: 7, cats: ["movies"] },
  { url: "https://www.hollywoodreporter.com/c/tv/feed/", outlet: "THR", tier: 7, cats: ["tv"] },
  { url: "https://www.hollywoodreporter.com/t/box-office/feed/", outlet: "THR", tier: 7, cats: ["movies"] },
];

// ── CORROBORATION-ONLY FEEDS (owner 2026-07-24, for the 800-word rebuild) ────────────────────────
// 🔴 THESE CAN NEVER SEED A STORY. They exist for ONE purpose: when a top trade above has already
// broken a story, these outlets' coverage of the SAME story supplies extra verified material so the
// article can reach 800 honest words instead of being padded there.
//
// Why the split matters: the owner's 2026-07-03 directive removed exactly these outlets ("quizzes,
// 'X ranked' listicles, anime/game coverage, the SAO leak") because they SEEDED junk topics. That
// judgement stands — what we cover is still decided by the trades alone. This list only widens what
// we can READ about a story we already chose to cover, which is a different question entirely.
//
// The measured problem it solves: 21 feeds but only 9 DISTINCT outlets (the rest are the same trades'
// sub-feeds), so cross-outlet clustering almost never fired — every topic in the live queue had
// exactly 1 source and ~2,100 chars, when 800 words needs ~6,000+. This takes the pool to ~30 outlets.
// Every URL below was live-probed 2026-07-24 (HTTP 200, >=3 items); 3 candidates that 404'd
// (Vulture, Empire, ScreenDaily) were dropped rather than shipped broken.
export const CORROBORATION_FEEDS = [
  { url: "https://screenrant.com/feed/", outlet: "Screen Rant", tier: 4, cats: ["movies", "tv"] },
  { url: "https://collider.com/feed/", outlet: "Collider", tier: 4, cats: ["movies", "tv"] },
  { url: "https://www.slashfilm.com/feed/", outlet: "/Film", tier: 5, cats: ["movies", "tv"] },
  { url: "https://www.avclub.com/rss", outlet: "The A.V. Club", tier: 5, cats: ["movies", "tv"] },
  { url: "https://www.digitalspy.com/rss/all.xml", outlet: "Digital Spy", tier: 5, cats: ["tv", "movies"] },
  { url: "https://www.comingsoon.net/feed", outlet: "ComingSoon", tier: 4, cats: ["movies"] },
  { url: "https://www.polygon.com/rss/index.xml", outlet: "Polygon", tier: 5, cats: ["movies", "tv"] },
  { url: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml", outlet: "BBC", tier: 7, cats: ["movies", "tv", "celebrity"] },
  { url: "https://www.theguardian.com/film/rss", outlet: "The Guardian", tier: 7, cats: ["movies"] },
  { url: "https://www.theguardian.com/tv-and-radio/rss", outlet: "The Guardian", tier: 7, cats: ["tv"] },
  { url: "https://www.cbr.com/feed/", outlet: "CBR", tier: 4, cats: ["movies", "tv"] },
  { url: "https://consequence.net/feed/", outlet: "Consequence", tier: 5, cats: ["music", "movies"] },
  { url: "https://www.stereogum.com/feed/", outlet: "Stereogum", tier: 5, cats: ["music"] },
  { url: "https://www.nme.com/feed", outlet: "NME", tier: 6, cats: ["music"] },
  { url: "https://pitchfork.com/rss/news/", outlet: "Pitchfork", tier: 6, cats: ["music"] },
  { url: "https://www.etonline.com/news/rss", outlet: "Entertainment Tonight", tier: 5, cats: ["celebrity"] },
  { url: "https://www.usmagazine.com/feed/", outlet: "Us Weekly", tier: 5, cats: ["celebrity"] },
  { url: "https://gizmodo.com/feed", outlet: "Gizmodo", tier: 5, cats: ["movies", "tv"] },
  { url: "https://decider.com/feed/", outlet: "Decider", tier: 5, cats: ["tv", "streaming"] },
  { url: "https://tvline.com/feed/", outlet: "TVLine", tier: 6, cats: ["tv"] },
  { url: "https://editorial.rottentomatoes.com/feed/", outlet: "Rotten Tomatoes", tier: 5, cats: ["movies"] },
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

// ── CORROBORATION HARVEST (owner 2026-07-24) ─────────────────────────────────────────────────────
// Fetch the corroboration-only feeds and attach each item to an ALREADY-CHOSEN topic covering the
// same story. Costs ZERO LLM calls and hits no search API, so it cannot be rate-limited the way the
// Google-News corroboration search was — the feeds are plain RSS we were already entitled to read.
//
// 🔴 IT CAN ONLY ADD SOURCES TO AN EXISTING TOPIC. It never creates one, never reorders selection,
// and never changes which stories we cover — that stays with the top trades (owner, 2026-07-03).
const CORR_STOP = new Set(["the", "a", "an", "of", "and", "for", "with", "in", "on", "to", "is", "are", "his", "her", "their", "new", "at", "as", "by", "from", "that", "this", "it", "its", "be", "has", "have", "will", "says", "say", "after", "over", "into", "out", "up", "not", "but", "all", "how", "why", "what", "who"]);
const ctok = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
  .filter((w) => w.length > 2 && !CORR_STOP.has(w)).map((w) => w.replace(/ies$/, "y").replace(/(?<=.{3})s$/, "")));

// Same story? Requires a STRONG headline overlap. Deliberately strict: a wrong attachment would feed
// the writer facts from a DIFFERENT story, which is the fabrication failure mode we most fear. Better
// to miss corroboration than to invent it.
export function corrMatches(topicTitle, itemTitle, { minShared = 3, minRatio = 0.45 } = {}) {
  const A = ctok(topicTitle), B = ctok(itemTitle);
  if (A.size < 3 || B.size < 3) return false;
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared >= minShared && shared / Math.min(A.size, B.size) >= minRatio;
}

export async function harvestCorroboration(topics, { maxPerFeed = 25, freshHours = 96, feeds = CORROBORATION_FEEDS, log } = {}) {
  if (!Array.isArray(topics) || !topics.length) return { attached: 0, items: 0, feeds: 0 };
  const cutoff = Date.now() - freshHours * 3600 * 1000;
  const items = [];
  let okFeeds = 0;
  const results = await Promise.allSettled(feeds.map(async (f) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch(f.url, { headers: { "User-Agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, signal: ac.signal });
      if (!r.ok) return 0;
      let kept = 0;
      for (const it of parseItems(await r.text())) {
        if (kept >= maxPerFeed) break;
        if (!it.title || !it.url) continue;
        const t = it.date ? Date.parse(it.date) : NaN;
        if (!isNaN(t) && t < cutoff) continue;
        items.push({ outlet: f.outlet, tier: f.tier, url: it.url, headline: it.title, summary: (it.summary || "").slice(0, 600), ageMin: isNaN(t) ? null : Math.round((Date.now() - t) / 60000) });
        kept++;
      }
      return 1;
    } finally { clearTimeout(timer); }
  }));
  for (const r of results) if (r.status === "fulfilled" && r.value) okFeeds++;

  let attached = 0;
  for (const topic of topics) {
    const have = new Set((topic.sources || []).map((s) => s.outlet));
    for (const it of items) {
      if (have.has(it.outlet)) continue;                 // one source per outlet, as verify.mjs does
      if (!corrMatches(topic.title, it.headline)) continue;
      (topic.sources ||= []).push({ outlet: it.outlet, tier: it.tier, url: it.url, headline: it.headline, summary: it.summary, ageMin: it.ageMin, via: "corr-feed" });
      have.add(it.outlet);
      attached++;
    }
    const n = (topic.sources || []).length;
    if (n > 1) { topic.corroborationCount = n; if (topic.verification) topic.verification.outletCount = n; }
  }
  if (log) log(`corroboration harvest: ${okFeeds}/${feeds.length} feeds · ${items.length} items · ${attached} source(s) attached across ${topics.length} topics`);
  return { attached, items: items.length, feeds: okFeeds };
}
