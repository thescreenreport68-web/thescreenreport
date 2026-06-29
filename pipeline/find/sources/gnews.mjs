// DISCOVERY source — Google News RSS SEARCH (trend-finder hardening, step 6, 2026-06-29). Free + keyless. The
// curated trade RSS (rss.mjs) is a fixed set of ~15 feeds; a single-outlet story there waits for corroboration and
// often never publishes (the "0 publishable" finding). Google News surfaces the SAME trending story across MANY
// outlets, so a Collider/ScreenRant item also gets a Variety/Deadline hit → the cross-source verify merges them →
// 2 independent owners → CONFIRMED/DEVELOPING → publishable. We read only the headline + outlet + timestamp (a
// DISCOVERY SIGNAL); the content finder gathers the real source text later, in our own words.
const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";

// Broad in-niche queries (Google News `when:Nd` recency operator) — wide enough to surface trending Hollywood
// film/TV, celebrity, and Western/English-music news from across the open web; the categorize LLM filters relevance.
const QUERIES = [
  "Hollywood movie when:2d",
  "TV series renewed OR canceled OR casting when:2d",
  "celebrity when:1d",
  "weekend box office when:3d",
  "new trailer OR teaser when:2d",
  "Netflix OR HBO OR Marvel OR DC OR A24 when:2d",
  "new album OR world tour OR single when:2d",
  "Grammys OR Oscars OR Emmys OR award winners when:5d",
];

// Outlet name → corroboration tier (mirrors rss.mjs: wire/AP 8, major trade 7, major celeb 6, secondary 5, tabloid 4).
const OUTLET_TIER = {
  "Variety": 7, "Deadline": 7, "The Hollywood Reporter": 7, "Hollywood Reporter": 7, "Associated Press": 8, "AP News": 8, "Reuters": 8,
  "Billboard": 7, "Rolling Stone": 7, "The New York Times": 7, "Los Angeles Times": 7, "The Guardian": 7, "BBC": 7, "NPR": 7,
  "People": 6, "Entertainment Weekly": 6, "IndieWire": 6, "Vanity Fair": 6, "TheWrap": 6, "The Wrap": 6, "Pitchfork": 6, "Vulture": 6, "Entertainment Tonight": 6, "E! Online": 6, "USA Today": 6,
  "Collider": 5, "ScreenRant": 5, "Screen Rant": 5, "/Film": 5, "SlashFilm": 5, "CBR": 5, "Consequence": 5, "Stereogum": 5, "GameSpot": 5, "IGN": 5,
  "TMZ": 4, "Page Six": 4, "Daily Mail": 4, "The Sun": 4, "Mirror": 4, "HollywoodLife": 4,
};
const tierFor = (o) => OUTLET_TIER[o] ?? 5;
const strip = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);

async function searchOne(q) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 18).map((m) => {
      const b = m[1];
      return {
        title: strip((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1]),
        outlet: strip((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]),
        date: (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || null,
      };
    }).filter((x) => x.title && x.outlet);
  } catch { return []; }
}

export async function discoverGoogleNews({ maxPerQuery = 12, freshHours = 96 } = {}) {
  const cutoff = Date.now() - freshHours * 3600 * 1000;
  const results = await Promise.all(QUERIES.map(searchOne));
  const out = [];
  const seen = new Set();
  for (const items of results) {
    let kept = 0;
    for (const it of items) {
      if (kept >= maxPerQuery) break;
      const t = it.date ? Date.parse(it.date) : NaN;
      if (!isNaN(t) && t < cutoff) continue; // freshness gate
      const k = slug(it.title);
      if (!k || seen.has(k)) continue; // intra-pull title de-dup (cross-outlet merge happens in verify)
      seen.add(k);
      out.push({
        source: "gnews:" + it.outlet, outlet: it.outlet, sourceTier: tierFor(it.outlet),
        kind: "gnews", mediaType: "news", title: it.title, summary: "",
        pubDate: it.date || null, ageMin: isNaN(t) ? null : Math.round((Date.now() - t) / 60000),
        cats: ["movies", "tv", "celebrity", "music"], popularity: 0,
      });
      kept++;
    }
  }
  return out;
}
