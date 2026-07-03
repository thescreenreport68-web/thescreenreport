// EXTERNAL breaking-news corroboration via GDELT DOC 2.0 (free, keyless, NON-Wikipedia) — PR7.
//
// FIND verify.mjs corroborates only WITHIN one RSS pull (see its lines 19-22): a one-major story can't be
// confirmed until a 2nd outlet happens to be in the same pull. GDELT indexes the whole open web every 15 min,
// so we ask it: does an INDEPENDENT set of MAJOR outlets report THIS event? If ≥2 independent major OWNERS do,
// we UPGRADE an under-sourced DEVELOPING/CONFIRMING event to CONFIRMED. We only ever UPGRADE — never suppress a
// fresh story on a GDELT miss (GDELT can lag minutes behind a <15-min scoop). NON-Wikipedia by construction.

// Domain → parent owner: now sourced from THE ONE outlet trust module (lib/outlets.mjs, 2026-07-03) — the
// three drifted per-layer maps are gone. Re-exported here so existing importers keep working.
import { DOMAIN_OWNER, MAJORS, dom } from "./outlets.mjs";
export { DOMAIN_OWNER, MAJORS, dom };

// GDELT enforces ≤1 request / 5 seconds (429 otherwise). Throttle every call to be a polite citizen, and
// retry once on a 429. Sequential by design (externalCorroboration awaits each call), so a simple gate works.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _lastGdelt = 0;
async function throttle() { const wait = 6500 - (Date.now() - _lastGdelt); if (wait > 0) await sleep(wait); _lastGdelt = Date.now(); }

// GDELT article-list query (real publisher url/title/domain/date) — the source ENUMERATOR for the CONTENT
// FINDER (Step 2) and externalCorroboration below. Free, keyless GDELT DOC 2.0 endpoint + the 5s throttle.
// (gdeltCorroborate — the count-only variant — was removed 2026-07-03: zero callers, superseded by this.)
export async function gdeltArticles(query, { sinceHours = 120, maxRecords = 40 } = {}) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${maxRecords}&timespan=${sinceHours}h&sort=hybridrel`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await throttle();
      const r = await fetch(url, { headers: { "User-Agent": "TheScreenReport/1.0 (editor@thescreenreport.com)" }, signal: AbortSignal.timeout(15000) });
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

// Wire-in pass for findrun: upgrade under-sourced events that the open web independently corroborates AND enrich
// the topic's sources with the real GDELT publisher URLs (Phase A) — one GDELT call now does both, instead of
// corroborating here and re-querying the same thing in the content finder. The added URLs give MAKE real article
// bodies to extract from (a major outlet the in-run RSS pull missed), directly feeding the writer's grounding.
export async function externalCorroboration(topics, monitor) {
  const need = (topics || []).filter((t) => ["DEVELOPING", "CONFIRMING"].includes(t.verification?.status));
  let upgraded = 0, enriched = 0;
  for (const t of need) {
    const q = topicQuery(t);
    if (!q) continue;
    // EVENT-TARGETED only for source enrichment: topicQuery is "ent" (kw OR kw) when it has event keywords, bare
    // "ent" otherwise. A bare-entity query returns the celebrity's GENERAL coverage, so its article URLs must NOT
    // enter the writer's primary bundle (off-event fabrication risk) — we still corroborate, but don't enrich.
    const eventTargeted = q.includes("(");
    const arts = await gdeltArticles(q, { sinceHours: 72, maxRecords: 50 });
    // Count INDEPENDENT major OWNERS (3 PMC trades = 1) and keep the first real article URL per owner.
    const owners = new Map(); // owner → the first major article seen for it
    for (const a of arts) { const d = dom(a.domain); if (MAJORS.has(d) && !owners.has(DOMAIN_OWNER[d])) owners.set(DOMAIN_OWNER[d], a); }
    const majors = [...owners.values()].map((a) => dom(a.domain));
    t.verification.gdelt = { majorOwners: owners.size, majors };
    // ENRICH sources with the corroborating MAJOR publisher URLs (deduped by the content finder later). url-only
    // (no inline summary), so they add extraction candidates without polluting the inline-text bundle. Skipped on
    // a bare-entity query so we never feed the writer an off-event same-celebrity article.
    const added = [];
    if (eventTargeted) for (const a of owners.values()) {
      if (added.length >= 4 || !a.url) break;
      added.push({ outlet: dom(a.domain), tier: 7, url: a.url, headline: a.title || t.title, summary: "" });
    }
    if (added.length) { t.sources = [...(t.sources || []), ...added]; enriched++; }
    if (owners.size >= 2) {
      const prev = t.verification.status;
      Object.assign(t.verification, { status: "CONFIRMED", framing: "plain", publishable: true, attribution: null, corroboratedBy: `GDELT: ${majors.join(", ")}` });
      upgraded++;
      monitor?.stage?.("corroborate", `↑ ${prev}→CONFIRMED via GDELT (${owners.size} independent majors: ${majors.join(", ")}) · ${t.title}`);
    }
  }
  monitor?.stage?.("corroborate", `GDELT external corroboration: ${upgraded}/${need.length} upgraded to CONFIRMED, ${enriched} enriched with source URLs`);
  return topics;
}
