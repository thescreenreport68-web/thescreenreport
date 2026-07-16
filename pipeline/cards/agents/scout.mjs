// SCOUT — the §4 discovery recipe: trade RSS first, Google News when:1h sweeps second,
// then one cheap LLM pass to pick the day's DOMINANT topic and rank card-able stories.
// Feeds the slate (60/40 owner mandate) and shares its fetch layer with the breaking
// sentinel's Rule-B/C velocity scoring (same parser, same tier list).
import { CARDS } from "../config.mjs";
import { llm } from "../models.mjs";
import { fetchWithTimeout, parseFeed } from "../lib/util.mjs";
import { dom, tierFor } from "../../lib/outlets.mjs";
import { decodeGnewsUrl } from "../../lib/gnewsDecode.mjs";

// Tier-1 trade feeds = first-alert layer (verified fresh within ~minutes; Bing excluded — measured ~7h stale)
export const TRADE_FEEDS = [
  "https://variety.com/feed/",
  "https://deadline.com/feed/",
  "https://www.hollywoodreporter.com/feed/",
  "https://www.thewrap.com/feed/",
  "https://ew.com/feed/",
];
const GNEWS = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
export const GNEWS_FEEDS = [
  GNEWS("movie OR film when:1d"),
  GNEWS("hollywood celebrity when:1d"),
  GNEWS("tv series streaming when:1d"),
  GNEWS("box office when:1d"),
];

const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (TSR feeds)" };

export async function fetchFeedItems({ feeds = [...TRADE_FEEDS, ...GNEWS_FEEDS], maxAgeH = 36 } = {}) {
  const cut = Date.now() - maxAgeH * 3600_000;
  const seen = new Set();
  const items = [];
  await Promise.all(feeds.map(async (url) => {
    try {
      const r = await fetchWithTimeout(url, { headers: UA }, 12000);
      if (!r.ok) return;
      for (const it of parseFeed(await r.text())) {
        if (it.publishedAt && it.publishedAt < cut) continue;
        // Google News wraps links — decode to the real outlet so tiering works (keyless decoder, shared lib)
        let link = it.link;
        if (/news\.google\./.test(link)) {
          try { link = (await decodeGnewsUrl(link)) || link; } catch { /* keep wrapped — tier will be low */ }
        }
        const d = dom(new URL(link).hostname);
        const key = it.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).slice(0, 8).join(" ");
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ title: it.title, link, domain: d, tier: tierFor(d), publishedAt: it.publishedAt });
      }
    } catch { /* one dead feed never kills discovery */ }
  }));
  return items.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
}

const SYS = `You plan Instagram/Facebook news image cards for The Screen Report (Hollywood movies/TV/streaming/celebrity news, movies-first). From the headline list, return STRICT JSON:
{"topTopic":{"name":string,"why":string},
 "stories":[{"title":string,"angle":string,"entities":[string],"sourceLinks":[string],"isTopTopic":boolean,"viral":1-10,"hint":"news"|"first-look"|"box-office"|"streaming"|"tv"|"celebrity"|"awards"|"music"|"quote"|"memoriam"}]}
RULES: topTopic = the ONE story cluster with the most independent headlines (the day's dominant conversation). stories = up to 14 distinct card-able stories; give the dominant topic 5-7 DISTINCT angles (each angle is a different fact, not a rewording) and the rest to other fresh stories, favoring movies/box-office. Use ONLY the given headlines/links — never invent a story. sourceLinks = the exact links backing that story (2+ when available). viral = would a fan DM this to a friend. hint: "box-office" ONLY for money already earned (grosses/records) — presales, tracking, ticket demand for unreleased films are "news". Deaths/tragedy = "memoriam".`;

export async function scout({ items = null } = {}) {
  const feedItems = items || (await fetchFeedItems());
  if (feedItems.length < 5) throw new Error(`scout: only ${feedItems.length} feed items — refusing to plan from thin air`);
  const list = feedItems.slice(0, 120).map((i) => `- [${i.domain}] ${i.title} :: ${i.link}`).join("\n");
  const plan = await llm({ role: "scout", system: SYS, user: `HEADLINES (last 36h, newest first):\n${list}`, maxTokens: 3000 });
  plan.stories = (plan.stories || []).filter((s) => Array.isArray(s.sourceLinks) && s.sourceLinks.length > 0).slice(0, 14);
  // every sourceLink must come from the feed list — the model may not mint URLs
  const known = new Set(feedItems.map((i) => i.link));
  for (const s of plan.stories) s.sourceLinks = s.sourceLinks.filter((l) => known.has(l));
  plan.stories = plan.stories.filter((s) => s.sourceLinks.length > 0);
  plan.fetchedAt = Date.now();
  return plan;
}
