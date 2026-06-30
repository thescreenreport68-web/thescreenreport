// GOSSIP — CONTENT FINDER (Stage 3, v2). Gets the writer REAL material so it stops inventing. The first run
// proved the root cause: crude HTML-strip handed the writer ~6k chars of NAV CHROME with a thin article buried
// in it, so the cheap writer filled the gaps by fabricating. Fix: extract the CLEAN ARTICLE BODY.
//   extractClean(url): @extractus/article-extractor (isolates the article body) → Jina Reader (JS/walled
//   fallback) → crude fetch+strip (last resort). Fail-closed: 0 extractable sources ⇒ BLOCK.
import { tierOf } from "./policy.mjs";
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

// Extract the CLEAN article body. Returns { text, title } or null. extractImpl injectable for offline tests.
export async function extractClean(url, { fetchImpl = fetch, extractImpl = extractArticle } = {}) {
  // 1) purpose-built article extractor — isolates the real body, drops nav/ads/boilerplate.
  try {
    const a = await extractImpl(url);
    const t = stripHtml(a?.content || "");
    if (t.length >= 300) return { text: t.slice(0, 8000), title: a?.title || "" };
  } catch { /* fall through */ }
  // 2) Jina Reader — renders JS / gets past some bot walls.
  try {
    const r = await fetchImpl("https://r.jina.ai/" + url, { headers: { "User-Agent": UA } });
    if (r.ok) { const t = stripHtml(await r.text()); if (t.length >= 500) return { text: t.slice(0, 8000), title: "" }; }
  } catch { /* fall through */ }
  // 3) crude fetch + strip (last resort).
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": UA } });
    if (r.ok) { const t = stripHtml(await r.text()); if (t.length >= 400) return { text: t.slice(0, 8000), title: "" }; }
  } catch { /* give up on this source */ }
  return null;
}

// topic.sources: [{ outlet, url?, tier?, text? }]. A source with inline text is used directly; a URL is
// extracted cleanly; a bare outlet is a discovery signal only.
export async function gatherBundle(topic, { fetchImpl = fetch, extractImpl, corroborate = false, findUrlsImpl = findCorroboratingUrls, maxCorroborating = 3 } = {}) {
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
  if (corroborate && topic.primaryEntity) {
    try {
      const extra = await findUrlsImpl(topic, { fetchImpl, seedDomain: [...seedDomains][0] || "" });
      for (const e of (extra || []).slice(0, maxCorroborating)) {
        if (seedDomains.has(e.domain)) continue;
        const ex = await extractClean(e.url, { fetchImpl, extractImpl });
        if (ex && ex.text.length >= 400 && mentionsEntity(ex.text)) { sources.push({ outlet: e.domain, url: e.url, tier: tierOf(e.domain), text: ex.text, quotes: [], corroborating: true }); seedDomains.add(e.domain); }
      }
    } catch { /* corroboration is enrichment only — never fatal */ }
  }
  const ok = sources.length > 0;
  return {
    entity: topic.primaryEntity || null,
    sources,
    // Quotable corpus = SEED sources only. Corroborating sources carry text for grounding but contribute NO quotes,
    // so a real quote from a different story can never be handed to the writer as this rumor's evidence.
    quotes: [...new Set(sources.filter((s) => !s.corroborating).flatMap((s) => s.quotes))].slice(0, 20),
    outletCount: new Set(sources.map((s) => s.outlet)).size,
    corroborationCount: new Set(sources.map((s) => (s.url ? registrableDomain(s.url) : s.outlet))).size,
    ok,
    reason: ok ? "" : "no extractable source text — BLOCK (never write a gossip story from nothing)",
  };
}
