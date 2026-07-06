// DISCOVERY source — Google News RSS SEARCH (trend-finder hardening, step 6, 2026-06-29). Free + keyless. The
// curated trade RSS (rss.mjs) is a fixed set of ~15 feeds; a single-outlet story there waits for corroboration and
// often never publishes (the "0 publishable" finding). Google News surfaces the SAME trending story across MANY
// outlets, so a Collider/ScreenRant item also gets a Variety/Deadline hit → the cross-source verify merges them →
// 2 independent owners → CONFIRMED/DEVELOPING → publishable. We read only the headline + outlet + timestamp (a
// DISCOVERY SIGNAL); the content finder gathers the real source text later, in our own words.
const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";

// Broad in-niche queries (Google News `when:Nd` recency operator) — wide enough to surface trending Hollywood
// film/TV, celebrity, and Western/English-music news from across the open web; the categorize LLM filters relevance.
// (owner 2026-07-06) Broadened for full cross-category coverage so a tick ALWAYS has fresh trending content — the
// niche always has SOMETHING trending across movies / TV / music / musicians / celebrity. Kept in-niche; the
// categorize LLM + scope/editorial gate filter relevance downstream.
const QUERIES = [
  "Hollywood movie when:2d",
  "movie casting OR sequel OR reboot OR director when:2d",
  "TV series renewed OR canceled OR casting when:2d",
  "TV show premiere OR finale OR trailer when:2d",
  "celebrity when:1d",
  "celebrity dating OR wedding OR split OR feud when:2d",
  "weekend box office when:3d",
  "new trailer OR teaser when:2d",
  "Netflix OR HBO OR Marvel OR DC OR A24 OR Disney when:2d",
  "new album OR world tour OR single OR music video when:2d",
  "pop star OR rapper OR singer OR band OR musician when:2d",
  "streaming series OR limited series OR docuseries when:3d",
  "Star Wars OR Marvel OR DC OR franchise when:3d",
  "Grammys OR Oscars OR Emmys OR award winners when:5d",
];

// Outlet name → corroboration tier: THE ONE trust module (lib/outlets.mjs, 2026-07-03) — the local copy here
// was missing The Washington Post (tiered a WaPo scoop as "secondary 5"), the exact drift the merge kills.
import { nameTier as tierFor } from "../../lib/outlets.mjs";
const strip = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);

async function searchOne(q) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 24).map((m) => {
      const b = m[1];
      const rawLink = strip((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
      return {
        title: strip((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1]),
        outlet: strip((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]),
        date: (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || null,
        // The Google-News redirect link (news.google.com/rss/articles/...). It is NOT a clean publisher URL,
        // but Jina Reader follows the redirect and returns the real article, so the content finder can still
        // extract from it. The <description> snippet gives the writer a little more than a bare headline.
        url: /^https?:\/\//.test(rawLink) ? rawLink : null,
        summary: strip((b.match(/<description>([\s\S]*?)<\/description>/) || [])[1]).slice(0, 300),
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
        kind: "gnews", mediaType: "news", title: it.title, summary: it.summary || "",
        url: it.url || null, // Google-News redirect; the content finder resolves it via Jina
        pubDate: it.date || null, ageMin: isNaN(t) ? null : Math.round((Date.now() - t) / 60000),
        cats: ["movies", "tv", "celebrity", "music"], popularity: 0,
      });
      kept++;
    }
  }
  return out;
}
