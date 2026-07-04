// LOADER (REV 2) — turns discovered discourse stories into the objects the orchestrator consumes.
// No confirmed-event gate, no eventType/form map, no fame lookup: the discourse itself is the trigger
// (discover.mjs already required real discussion). Facts are locked later; the story is real by
// construction (a trending work + people arguing about it).
import { discoverStories } from "./discover.mjs";

export async function loadTriggers({ discoverImpl = discoverStories, max = 0, nowMs = null } = {}) {
  const stories = await discoverImpl({ nowMs, ...(max ? { max } : {}) });
  return stories.map((s) => ({
    parentEventSlug: s.storySlug,        // stable dedup key (event×form)
    parentSlug: null,                    // originated from discovery, not a parent news article
    parentTitle: s.work?.title || s.primaryEntity,
    primaryEntity: s.primaryEntity,
    entities: s.work?.title && s.work.title !== s.primaryEntity ? [s.work.title] : [],
    eventType: "discourse",
    sensitivity: "normal",
    category: s.category,
    priority: s.discourseHeat,
    signals: s.signals || {},
    outletCount: (s.sources || []).length,
    status: "CONFIRMED",                 // facts are locked+verified; the discourse is real
    sources: s.sources || [],
    tmdbType: s.work?.type || "movie",
    subjectKind: s.kind === "person" || !s.work ? "person" : "title",
    via: s.via,
    // REV 2 discourse payload the harvest anchors on:
    redditPosts: s.redditPosts || [],
    work: s.work || null,
    overview: s.overview || "",
  }));
}
