// AGENT 1 — FINDER. Its one job: find the top stories worth covering RIGHT NOW and pick the best
// form for each. Discovery itself is the proven deterministic engine (TMDB trending + Reddit heat);
// the LLM does ONE cheap batched classify over the whole story list (nova-micro, temp 0.2) — the
// highest-call-count role gets the cheapest model, because every pick is re-verified downstream.
import { discoverStories } from "../discover.mjs";
import { agentChat } from "../models.mjs";
import { FORMS } from "../config.inside.mjs";

const ALLOWED = {
  work: ["audience-reaction", "the-debate", "creator-answers-critics"],
  person: ["breakout-buzz", "the-debate"],
  discourse: ["the-debate", "audience-reaction"],
  // A trending news TOPIC (casting shock, star's claim, controversy) can take any discourse shape.
  headline: ["audience-reaction", "the-debate", "creator-answers-critics", "breakout-buzz"],
};

const SYS = `You are the story editor of an AUDIENCE-REACTION & DISCOURSE desk (how normal people react to /
argue about movies, TV and music; how creators answer critics — never gossip/speculation, never invented
debates). For EACH numbered story, pick the ONE best form from its allowed list, a working headline
(honest, curiosity without clickbait), the focus entity, and 2 SIMPLE search queries (2-5 plain words).
MAINSTREAM HOLLYWOOD FIRST: prefer film/TV/celebrity/music stories with broad AUDIENCE buzz (the buzz
badges show it: search-trend, wiki-spike, comments). Anime/gaming-adjacent topics only when their
audience signal is overwhelming. Order by buzz strength, not by coverage volume.
Skip stories with no genuine discourse angle. Output STRICT JSON only.`;

// story (trigger-shaped, engine-compatible) + angle (form pick) per publishable story.
export async function findStories({ limit = 6, discoverImpl = discoverStories, chatImpl = null, nowMs = null } = {}) {
  const stories = await discoverImpl({ nowMs });
  if (!stories.length) return [];

  const buzzOf = (s) => [
    s.signals?.audiencePosts ? `${s.signals.audiencePosts} audience posts${s.signals.audienceEngagement ? ` (${s.signals.audienceEngagement.toLocaleString()} likes)` : ""}` : "",
    s.signals?.trend ? `search-trend${s.signals.trend > 1 ? ` ${s.signals.trend.toLocaleString()}` : ""}` : "",
    s.signals?.wiki ? `wiki-spike ${Math.round(s.signals.wiki / 1000)}k views` : "",
    s.signals?.comments ? `${s.signals.comments} comments` : "",
    s.signals?.outlets ? `${s.signals.outlets} outlets` : "",
    s.signals?.animeAdjacent ? "ANIME-ADJACENT (demoted)" : "",
  ].filter(Boolean).join(" + ") || "weak";
  const listing = stories.map((s, i) =>
    `${i}. [${s.kind}] ${s.headline || s.primaryEntity}${s.work ? ` — the ${s.work.type} "${s.work.title}"` : ""} | heat ${s.discourseHeat} | buzz: ${buzzOf(s)} | threads: ${(s.redditPosts || []).slice(0, 3).map((p) => p.title.slice(0, 60)).join(" · ") || "none captured"} | allowed: ${(ALLOWED[s.kind] || ALLOWED.work).join(", ")}`).join("\n");

  // The classify gets its OWN deadline well inside the orchestrator watchdog, so a hung provider
  // call degrades to the deterministic fallback instead of killing the whole run.
  const deadline = (p, ms) => Promise.race([p, new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(`classify deadline ${ms / 1e3}s`)), ms); t.unref?.(); })]);
  let picks = [];
  try {
    const { data } = await deadline(agentChat("finder", {
      system: SYS,
      user: `STORIES:\n${listing}\n\nJSON: {"picks":[{"i":0,"form":"","workingTitle":"","focusEntity":"","angle":"one line: the specific discourse","searchQueries":["",""]}]}\nOnly include stories worth covering. Order by strength.`,
    }, chatImpl ? { chatImpl } : {}), 60e3);
    picks = data?.picks || [];
  } catch {
    // Finder LLM down → deterministic fallback: flagship form per kind, entity-based queries.
    picks = stories.slice(0, limit).map((s, i) => ({
      i, form: (ALLOWED[s.kind] || ALLOWED.work)[0],
      workingTitle: `${s.primaryEntity}: what people are saying`,
      focusEntity: s.primaryEntity, angle: "audience discourse", searchQueries: [],
    }));
  }

  const out = [];
  for (const p of picks) {
    const s = stories[p.i];
    if (!s || !p.form || !FORMS[p.form]) continue;
    if (!(ALLOWED[s.kind] || ALLOWED.work).includes(p.form)) continue; // form clamp — never trust the enum
    out.push({
      story: { // trigger-shaped: the engine modules (harvest/assemble) consume this unchanged
        parentEventSlug: s.storySlug,
        parentSlug: null,
        parentTitle: s.headline || s.work?.title || s.primaryEntity,
        primaryEntity: s.primaryEntity,
        entities: s.work?.title && s.work.title !== s.primaryEntity ? [s.work.title] : [],
        eventType: "discourse",
        sensitivity: "normal",
        category: s.category,
        priority: s.discourseHeat,
        signals: s.signals || {},
        outletCount: (s.sources || []).length,
        status: "CONFIRMED",
        sources: s.sources || [],
        tmdbType: s.work?.type || "movie",
        subjectKind: s.kind === "person" || !s.work ? "person" : "title",
        via: s.via,
        redditPosts: s.redditPosts || [],
        work: s.work || null,
        overview: s.overview || "",
        headline: s.headline || null,
      },
      angle: {
        form: p.form,
        angle: (p.angle || "audience discourse").slice(0, 200),
        workingTitle: p.workingTitle || `${s.primaryEntity}: what people are saying`,
        focusEntity: p.focusEntity || s.primaryEntity,
        searchQueries: (Array.isArray(p.searchQueries) ? p.searchQueries : []).filter(Boolean).slice(0, 3),
        key: p.form,
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}
