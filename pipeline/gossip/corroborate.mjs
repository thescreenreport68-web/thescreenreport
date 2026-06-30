// GOSSIP — MULTI-SOURCE CORROBORATION (Step 4). Once a rumor surfaces, FIND the other articles about it across
// outlets and hand the writer a RICHER multi-source bundle to rewrite FAITHFULLY (no invention). More real
// material = fewer fabrications, a higher publish rate, and attribution that scales (3 owners → "multiple
// outlets"; 1 → "according to <Outlet>"). FREE via GDELT's artlist (real URLs); Exa is a future paid upgrade.
import { topicQuery } from "../lib/news.mjs";

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";
export const registrableDomain = (d) => (d || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();

const defaultFetch = (url, opts) => fetch(url, opts);

// GDELT artlist → corroborating article URLs about THIS rumor, ONE per DISTINCT domain (so two URLs from the
// same outlet don't double-count as corroboration). Free, keyless, fail-safe ([] on any issue/rate-limit).
export async function findCorroboratingUrls(topic, { fetchImpl = defaultFetch, seedDomain = "", max = 4 } = {}) {
  const q = topicQuery(topic);
  if (!q) return [];
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=20&timespan=96h&sort=hybridrel`;
    const r = await fetchImpl(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const text = await r.text();
    if (!text.trim().startsWith("{")) return []; // GDELT returns plain text on a bad query
    const arts = JSON.parse(text).articles || [];
    const seen = new Set([registrableDomain(seedDomain)].filter(Boolean));
    const out = [];
    for (const a of arts) {
      const d = registrableDomain(a.domain || a.url);
      if (!a.url || !d || seen.has(d)) continue;
      seen.add(d);
      out.push({ url: a.url, domain: d, title: a.title || "" });
      if (out.length >= max) break;
    }
    return out;
  } catch {
    return [];
  }
}
