// ═══ THE ONE OUTLET TRUST MODULE (2026-07-03 restructure) ═══
// Before this file, THREE independently-maintained outlet maps disagreed (find/verify.mjs OWNER,
// find/sources/gnews.mjs OUTLET_TIER, lib/news.mjs DOMAIN_OWNER + lib/contentFinder.mjs OUTLET_NAME_OWNER/
// TABLOID) — the live consequence was The Washington Post tiering as a "secondary" (5) in gnews while
// news.mjs called it a major, so a WaPo-sourced story was framed as weak-source. Every layer now reads
// from HERE: FIND discovery tiers, cross-source verify independence, the content finder's trust math,
// and corroboration counting. Same-owner outlets are ONE independent source (3 PMC trades = 1 owner).

export const dom = (d) => (d || "").toLowerCase().replace(/^www\./, "").trim();

// Domain → parent owner. TABLOID domains live here too (for independence keying) but are tier-flagged below.
export const DOMAIN_OWNER = {
  // PMC trade desks (all ONE owner)
  "variety.com": "PMC", "deadline.com": "PMC", "hollywoodreporter.com": "PMC", "indiewire.com": "PMC", "rollingstone.com": "PMC", "billboard.com": "PMC",
  // Valnet network (all ONE owner)
  "collider.com": "Valnet", "screenrant.com": "Valnet", "cbr.com": "Valnet", "gamerant.com": "Valnet", "thegamer.com": "Valnet", "movieweb.com": "Valnet",
  // Dotdash Meredith
  "ew.com": "Dotdash", "people.com": "Dotdash", "entertainmentweekly.com": "Dotdash",
  // independent reputable desks (each its own owner)
  "thewrap.com": "TheWrap", "apnews.com": "AP", "reuters.com": "Reuters", "vanityfair.com": "CondeNast",
  "nytimes.com": "NYT", "latimes.com": "LATimes", "washingtonpost.com": "WaPo", "thedailybeast.com": "DailyBeast",
  "bbc.com": "BBC", "bbc.co.uk": "BBC", "theguardian.com": "Guardian", "cnn.com": "WBD", "ign.com": "Ziff",
  "usatoday.com": "Gannett", "etonline.com": "ETParamount", "eonline.com": "NBCU", "today.com": "NBCU", "nbcnews.com": "NBCU",
  "tmz.com": "TMZ", "vulture.com": "NYMag", "avclub.com": "GO", "npr.org": "NPR", "forbes.com": "Forbes",
  "abcnews.go.com": "Disney", "huffpost.com": "BuzzFeed", "slashfilm.com": "Static", "gamespot.com": "Fandom",
};
export const MAJORS = new Set(Object.keys(DOMAIN_OWNER));

// Known tabloids — gathered but tier-flagged so verification can demand a major for sensitive claims.
export const TABLOID = new Set(["tmz.com", "dailymail.co.uk", "the-sun.com", "thesun.co.uk", "mirror.co.uk", "pagesix.com", "nypost.com", "radaronline.com", "hollywoodlife.com", "perezhilton.com", "okmagazine.com"]);

// Outlet DISPLAY-NAME (lowercased) → parent owner, so a gnews "Variety" inline source collapses onto the
// SAME owner as an extracted variety.com source. Anything unlisted falls back to a normalized name token,
// which still collapses with its own domain ("Bleeding Cool" ↔ "bleedingcool.com").
export const OUTLET_NAME_OWNER = {
  "variety": "PMC", "variety music": "PMC", "deadline": "PMC", "the hollywood reporter": "PMC", "hollywood reporter": "PMC", "thr": "PMC", "indiewire": "PMC", "rolling stone": "PMC", "billboard": "PMC",
  "collider": "Valnet", "screenrant": "Valnet", "screen rant": "Valnet", "cbr": "Valnet", "gamerant": "Valnet", "movieweb": "Valnet",
  "people": "Dotdash", "entertainment weekly": "Dotdash", "ew": "Dotdash",
  "thewrap": "TheWrap", "the wrap": "TheWrap", "associated press": "AP", "ap news": "AP", "ap": "AP", "reuters": "Reuters",
  "the new york times": "NYT", "los angeles times": "LATimes", "the washington post": "WaPo", "washington post": "WaPo", "the guardian": "Guardian", "bbc": "BBC", "npr": "NPR",
  "vanity fair": "CondeNast", "vulture": "NYMag", "tmz": "TMZ", "page six": "TMZ", "entertainment tonight": "ETParamount", "etonline": "ETParamount", "e! online": "NBCU", "e online": "NBCU", "today": "NBCU", "usa today": "Gannett",
  "cnn": "WBD", "slashfilm": "Static", "/film": "Static", "nbc news": "NBCU", "abc news": "Disney", "forbes": "Forbes",
};

