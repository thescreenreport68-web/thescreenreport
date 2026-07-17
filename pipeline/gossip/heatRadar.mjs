// GOSSIP — ENTITY HEAT RADAR (Phase 1). FREE demand signal, zero manual pins: Wikimedia Pageviews for an
// entity's Wikipedia article. heat = yesterday's views ÷ trailing-week average — a celebrity in a heat window
// (wedding/split/feud blowing up) spikes 2–20×, and their topics should out-rank filler in the queue.
// Data-driven awareness only (the news lane's Event-Radar principle): a signal, never a citable fact.
// Fail-soft everywhere: no article / API error / weird shape ⇒ heat null (the ranker treats null as neutral).
const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";

const d8 = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const titleFor = (entity) => String(entity || "").trim().replace(/\s+/g, "_");

// Pageview heat ratio for ONE entity. ~1 = normal, >2.5 = warm, >5 = heat window.
export async function entityHeat(entity, { fetchImpl = fetch, nowMs } = {}) {
  const t = titleFor(entity);
  if (!t || t.length < 3) return null;
  const now = nowMs ?? Date.now();
  const end = new Date(now - 24 * 3600e3);       // yesterday (today's bucket is partial)
  const start = new Date(now - 8 * 24 * 3600e3); // 8 days back → 7 full daily buckets + yesterday
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodeURIComponent(t)}/daily/${d8(start)}/${d8(end)}`;
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return null; // 404 = no article for this exact name — fine, neutral
    const items = (await r.json())?.items || [];
    if (items.length < 3) return null;
    const views = items.map((i) => i.views || 0);
    const latest = views[views.length - 1];
    const base = views.slice(0, -1);
    const avg = base.reduce((a, b) => a + b, 0) / base.length;
    if (!avg) return null;
    return Number((latest / avg).toFixed(2));
  } catch { return null; }
}

// Attach heat to a topic list (one lookup per UNIQUE entity, concurrent, best-effort). Mutates + returns topics.
export async function attachHeat(topics, { fetchImpl = fetch, nowMs, maxEntities = 40 } = {}) {
  const entities = [...new Set((topics || []).map((t) => t?.primaryEntity).filter(Boolean))].slice(0, maxEntities);
  const heat = new Map();
  await Promise.all(entities.map(async (e) => heat.set(e, await entityHeat(e, { fetchImpl, nowMs }))));
  for (const t of topics || []) if (t?.primaryEntity && heat.has(t.primaryEntity)) t.heat = heat.get(t.primaryEntity);
  return topics;
}
