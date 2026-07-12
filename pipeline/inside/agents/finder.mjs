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
ENTERTAINMENT ONLY — HARD RULE: this is a Hollywood / film / TV / music / celebrity-culture desk. REJECT
(do not pick) any subject who is a POLITICIAN, government/royal figure, ATHLETE/sports story, business/
tech figure, activist, or general-news/crime/weather subject — NO MATTER HOW POPULAR OR HOW HIGH THE BUZZ.
A viral politician or a trending sports moment is NOT for us. Only pick genuine entertainment figures and
their work.
REACTIONS ONLY, TOPIC-AGNOSTIC — THE CORE OF THIS DESK: we cover HOW PEOPLE ARE REACTING to a real event,
never editorial content. REJECT (do not pick): a REVIEW or critic's verdict, a RANKING / "best…" / listicle,
an EXPLAINER / "who is…" / "what to know", a RECAP / "ending explained", a "how/where to watch" GUIDE, an
awards PREDICTION, or a pure plot/news summary. Pick ONLY a real EVENT or MOMENT people are visibly reacting
to — a death, casting, trailer, win, wedding, split, feud, statement, controversy, comeback, surprise. The
TOPIC never disqualifies it: an in-niche death, wedding, or birthday people are reacting to IS for us. What
disqualifies: it's out of niche, it's an editorial content-type above, or there is no real audience reaction
to quote.
MAINSTREAM HOLLYWOOD FIRST: prefer film/TV/celebrity/music stories with broad AUDIENCE buzz (the buzz
badges show it: X posts @100+ likes, search-trend, wiki-spike). Anime/gaming-adjacent topics only when
their audience signal is overwhelming. Order by real popularity (100+-like posts), not coverage volume.
Skip stories with no genuine discourse angle. Output STRICT JSON only.`;

// Deterministic backstop for the REACTIONS-ONLY rule (the cheap finder-LLM sometimes still picks a
// "what to watch" guide or a review). Drops obvious NON-REACTION editorial headlines before ranking:
// reviews (but NOT review-bombing — that IS a reaction), listicles/rankings, explainers, recaps, guides,
// predictions. A real EVENT people react to (death/casting/trailer/win/wedding/feud) is never matched here.
const NON_REACTION_RX = /\b(reviewed|ranking|ranked|top \d+|best (movies|shows|films|series)|what to watch|where to watch|how to watch|streaming guide|ending explained|explainer|recap|predictions?|watch this weekend|things? to know|everything (we know|to know))\b/i;
export function isNonReactionHeadline(text) {
  const t = text || "";
  if (/\breview\b/i.test(t) && !/review[-\s]?bomb/i.test(t)) return true; // a critic's-verdict review, not review-bombing
  return NON_REACTION_RX.test(t);
}

// story (trigger-shaped, engine-compatible) + angle (form pick) per publishable story.
export async function findStories({ limit = 6, discoverImpl = discoverStories, chatImpl = null, nowMs = null } = {}) {
  const stories = (await discoverImpl({ nowMs })).filter((s) => !isNonReactionHeadline(`${s.headline || ""} ${s.primaryEntity || ""}`));
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
