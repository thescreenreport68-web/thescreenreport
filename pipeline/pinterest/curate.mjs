// CURATOR — source the TRENDING topics straight from the LIVE website (thescreenreport.com), exactly as the
// owner asked (2026-07-14): the pins must reflect what's actually trending/published on the site across EVERY
// lane (news, gossip, box office, inside) — not a git branch that only one lane commits to. We read two live
// surfaces: (1) the homepage ORDER = the site's own trending ranking (its placement engine), and (2) the RSS
// feed (/feed.xml) = 50 latest stories, each carrying image + dek + category + timestamp for card-building.
import { PIN } from "./config.mjs";

const SITE = PIN.articleBase; // https://thescreenreport.com

const decode = (s = "") => String(s)
  .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
  .replace(/&amp;/g, "&").replace(/&#x27;|&#39;|&#8217;|&#x2019;/g, "’").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2026;/g, "…").replace(/\s+/g, " ").trim();

async function getText(url, ms = 15000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { "user-agent": "TSR-Pinterest/1.0" } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return await r.text();
}

// batch dedup key: strip a leading stopword, take the first two significant slug tokens (so two "Moana
// live-action …" or two "Sam Neill …" stories never both land in one 5-pin batch).
const STOP = new Set(["the", "a", "an", "new", "how", "why", "inside", "this", "that", "is", "are", "what"]);
function eventKey(slug) {
  const t = slug.split("-").filter((w) => w && !STOP.has(w));
  return t.slice(0, 2).join("-");
}
// homepage/nav SECTION slugs (not articles) — ignore when reading the trending order
const SECTIONS = new Set(["box-office", "news", "trailers", "reactions", "rankings-lists", "explainers", "where-to-watch", "best-of-streaming", "screen-music", "profiles-artists", "awards", "red-carpet", "interviews", "features", "guides", "reviews", "trending", "music-awards"]);

// the site's RSS: 50 latest stories, each with image/dek/category/timestamp — our card-building index
async function fetchFeed() {
  const xml = await getText(`${SITE}/feed.xml`);
  const rows = [];
  for (const m of xml.matchAll(/<item>(.*?)<\/item>/gs)) {
    const it = m[1];
    const link = ((it.match(/<link>([^<]+)<\/link>/) || [])[1] || "").trim();
    const mm = link.match(/thescreenreport\.com\/([a-z-]+)\/([a-z0-9-]+)\//i);
    if (!mm) continue;
    const image = (it.match(/<enclosure[^>]+url="([^"]+)"/) || [])[1] || "";
    rows.push({
      slug: mm[2],
      url: link,
      urlCategory: mm[1].toLowerCase(),
      category: decode((it.match(/<category>([^<]+)<\/category>/) || [])[1] || mm[1]).toLowerCase(),
      title: decode((it.match(/<title>(.*?)<\/title>/s) || [])[1] || ""),
      description: decode((it.match(/<description>(.*?)<\/description>/s) || [])[1] || ""),
      image,
      date: Date.parse((it.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1] || "") || 0,
      eventKey: eventKey(mm[2]),
    });
  }
  return rows;
}

// the site's own TRENDING ranking = the order the homepage places stories (placement engine, trendScore-driven)
async function fetchHomepageOrder() {
  const html = await getText(`${SITE}/`);
  const order = []; const seen = new Set();
  for (const m of html.matchAll(/href="\/(movies|tv|celebrity|music|streaming|awards)\/([a-z0-9-]+)\/"/g)) {
    const slug = m[2];
    if (SECTIONS.has(slug) || seen.has(slug)) continue;
    seen.add(slug); order.push(slug);
  }
  return order; // most-trending first
}

// full "article" object for the downstream agents — built from the feed row, enriched from the live page
// (higher-res og:image + lede paragraphs for faithful key facts). Feed data is the fallback if the page fails.
export async function readLiveArticle(row) {
  let body = row.description, image = row.image, date = row.date;
  try {
    const html = await getText(row.url);
    const og = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1]; if (og) image = og;
    const dp = (html.match(/"datePublished":"([^"]+)"/) || [])[1]; if (dp) date = Date.parse(dp) || date;
    const paras = [...html.matchAll(/<p[^>]*class="[^"]*(?:dek|prose|body|content|leading)[^"]*"[^>]*>(.*?)<\/p>/gs)]
      .map((x) => decode(x[1].replace(/<[^>]+>/g, ""))).filter((p) => p.length > 40);
    if (paras.length) body = paras.slice(0, 6).join(" ");
  } catch { /* fall back to the feed row */ }
  return {
    slug: row.slug, url: row.url,
    title: row.title, dek: row.description,
    category: row.category, image,
    imageCredit: "", tags: [], keyTakeaways: [], whatWeKnow: row.description,
    date: date ? new Date(date).toISOString() : "",
    trendScore: null, outletCount: 0, eventSlug: row.eventKey,
    formatTag: "news", storyStatus: "", sensitivity: "",
    body, fm: {},
  };
}

// candidates = the live site's TRENDING topics, hottest first, filtered to pin-eligible (fresh, has image,
// on-brand category, not already pinned). Score: homepage trending position dominates; recency breaks ties.
export async function pickCandidates(pinnedSet, limit = 30) {
  const [feed, order] = await Promise.all([fetchFeed(), fetchHomepageOrder().catch(() => [])]);
  const pos = new Map(order.map((s, i) => [s, i])); // homepage trending rank (0 = hero)
  const now = Date.now();
  const rows = [];
  for (const r of feed) {
    if (pinnedSet.has(r.slug)) continue;                       // strict no-repeat
    if (!PIN.categories.has(r.category) && !PIN.categories.has(r.urlCategory)) continue;
    if (!r.image) continue;                                    // needs a hero photo
    if (!r.date || now - r.date > PIN.freshDays * 864e5) continue;
    const ageDays = (now - r.date) / 864e5;
    const featured = pos.has(r.slug);
    const score = (featured ? 100 - pos.get(r.slug) * 2 : 20) - ageDays * 4; // trending-first, then recency
    rows.push({ slug: r.slug, url: r.url, category: r.category, title: r.title, eventSlug: r.eventKey, image: r.image, date: r.date, score, row: r });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit); // hottest first
}

// look up ONE live story by slug (for the --slug force path)
export async function findLive(slug) {
  const feed = await fetchFeed();
  return feed.find((r) => r.slug === slug) || null;
}
