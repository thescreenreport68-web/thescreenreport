// GOSSIP — CONTENT FINDER (Stage 3, v2). Gets the writer REAL material so it stops inventing. The first run
// proved the root cause: crude HTML-strip handed the writer ~6k chars of NAV CHROME with a thin article buried
// in it, so the cheap writer filled the gaps by fabricating. Fix: extract the CLEAN ARTICLE BODY.
//   extractClean(url): @extractus/article-extractor (isolates the article body) → Jina Reader (JS/walled
//   fallback) → crude fetch+strip (last resort). Fail-closed: 0 extractable sources ⇒ BLOCK.
import { tierOf, tierOfDomain } from "./policy.mjs";
import { extract as extractArticle } from "@extractus/article-extractor";
import { findCorroboratingUrls, registrableDomain } from "./corroborate.mjs";

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";

export const stripHtml = (html) =>
  (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Candidate verbatim direct quotes (curly or straight), 8–240 chars — the writer's quote corpus.
export function extractQuotes(text) {
  const out = [];
  for (const m of (text || "").matchAll(/[“"]([^”"]{8,240})[”"]/g)) {
    const s = m[1].trim();
    if (/\s/.test(s) && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 12);
}

// Per-fetch/extract time budget. CRITICAL: extraction is ENRICHMENT and runs in the hot path — a source that hangs
// (e.g. a rate-limited Jina holding the connection open) must be abandoned, never allowed to stall the whole run.
const EXTRACT_TIMEOUT_MS = 9000;
// Abort a fetch after ms so a hung connection is torn down (frees the ref too, so the process can exit cleanly).
const abortable = (opts = {}, ms = EXTRACT_TIMEOUT_MS) => ({ ...opts, signal: opts.signal || AbortSignal.timeout(ms) });
// article-extractor does its own internal fetch we can't signal — race it against a timeout (unref'd so a slow
// extractor can't keep the process alive).
function withTimeout(promise, ms = EXTRACT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("extract timeout")), ms);
    if (typeof t?.unref === "function") t.unref();
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// Extract the CLEAN article body. Returns { text, title, url? } or null. extractImpl injectable for offline tests.
export async function extractClean(url, { fetchImpl = fetch, extractImpl = extractArticle } = {}) {
  // 1) purpose-built article extractor — isolates the real body, drops nav/ads/boilerplate.
  try {
    const a = await withTimeout(Promise.resolve(extractImpl(url)));
    const t = stripHtml(a?.content || "");
    if (t.length >= 300) return { text: t.slice(0, 8000), title: a?.title || "" };
  } catch { /* fall through */ }
  // 2) Jina Reader — renders JS / gets past some bot walls, AND follows redirects (a Google News corroboration
  //    link → the real publisher article). Capture Jina's "URL Source:" line = the RESOLVED publisher URL, so the
  //    hero picker can fetch that outlet's og:image (a google-redirect URL has no article og:image of its own).
  try {
    const r = await fetchImpl("https://r.jina.ai/" + url, abortable({ headers: { "User-Agent": UA } }));
    if (r.ok) {
      const raw = await r.text();
      const resolved = (raw.match(/URL Source:\s*(\S+)/i) || [])[1] || "";
      const t = stripHtml(raw);
      if (t.length >= 500) return { text: t.slice(0, 8000), title: "", url: /^https?:\/\//.test(resolved) ? resolved : null };
    }
  } catch { /* fall through */ }
  // 3) crude fetch + strip (last resort).
  try {
    const r = await fetchImpl(url, abortable({ headers: { "User-Agent": UA } }));
    if (r.ok) { const t = stripHtml(await r.text()); if (t.length >= 400) return { text: t.slice(0, 8000), title: "" }; }
  } catch { /* give up on this source */ }
  return null;
}

// topic.sources: [{ outlet, url?, tier?, text? }]. A source with inline text is used directly; a URL is
// extracted cleanly; a bare outlet is a discovery signal only.
export async function gatherBundle(topic, { fetchImpl = fetch, extractImpl, corroborate = false, findUrlsImpl = findCorroboratingUrls, maxCorroborating = 2 } = {}) {
  const sources = [];
  const seedDomains = new Set();
  // Entity-mention gate for corroborating sources (below): a real corroborating article about THIS rumor names the
  // person. Require the full name OR the surname so we don't admit a loosely-related GDELT hit about someone else.
  const ent = (topic.primaryEntity || "").trim();
  const entLc = ent.toLowerCase();
  const surnameLc = ent.split(/\s+/).pop()?.toLowerCase() || "";
  const mentionsEntity = (txt) => { const t = (txt || "").toLowerCase(); return !ent || t.includes(entLc) || (surnameLc.length > 2 && t.includes(surnameLc)); };
  for (const s of topic.sources || []) {
    const tier = s.tier ?? tierOf(s.outlet);
    if (s.text) {
      const text = stripHtml(s.text);
      // Floor the inline path too (was >= 1) so a near-empty "source" can't satisfy the fail-closed Stage-3 gate.
      if (text.length >= 80) sources.push({ outlet: s.outlet, url: s.url || null, tier, text: text.slice(0, 8000), quotes: extractQuotes(s.text) });
      else if (s.url) { const ex = await extractClean(s.url, { fetchImpl, extractImpl }); if (ex) { sources.push({ outlet: s.outlet, url: s.url, tier, text: ex.text, quotes: extractQuotes(ex.text) }); seedDomains.add(registrableDomain(s.url)); } }
      continue;
    }
    if (!s.url) continue;
    const ex = await extractClean(s.url, { fetchImpl, extractImpl });
    if (ex) { sources.push({ outlet: s.outlet, url: s.url, tier, text: ex.text, quotes: extractQuotes(ex.text) }); seedDomains.add(registrableDomain(s.url)); }
  }
  // STEP 4 — corroboration: find + extract MORE articles about the same rumor, from DISTINCT outlets, so the
  // writer has corroborated real material (not one thin blurb). Best-effort: any issue ⇒ just the original
  // source(s). Wrapped so a finder/extractor fault NEVER breaks an otherwise-publishable run.
  // GUARD: only admit a corroborating article that actually NAMES the entity (drops loosely-related GDELT noise),
  // and NEVER surface its quotes to the writer (a verbatim quote from a DIFFERENT story about the same person must
  // not be attributable to THIS rumor) — corroborating sources add corroboration COUNT + grounding text, not quotes.
  // corroboratingOutlets = EVERY distinct outlet found covering this story (name + domain + tier), even the ones we
  // don't extract a body from. The frame tiers off this: "6 major wires reported it" makes it a FACT, not
  // speculation — a signal that must survive even when a given outlet's article body isn't fetchable.
  const bundle = {
    entity: topic.primaryEntity || null,
    sources,
    corroboratingOutlets: [], // tiering/attribution signal (all covering outlets), separate from the extracted bodies
    ok: sources.length > 0,
    reason: sources.length ? "" : "no extractable source text — BLOCK (never write a gossip story from nothing)",
  };
  refreshBundleCounts(bundle);
  // Back-compat: corroborate inline when asked. The CHEAP-FIRST path (run.mjs Phase 1) gathers with
  // corroborate:false, runs the editorial gate, and pays for corroboration ONLY on stories the gate keeps.
  if (corroborate && bundle.ok) await corroborateBundle(topic, bundle, { fetchImpl, extractImpl, findUrlsImpl, maxCorroborating });
  return bundle;
}

// Recompute the derived counts + the quotable corpus after sources change. Quotable corpus = SEED sources only:
// corroborating sources carry text for grounding but contribute NO quotes, so a real quote from a different story
// can never be handed to the writer as this rumor's evidence.
function refreshBundleCounts(bundle) {
  const sources = bundle.sources;
  bundle.coveringOutletCount = new Set([...sources.map((s) => (s.url ? registrableDomain(s.url) : s.outlet)), ...bundle.corroboratingOutlets.map((o) => o.domain)]).size;
  bundle.quotes = [...new Set(sources.filter((s) => !s.corroborating).flatMap((s) => s.quotes || []))].slice(0, 20);
  bundle.outletCount = new Set(sources.map((s) => s.outlet)).size;
  bundle.corroborationCount = new Set(sources.map((s) => (s.url ? registrableDomain(s.url) : s.outlet))).size;
  return bundle;
}

// STEP 4 as a standalone stage (Phase 1 cheap-first): find + extract MORE articles about the same rumor, from
// DISTINCT outlets, and fold them into an EXISTING bundle. Same guards as before: entity-mention gate, extraction
// attempt cap, corroborating sources contribute grounding text + outlet count but NEVER quotes. Best-effort —
// a finder/extractor fault never breaks an otherwise-publishable run. Mutates + returns the bundle.
export async function corroborateBundle(topic, bundle, { fetchImpl = fetch, extractImpl, findUrlsImpl = findCorroboratingUrls, maxCorroborating = 2 } = {}) {
  if (!topic?.primaryEntity || !bundle?.sources) return bundle;
  const seedDomains = new Set(bundle.sources.map((s) => (s.url ? registrableDomain(s.url) : null)).filter(Boolean));
  const ent = (topic.primaryEntity || "").trim();
  const entLc = ent.toLowerCase();
  const surnameLc = ent.split(/\s+/).pop()?.toLowerCase() || "";
  const mentionsEntity = (txt) => { const t = (txt || "").toLowerCase(); return !ent || t.includes(entLc) || (surnameLc.length > 2 && t.includes(surnameLc)); };
  try {
    const extra = await findUrlsImpl(topic, { fetchImpl, seedDomain: [...seedDomains][0] || "" });
    let extracted = 0, attempts = 0;
    // Cap extraction ATTEMPTS, not just successes: a rate-limited extractor that keeps failing must not make us
    // try (and time out on) every outlet. Tiering still uses ALL found outlets — it needs no per-source fetch.
    const maxAttempts = maxCorroborating + 1;
    for (const e of extra || []) {
      if (seedDomains.has(e.domain)) continue;
      bundle.corroboratingOutlets.push({ outlet: e.outlet || e.domain, domain: e.domain, tier: tierOfDomain(e.domain) });
      if (extracted >= maxCorroborating || attempts >= maxAttempts) continue; // keep collecting outlets for tiering; stop fetching bodies
      attempts++;
      const ex = await extractClean(e.url, { fetchImpl, extractImpl });
      if (ex && ex.text.length >= 400 && mentionsEntity(ex.text)) {
        // ex.url = Jina's resolved publisher URL (for a Google link); fall back to the original for direct URLs.
        bundle.sources.push({ outlet: e.outlet || e.domain, url: ex.url || e.url, tier: tierOfDomain(e.domain), text: ex.text, quotes: [], corroborating: true });
        seedDomains.add(e.domain);
        extracted++;
      }
    }
  } catch { /* corroboration is enrichment only — never fatal */ }
  return refreshBundleCounts(bundle);
}
