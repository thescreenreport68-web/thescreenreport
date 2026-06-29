// EXTERNAL breaking-news corroboration via GDELT DOC 2.0 (free, keyless, NON-Wikipedia) — PR7.
//
// FIND verify.mjs corroborates only WITHIN one RSS pull (see its lines 19-22): a one-major story can't be
// confirmed until a 2nd outlet happens to be in the same pull. GDELT indexes the whole open web every 15 min,
// so we ask it: does an INDEPENDENT set of MAJOR outlets report THIS event? If ≥2 independent major OWNERS do,
// we UPGRADE an under-sourced DEVELOPING/CONFIRMING event to CONFIRMED. We only ever UPGRADE — never suppress a
// fresh story on a GDELT miss (GDELT can lag minutes behind a <15-min scoop). NON-Wikipedia by construction.

// Domain → parent owner (mirrors verify.mjs OWNER — same-owner outlets are ONE independent source, e.g. PMC
// owns Variety/Deadline/THR/IndieWire/Rolling Stone/Billboard, so all of them together = ONE corroboration).
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
export const dom = (d) => (d || "").toLowerCase().replace(/^www\./, "").trim();

// GDELT enforces ≤1 request / 5 seconds (429 otherwise). Throttle every call to be a polite citizen, and
// retry once on a 429. Sequential by design (externalCorroboration awaits each call), so a simple gate works.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _lastGdelt = 0;
async function throttle() { const wait = 6500 - (Date.now() - _lastGdelt); if (wait > 0) await sleep(wait); _lastGdelt = Date.now(); }

// Query GDELT for an event phrase; count INDEPENDENT major owners reporting it in the window.
export async function gdeltCorroborate(query, { sinceHours = 72, maxRecords = 50 } = {}) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${maxRecords}&timespan=${sinceHours}h&sort=hybridrel`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await throttle();
      const r = await fetch(url, { headers: { "User-Agent": "TheScreenReport/1.0 (editor@thescreenreport.com)" } });
      if (r.status === 429) { await sleep(6000); continue; }       // rate-limited — wait out the window, retry once
      if (!r.ok) return { ok: false, total: 0, majorOwners: 0, majors: [] };
      const text = await r.text();
      if (!text.trim().startsWith("{")) return { ok: false, total: 0, majorOwners: 0, majors: [] }; // GDELT returns plain text on a bad query
      const arts = (JSON.parse(text).articles) || [];
      const owners = new Map(); // owner → first domain seen (so 3 PMC trades = 1 owner)
      for (const a of arts) { const d = dom(a.domain); if (MAJORS.has(d) && !owners.has(DOMAIN_OWNER[d])) owners.set(DOMAIN_OWNER[d], d); }
      return { ok: true, total: arts.length, majorOwners: owners.size, majors: [...owners.values()] };
    } catch { return { ok: false, total: 0, majorOwners: 0, majors: [] }; }
  }
  return { ok: false, total: 0, majorOwners: 0, majors: [] };
}

// Like gdeltCorroborate, but returns the ARTICLE LIST (real publisher url/title/domain/date) — the source
// ENUMERATOR for the CONTENT FINDER (Step 2). Same free, keyless GDELT DOC 2.0 endpoint + the 5s throttle.
export async function gdeltArticles(query, { sinceHours = 120, maxRecords = 40 } = {}) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${maxRecords}&timespan=${sinceHours}h&sort=hybridrel`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await throttle();
      const r = await fetch(url, { headers: { "User-Agent": "TheScreenReport/1.0 (editor@thescreenreport.com)" } });
      const text = await r.text();
      // GDELT signals overload with HTTP 429 OR a plain-text "Please limit requests" body — both are retryable.
      if (r.status === 429 || (!text.trim().startsWith("{") && /limit requests/i.test(text))) { await sleep(8000 * (attempt + 1)); continue; }
      if (!r.ok || !text.trim().startsWith("{")) return [];
      return ((JSON.parse(text).articles) || []).map((a) => ({ url: a.url, title: a.title, domain: dom(a.domain), date: a.seendate || null }));
    } catch { await sleep(2000); }
  }
  return [];
}

// A focused GDELT query for a topic: the entity (quoted, phrase-exact) + up to 2 salient event keywords from
// the title (so we corroborate THIS event, not the person's general coverage).
const STOP = new Set("the a an of to in on for at by and or with as is are was were new film movie show series star stars cast set says report reports according after over from his her their this that has have will".split(" "));
export function topicQuery(t) {
  const ent = (t.primaryEntity || "").replace(/"/g, "").trim();
  if (!ent || ent.length < 3) return null;
  const entWords = new Set(ent.toLowerCase().split(/\s+/));
  const kw = (t.title || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w) && !entWords.has(w)).slice(0, 2);
  return kw.length ? `"${ent}" (${kw.join(" OR ")})` : `"${ent}"`;
}

// Wire-in pass for findrun: upgrade under-sourced events that the open web independently corroborates.
export async function externalCorroboration(topics, monitor) {
  const need = (topics || []).filter((t) => ["DEVELOPING", "CONFIRMING"].includes(t.verification?.status));
  let upgraded = 0;
  for (const t of need) {
    const q = topicQuery(t);
    if (!q) continue;
    const g = await gdeltCorroborate(q, { sinceHours: 72 });
    t.verification.gdelt = { majorOwners: g.majorOwners, majors: g.majors };
    if (g.majorOwners >= 2) {
      const prev = t.verification.status;
      Object.assign(t.verification, { status: "CONFIRMED", framing: "plain", publishable: true, attribution: null, corroboratedBy: `GDELT: ${g.majors.join(", ")}` });
      upgraded++;
      monitor?.stage?.("corroborate", `↑ ${prev}→CONFIRMED via GDELT (${g.majorOwners} independent majors: ${g.majors.join(", ")}) · ${t.title}`);
    }
  }
  monitor?.stage?.("corroborate", `GDELT external corroboration: ${upgraded}/${need.length} under-sourced event(s) upgraded to CONFIRMED`);
  return topics;
}