// Canonical owner key for dedup + the independent-owner trust count — collapse a display name and its own
// domain to one token so ONE outlet is never counted as TWO owners.
export const canonOwner = (o) => String(o || "").toLowerCase().replace(/\.[a-z.]{2,6}$/, "").replace(/[^a-z0-9]/g, "");

// Owner for a display NAME (find/verify.mjs independence counting) — superset of its old 8-entry OWNER map.
export const ownerOfName = (name) => OUTLET_NAME_OWNER[String(name || "").toLowerCase().trim()] || name;

// Domain → { tier: major|tabloid|other, owner } for the content finder's trust math. TABLOID is checked
// BEFORE MAJORS: tmz.com/nypost.com live in DOMAIN_OWNER (for independence keying) but must NOT satisfy the
// major-outlet trust bar.
export function tierFor(domain) {
  const d = dom(domain);
  if (TABLOID.has(d)) return { tier: "tabloid", owner: DOMAIN_OWNER[d] || d };
  if (MAJORS.has(d)) return { tier: "major", owner: DOMAIN_OWNER[d] };
  return { tier: "other", owner: d };
}

// Outlet display-name → NUMERIC discovery tier (rss.mjs scale: wire/AP 8, major trade/paper 7, major celeb
// desk 6, reputable secondary 5, tabloid 4). Used by gnews discovery + FIND verify.
export const NAME_TIER = {
  "Associated Press": 8, "AP News": 8, "Reuters": 8,
  "Variety": 7, "Deadline": 7, "The Hollywood Reporter": 7, "Hollywood Reporter": 7,
  "Billboard": 7, "Rolling Stone": 7, "The New York Times": 7, "Los Angeles Times": 7,
  "The Washington Post": 7, "Washington Post": 7, "The Guardian": 7, "BBC": 7, "NPR": 7, "BBC News": 7,
  "People": 6, "Entertainment Weekly": 6, "IndieWire": 6, "Vanity Fair": 6, "TheWrap": 6, "The Wrap": 6,
  "Pitchfork": 6, "Vulture": 6, "Entertainment Tonight": 6, "E! Online": 6, "USA Today": 6, "CNN": 6,
  "NBC News": 6, "ABC News": 6,
  "Collider": 5, "ScreenRant": 5, "Screen Rant": 5, "/Film": 5, "SlashFilm": 5, "CBR": 5,
  "Consequence": 5, "Stereogum": 5, "GameSpot": 5, "IGN": 5, "Forbes": 5,
  "TMZ": 4, "Page Six": 4, "Daily Mail": 4, "The Sun": 4, "Mirror": 4, "HollywoodLife": 4,
};
export const nameTier = (o) => NAME_TIER[o] ?? 5;

// AGGREGATORS / republishers — they re-surface other outlets' stories, so their presence is NOT independent
// corroboration and their name is NOT the reporter (the gossip automation's Normani lesson: a thin story must
// not be elevated to "reported by Yahoo" because Yahoo echoed it).
export const AGGREGATORS = new Set([
  "yahoo.com", "news.yahoo.com", "msn.com", "aol.com", "news.google.com", "flipboard.com", "smartnews.com",
  "apple.news", "bing.com", "newsbreak.com", "ground.news", "headtopics.com", "biztoc.com",
]);
export const isAggregator = (domain) => AGGREGATORS.has(dom(domain));

// Does a headline plausibly name THIS story's subject? (drops "Kenneth Walker" noise from a "Dick Van Dyke
// walker" query). Require the full name or the surname.
export function titleNamesEntity(title, entity) {
  const t = (title || "").toLowerCase();
  const e = (entity || "").trim().toLowerCase();
  if (!e) return true;
  const surname = e.split(/\s+/).pop() || "";
  return t.includes(e) || (surname.length > 2 && t.includes(surname));
}
