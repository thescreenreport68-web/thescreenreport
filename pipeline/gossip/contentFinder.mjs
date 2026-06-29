// GOSSIP — CONTENT FINDER (Stage 3). Fetches the REAL trigger artifact(s) so the writer works from receipts,
// not a blurb: the source article text + candidate direct quotes + the outlet/tier. FAIL-CLOSED — if nothing
// extractable comes back, the story is BLOCKED (we never write a gossip article from nothing).
//
// fetchImpl is injectable so the test harness runs fully offline (no live network).
import { tierOf } from "./policy.mjs";

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";

export const stripHtml = (html) =>
  (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Candidate direct quotes (curly or straight), 8–240 chars with at least one space — the writer's quote corpus.
export function extractQuotes(text) {
  const out = [];
  for (const m of (text || "").matchAll(/[“"]([^”"]{8,240})[”"]/g)) {
    const s = m[1].trim();
    if (/\s/.test(s) && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 12);
}

async function defaultFetch(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

// topic.sources: [{ outlet, url?, tier?, text? }]. A source with a URL is fetched + extracted; a source with
// inline text (e.g. a cached social post) is used directly; a bare outlet name is a discovery signal only.
export async function gatherBundle(topic, { fetchImpl = defaultFetch, minChars = 400 } = {}) {
  const sources = [];
  for (const s of topic.sources || []) {
    const tier = s.tier ?? tierOf(s.outlet);
    if (s.text) {
      const text = stripHtml(s.text);
      if (text.length >= 1) sources.push({ outlet: s.outlet, url: s.url || null, tier, text: text.slice(0, 12000), quotes: extractQuotes(s.text) });
      continue;
    }
    if (!s.url) continue; // bare outlet = signal only, nothing to extract
    try {
      const text = stripHtml(await fetchImpl(s.url));
      if (text.length >= minChars) sources.push({ outlet: s.outlet, url: s.url, tier, text: text.slice(0, 12000), quotes: extractQuotes(text) });
    } catch {
      /* unreachable source — skip */
    }
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
