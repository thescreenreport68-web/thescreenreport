// GOSSIP — CONTENT FINDER (Stage 3, v2). Gets the writer REAL material so it stops inventing. The first run
// proved the root cause: crude HTML-strip handed the writer ~6k chars of NAV CHROME with a thin article buried
// in it, so the cheap writer filled the gaps by fabricating. Fix: extract the CLEAN ARTICLE BODY.
//   extractClean(url): @extractus/article-extractor (isolates the article body) → Jina Reader (JS/walled
//   fallback) → crude fetch+strip (last resort). Fail-closed: 0 extractable sources ⇒ BLOCK.
import { tierOf } from "./policy.mjs";
import { extract as extractArticle } from "@extractus/article-extractor";

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
export async function gatherBundle(topic, { fetchImpl = fetch, extractImpl } = {}) {
  const sources = [];
  for (const s of topic.sources || []) {
    const tier = s.tier ?? tierOf(s.outlet);
    if (s.text) {
      const text = stripHtml(s.text);
      if (text.length >= 1) sources.push({ outlet: s.outlet, url: s.url || null, tier, text: text.slice(0, 8000), quotes: extractQuotes(s.text) });
      continue;
    }
    if (!s.url) continue;
    const ex = await extractClean(s.url, { fetchImpl, extractImpl });
    if (ex) sources.push({ outlet: s.outlet, url: s.url, tier, text: ex.text, quotes: extractQuotes(ex.text) });
  }
  const ok = sources.length > 0;
  return {
    entity: topic.primaryEntity || null,
    sources,
    quotes: [...new Set(sources.flatMap((s) => s.quotes))].slice(0, 16),
    outletCount: new Set(sources.map((s) => s.outlet)).size,
    ok,
    reason: ok ? "" : "no extractable source text — BLOCK (never write a gossip story from nothing)",
  };
}
