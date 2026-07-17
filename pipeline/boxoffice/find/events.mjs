// P2 FIND — EVENT EXTRACTION + CLUSTERING. Raw headline items → typed box-office EVENTS via ONE batched
// cheap categorize call (the only LLM in the whole FIND path), then deterministic clustering by eventSlug
// with independent-OWNER corroboration (Penske's trades count as ONE owner — the news lane's lesson).
import { agentChat } from "../models.mjs";

// Owner-group map: corroboration counts DISTINCT owner groups, not mastheads (Variety+Deadline+THR are
// all Penske Media — one editorial org, one vote).
const OWNER_GROUP = {
  "variety": "pmc", "deadline": "pmc", "the hollywood reporter": "pmc", "indiewire": "pmc",
  "thewrap": "thewrap", "the wrap": "thewrap",
};
export const ownerGroup = (owner) => OWNER_GROUP[String(owner || "").toLowerCase().trim()] || String(owner || "other").toLowerCase().trim();

export const KINDS = ["opening", "weekend", "milestone", "record", "streaming-arrival", "viewership", "other"];
// Event kind → the MAKE form that writes it (dedicated forms come in P5; the proven forms carry P2).
export const KIND_FORM = {
  "opening": "BO-OPENING", "weekend": "BO-WEEKEND", "milestone": "BO-MILESTONE", "record": "BO-RECORD",
  "streaming-arrival": "NOW-STREAMING", "viewership": "TRENDING-TV", "other": "BO-UPDATE",
};

const SYS = `You classify entertainment-news HEADLINES for a Hollywood BOX-OFFICE + STREAMING money desk.
For EACH numbered headline decide:
- relevant: is it a concrete money/performance EVENT about a SPECIFIC Hollywood/English-language film or
  series (an opening/weekend figure, a milestone/record, a "now streaming" arrival, a viewership report)?
  Reviews, interviews, trailers, casting, awards chatter, general industry pieces → relevant=false.
- filmTitle: the EXACT film/series title the event is about ("" if none / roundup with no lead film).
- kind: one of opening | weekend | milestone | record | streaming-arrival | viewership | other.
Output STRICT JSON only: {"items":[{"i":1,"relevant":true,"filmTitle":"","kind":"weekend"}]}`;

const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
// Deterministic event slug — film + kind (never trust a model-written slug).
export const eventSlugFor = (filmTitle, kind) => `${slugify(filmTitle) || "roundup"}-ev-${kind}`;

// categorize(items) → items annotated {relevant, filmTitle, kind} via batched calls (8/batch, cap 24).
export async function categorize(items, { chatImpl = null, cap = 24 } = {}) {
  const short = items.slice(0, cap);
  const out = [];
  for (let i = 0; i < short.length; i += 8) {
    const batch = short.slice(i, i + 8);
    const user = batch.map((it, n) => `${n + 1}. ${it.title}`).join("\n");
    let data = null;
    try { ({ data } = await agentChat("categorize", { system: SYS, user }, chatImpl ? { chatImpl } : {})); } catch { data = null; }
    const rows = Array.isArray(data?.items) ? data.items : [];
    batch.forEach((it, n) => {
      const r = rows.find((x) => Number(x?.i) === n + 1) || {};
      const kind = KINDS.includes(r.kind) ? r.kind : "other";
      out.push({ ...it, relevant: !!r.relevant && !!String(r.filmTitle || "").trim(), filmTitle: String(r.filmTitle || "").trim(), kind });
    });
  }
  return out;
}

// cluster(categorized) → EVENTS: one per (film, kind), sources merged, owner-corroborated.
export function cluster(categorized, { nowMs = Date.now() } = {}) {
  const events = new Map();
  for (const it of categorized) {
    if (!it.relevant || !it.filmTitle) continue;
    const slug = eventSlugFor(it.filmTitle, it.kind);
    const ev = events.get(slug) || {
      slug, filmTitle: it.filmTitle, kind: it.kind, form: KIND_FORM[it.kind] || "BO-UPDATE",
      sources: [], owners: new Set(), newestMs: 0,
    };
    ev.sources.push({ owner: it.owner, tier: it.tier, url: it.url, title: it.title });
    ev.owners.add(ownerGroup(it.owner));
    ev.newestMs = Math.max(ev.newestMs, it.pubMs || nowMs);
    events.set(slug, ev);
  }
  return [...events.values()].map((ev) => ({ ...ev, owners: undefined, ownerGroups: ev.owners.size, sources: ev.sources.slice(0, 5) }));
}
