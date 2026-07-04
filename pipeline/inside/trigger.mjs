// TRIGGER — detect Tier-S "ripple-worthy" events. Primary feed = the news lane's own outputs
// (queue.json candidates + published.json ledger), so every trigger has ALREADY cleared the news
// lane's corroboration machinery; this lane never re-verifies the parent event, it verifies the
// RIPPLE. Famous-only gate (owner directive): no ripple story about someone nobody knows.
import fs from "node:fs";
import path from "node:path";
import { TRIGGERS, FAMOUS, FIND_QUEUE, FIND_LEDGER, MAX_TRIGGERS_PER_RUN, CONTENT_DIR } from "./config.inside.mjs";
import { searchPersonNotable } from "../lib/tmdb.mjs";

// Older ledger entries predate the verifyStatus field — but the PUBLISHED parent article carries
// the verified badge in its frontmatter (news recheck promotes DEVELOPING→CONFIRMED there). Read
// it locally; a missing/unreadable article stays null → DEVELOPING → deaths stay fail-closed.
function articleStatus(slug) {
  if (!slug) return null;
  try {
    const head = fs.readFileSync(path.join(CONTENT_DIR, slug + ".md"), "utf8").slice(0, 2500);
    const m = head.match(/^storyStatus:\s*['"]?([A-Z-]+)/m);
    return m ? m[1] : null;
  } catch { return null; }
}

const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };

// A parent WORK (film/show/album) vs PERSON decides the hero-image lane later (title backdrops vs
// person profile) — cheap heuristic on eventType.
const TITLE_EVENTS = new Set(["boxoffice", "renewal", "cancellation", "trailer", "announcement"]);

function fromQueueTopic(t) {
  const v = t.verification || {};
  return {
    parentEventSlug: t.eventSlug || null,
    parentSlug: null, // not yet published as news
    parentTitle: t.title,
    primaryEntity: t.primaryEntity,
    entities: t.entities || [],
    eventType: t.eventType || "other",
    sensitivity: v.sensitivity || t.sensitivity || "normal",
    category: t.category,
    priority: t.priority || 0,
    signals: t.signals || {},
    outletCount: v.outletCount ?? 0,
    status: v.status || "QUEUE",
    publishable: !!v.publishable,
    sources: t.sources || [],
    tmdbType: t.tmdbType || "movie",
    subjectKind: TITLE_EVENTS.has(t.eventType) ? "title" : "person",
    via: "queue",
  };
}

function fromLedgerEntry(e) {
  // The ledger stores eventType only folded into entityKey ("gene-hackman:death") — recover it
  // from the suffix (slugKey is the identity for every news eventType token). Without this, every
  // ledger trigger degrades to "other": a death would lose its somber tone, its high sensitivity,
  // and the tribute forms.
  const eventType = e.eventType || (e.entityKey || "").split(":")[1] || "other";
  return {
    parentEventSlug: e.eventSlug || null,
    parentSlug: e.slug || null,
    parentTitle: e.title || "",
    primaryEntity: e.title && e.entityKey ? e.entityKey.split(":")[0].replace(/-/g, " ") : (e.title || ""),
    entities: [],
    eventType,
    sensitivity: ["death", "health", "legal"].includes(eventType) ? "high" : "normal",
    category: e.category || null,
    priority: e.priority || 0,
    signals: e.signals || {},
    outletCount: Array.isArray(e.sourceUrls) ? e.sourceUrls.length : 0,
    // A ledger entry IS a published news article — it cleared the news gates. But post-pivot the
    // news lane also publishes DEVELOPING (attributed) stories, so trust the persisted verify
    // status when present and fall back to DEVELOPING when absent: for confirmedOnly classes
    // (death!) an unknown status must fail CLOSED, never be assumed confirmed.
    status: e.verifyStatus || articleStatus(e.slug) || "DEVELOPING",
    publishable: true,
    sources: (e.sourceUrls || []).map((url) => ({ url, outlet: null, tier: null })),
    tmdbType: "movie",
    subjectKind: TITLE_EVENTS.has(eventType) ? "title" : "person",
    via: "ledger",
  };
}

// Famous gate: wide corroboration OR high FIND priority OR TMDB knows the person as notable.
// (TMDB check only when the cheap signals miss, and only for person-subjects — keyless-cost-free
// but a network call, injectable for tests.)
export async function isFamous(trigger, { searchPersonImpl = searchPersonNotable } = {}) {
  if ((trigger.outletCount || 0) >= FAMOUS.minOutlets) return true;
  if ((trigger.priority || 0) >= FAMOUS.minPriority) return true;
  if (trigger.subjectKind === "person" && trigger.primaryEntity) {
    try {
      // A fuzzy search HIT is not fame — TMDB returns a first result for almost any name.
      // The popularity/knownFor floor is the caller's job (searchPersonNotable's contract).
      const p = await searchPersonImpl(trigger.primaryEntity);
      if (p && (p.popularity || 0) >= FAMOUS.minTmdbPopularity && (p.knownFor ?? 0) >= FAMOUS.minKnownFor) return true;
    } catch { /* network miss ≠ famous */ }
  }
  return false;
}

export async function loadTriggers({
  queuePath = FIND_QUEUE,
  ledgerPath = FIND_LEDGER,
  windowDays = 3,
  max = MAX_TRIGGERS_PER_RUN,
  searchPersonImpl = searchPersonNotable,
  nowMs = null,
} = {}) {
  const now = nowMs ?? Date.now();
  const out = [];
  const seen = new Set();

  const queue = readJson(queuePath, { topics: [] });
  for (const t of queue.topics || []) out.push(fromQueueTopic(t));

  const ledger = readJson(ledgerPath, []);
  const cutoff = now - windowDays * 864e5;
  const entries = Array.isArray(ledger) ? ledger : ledger.records || [];
  for (const e of entries) {
    const at = Date.parse(e.at || "") || 0;
    if (at < cutoff) continue;
    out.push(fromLedgerEntry(e));
  }

  const kept = [];
  for (const tr of out) {
    if (!tr.parentEventSlug || seen.has(tr.parentEventSlug)) continue;
    const cls = TRIGGERS[tr.eventType];
    if (!cls) continue;
    // The confirmation wall. Deaths (and every confirmedOnly class) expand ONLY when the parent is
    // CONFIRMED — an unconfirmed death ripple is a hoax amplifier, the exact thing we never build.
    if (cls.confirmedOnly && tr.status !== "CONFIRMED") continue;
    if (tr.via === "queue" && !tr.publishable) continue;
    if (!(await isFamous(tr, { searchPersonImpl }))) continue;
    tr.sensitivity = cls.sensitivity === "high" ? "high" : tr.sensitivity;
    tr.allowedForms = cls.forms;
    seen.add(tr.parentEventSlug);
    kept.push(tr);
  }

  // Biggest ripples first; ledger entries (already-published parents) beat queue candidates at
  // equal priority because the parent story is live to link to.
  kept.sort((a, b) =>
    (b.priority || 0) - (a.priority || 0) ||
    (a.via === "ledger" ? 0 : 1) - (b.via === "ledger" ? 0 : 1));
  return kept.slice(0, max);
}
