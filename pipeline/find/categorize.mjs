// Stages 2 + 2.5 + 5 (Relevance → Categorize → Angle) for FIND v2, one cheap-LLM pass that turns a
// raw discovery (RSS headline OR TMDB item) into a MAKE-ready topic object — or rejects it.
//
// v2 CHANGES vs v1 (per FIND_HALF_PLAN "What changes vs the v1 engine"):
//  1. ENTITY-RESOLVE, not event-validate. We resolve the PERSON/FILM/SHOW identity against Wikipedia
//     (true even for a 10-min-old story — the entity has a page; the event does not yet). We NEVER ask
//     Wikipedia whether the EVENT is true — a fresh story is no longer dropped just for being fresh.
//  2. Handles RSS news items (title + summary, no tmdbId) as the primary input, TMDB items as backbone.
//  3. STRICTER relevance: hard-drop video games, anime/manga chapters, K-drama/regional cinema, sports,
//     music-only, comics-only — the noise the live RSS feeds carry.
//  4. Emits eventSlug + eventType + sensitivity so the new verify.mjs can corroborate across outlets and
//     apply the death/high-stakes CONFIRMING-hold policy.
import { chat } from "../lib/openrouter.mjs";
import { MODELS, TAXONOMY } from "../config.mjs";
import { wikiSummary } from "../lib/wikipedia.mjs";

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

// Force category+subcategory onto the REAL taxonomy (the LLM sometimes invents one, e.g. "tv/animation").
// Mirrors classify.mjs's niche-snapping so FIND and MAKE agree on the URL silo.
export function canonicalize(t) {
  let cat = t.category, sub = t.subcategory;
  const ft = t.formatTag;
  if (ft === "review") { cat = "reviews"; sub = t.tmdbType === "tv" ? "tv-reviews" : "movie-reviews"; }
  else if (ft === "awards") { cat = "awards"; if (!TAXONOMY.awards.includes(sub)) sub = "winners"; }
  else if (ft === "box-office") { cat = "movies"; sub = "box-office"; }
  else if (ft === "interview") { cat = "celebrity"; sub = "interviews"; }
  else if (ft === "profile") { cat = "celebrity"; sub = "profiles-careers"; }
  else if (ft === "explainer") { cat = "movies"; sub = "explainers"; }
  else if (ft === "guide") { cat = "streaming"; if (!TAXONOMY.streaming.includes(sub)) sub = "best-of-streaming"; }
  else if (ft === "trailer") { if (!["movies", "tv"].includes(cat)) cat = "movies"; sub = "trailers"; }
  else if (ft === "reaction") { if (!["movies", "tv"].includes(cat)) cat = "movies"; sub = "reactions"; }
  else if (ft === "list") { if (!["movies", "tv"].includes(cat)) cat = "movies"; sub = "rankings-lists"; }
  else if (ft === "news") { if (!["movies", "tv", "celebrity"].includes(cat)) cat = "celebrity"; sub = "news"; }
  else if (ft === "watchguide") { cat = "streaming"; sub = "where-to-watch"; }
  else if (ft === "recap") { cat = "reviews"; sub = "tv-reviews"; }
  else if (ft === "predictions") { cat = "awards"; sub = "predictions"; }
  else if (ft === "music-news") { cat = "music"; sub = "news"; }
  else if (ft === "music-awards") { cat = "music"; sub = "awards"; }
  else if (ft === "music-profile") { cat = "music"; sub = "profiles-artists"; }
  else if (ft === "screen-music") { cat = "music"; sub = "screen-music"; }
  if (!TAXONOMY[cat]) cat = "celebrity";
  if (!TAXONOMY[cat].includes(sub)) sub = TAXONOMY[cat][0];
  t.category = cat;
  t.subcategory = sub;
  // Music carries a pop/indie LANE tier (the 6%/4% allocation axis). Default popular; the breakout
  // detector (Commit 2) promotes genuine indie breakouts to "indie".
  if (cat === "music" && !t.tier) t.tier = "popular";
  return t;
}

const SYS = `You are the news editor of The Screen Report, an English-language Hollywood (and Western English-language) film, TV, streaming, and celebrity NEWS site. For each candidate decide:
(1) RELEVANT? — keep ONLY a story whose SUBJECT is: an English-language film, TV show, or streaming title; a film/TV/music ENTERTAINER's career or personal life; OR on-brand MUSIC — a popular/trending music event (tour/album/single/label deal), a music awards show (Grammys/AMAs/VMAs/CMAs), an indie/underground track or artist that UNEXPECTEDLY broke out (a real virality/chart spike), or music-meets-screen (a soundtrack/score/music biopic/needle-drop). K-pop/Latin/non-English music ONLY when there is a SCREEN tie or A-list-Hollywood hook.
    HARD-DROP (relevant=false), no matter which feed it came from, anything primarily about:
    • POLITICS — elections, voting, parties, candidates, partisan opinion, a late-night/talk-show host's political take (e.g. "who someone will vote for", "JD Vance", "Real Time" political segments). A person being on TV does NOT make their politics entertainment news.
    • NEWS JOURNALISTS / anchors / their legal or industry disputes (e.g. a Fox/CBS reporter's court case) — they are not film/TV/music entertainers.
    • video games / gaming hardware (Xbox, PlayStation, Game Pass, Elden Ring, gameplay, "officially releases").
    • anime or manga (One Piece chapter, episode-number releases, shonen), comics-only releases.
    • K-drama or non-English/regional cinema (unless a major Hollywood/Netflix-English production); MUSIC-INDUSTRY TRADE MINUTIAE (chart-methodology, label finance, royalty/business-legal filings, setlist/gig-listing trivia, pure local-scene reporting with NO breakout and NO screen/A-list hook); non-English regional music with no Hollywood/screen hook; sports, crypto/tech, deals/coupons/merch.
(2) The single best ANGLE/niche to cover it RIGHT NOW, exactly as a real editor would.
You output STRICT JSON only. Be CONSERVATIVE: when a candidate is off-topic OR primarily political, set relevant=false with a one-word reason.`;

const NICHE_GUIDE = `Pick ONE formatTag + its category/subcategory:
- "news" → movies|tv|celebrity / "news": a development/announcement/casting/scandal/health/legal story (the safe default for a breaking item).
- "review" → reviews / movie-reviews|tv-reviews: a RELEASED film/show worth a critical verdict.
- "box-office" → movies / box-office: a film whose box-office result/record is the story.
- "trailer" → movies|tv / trailers: an UPCOMING title whose new trailer just dropped.
- "profile" → celebrity / profiles-careers: a trending PERSON → their movies & career.
- "explainer" → movies / explainers: a film with a confusing ending/twist people search to understand.
- "guide" → streaming / best-of-streaming|where-to-watch.
- "list" → movies|tv / rankings-lists: a "best ... ranked" angle.
- "interview" → celebrity / interviews: a notable recent interview.
- "reaction" → movies|tv / reactions: fan/critic reaction to a release.
- "awards" → awards / winners: a music/film/TV ceremony's WINNERS or recap.
- "watchguide" → streaming / where-to-watch: a SINGLE title — where/when to stream/rent/buy it (not a best-of list).
- "recap" → reviews / tv-reviews: a per-EPISODE recap of a show that just aired (spoilers-on), distinct from a season review.
- "predictions" → awards / predictions: a who-will-win race-analysis ahead of a ceremony (Oscars/Emmys/Grammys).
- "music-news" → music / news: a popular/trending music event (tour, album/single drop, label/streaming deal, a pop star's music move).
- "music-awards" → music / awards: a music ceremony (Grammys/AMAs/VMAs/CMAs) — winners or predictions.
- "music-profile" → music / profiles-artists: a trending OR newly-broken-out musician → their career. (Set this for an indie/underground breakout artist too.)
- "screen-music" → music / screen-music: a soundtrack, film/TV score, music biopic/doc, or "song from [show]" needle-drop (music-meets-screen — our lane).
Prefer "news" when unsure. PERSON candidate → "profile" or "news". Now-playing/high-revenue movie → "box-office" or "review". Upcoming movie with new footage → "trailer".
HARD RULE: NEVER pick "review" or "box-office" for an UNRELEASED film (release date in the future / "unreleased" in the hint) — you cannot review or report box office for a film that has not opened. Use "trailer" or a "news" preview instead. Honor any [SUGGESTED NICHE] hint unless the summary clearly points elsewhere.`;

// Output contract for each candidate the model judges relevant.
const SCHEMA = `Return JSON: {"items":[{
 "i": <index>,
 "relevant": true|false,
 "reason": "short why-keep-or-drop",
 "formatTag": "news|review|box-office|trailer|profile|explainer|guide|list|interview|reaction|awards|watchguide|recap|predictions|music-news|music-awards|music-profile|screen-music",
 "category": "movies|tv|streaming|celebrity|reviews|awards|music",
 "subcategory": "the matching subcategory",
 "musicTier": "popular|indie — set ONLY for a music item: 'indie' if it's an under-the-radar/underground artist or track that UNEXPECTEDLY broke out; 'popular' for an established/trending mainstream act. Omit for non-music.",
 "eventType": "death|health|legal|arrest|lawsuit|marriage|divorce|breakup|pregnancy|birth|casting|trailer|boxoffice|review|award|renewal|cancellation|announcement|other",
 "sensitivity": "high|normal",   // high ONLY for death/health-crisis/legal/arrest — these need extra source confirmation
 "eventSlug": "outlet-agnostic kebab slug of the underlying EVENT so two outlets reporting the same story collide, e.g. 'pedro-pascal-fantastic-four-reshoots'",
 "primaryKeyword": "the real search query a fan would type, e.g. 'superman trailer' or 'zendaya movies'",
 "primaryEntity": "the EXACT English Wikipedia article title of the most-established PERSON / FILM / SHOW central to the story (the one CERTAIN to have a Wikipedia page) incl. disambiguator, e.g. 'Pedro Pascal' or 'Superman (2025 film)'. This is the ENTITY, never the event.",
 "entities": ["2-4 supporting exact Wikipedia titles (director, lead cast, related film/show)"],
 "angle": "one-line TRUE angle",
 "title": "a working headline"
}]}
Only include RELEVANT items. primaryEntity MUST be a real, unambiguous Wikipedia page (pick the most famous anchor entity, not the brand-new thing that may have no page yet).`;

export async function categorize(candidates, monitor, { model = MODELS.classifier, batch = 8 } = {}) {
  const topics = [];
  let dropped = 0;
  for (let i = 0; i < candidates.length; i += batch) {
    const group = candidates.slice(i, i + batch);
    const list = group
      .map((c, j) => {
        const blurb = (c.summary || c.overview || "").slice(0, 200);
        const meta = c.outlet ? `via ${c.outlet}${c.ageMin != null ? `, ${c.ageMin}m ago` : ""}` : `${c.year || "?"}, ${c.mediaType}${c.voteCount ? `, votes=${c.voteCount}` : ""}`;
        const hint = c.nicheHint ? ` [SUGGESTED NICHE: ${c.nicheHint}]` : "";
        return `${j}. [${c.kind}] "${c.title}" (${meta})${blurb ? ` — ${blurb}` : ""}${hint}`;
      })
      .join("\n");
    const user = `${NICHE_GUIDE}\n\nCANDIDATES:\n${list}\n\n${SCHEMA}`;

    let data;
    try {
      ({ data } = await chat({ model, system: SYS, user, json: true, maxTokens: 2200, temperature: 0.2 }));
    } catch {
      data = null;
    }
    for (const it of data?.items || []) {
      const c = group[it.i];
      if (!c) continue;
      if (!it.relevant || !it.primaryEntity || !it.formatTag) {
        dropped++;
        continue;
      }
      topics.push(canonicalize({
        id: `${it.formatTag}-${slugify(it.eventSlug || c.title)}`.replace(/-+$/, "").slice(0, 80),
        slug: slugify(it.title || c.title),
        title: it.title || c.title,
        contentType: it.formatTag,
        formatTag: it.formatTag,
        category: it.category,
        subcategory: it.subcategory,
        eventType: it.eventType || "other",
        sensitivity: it.sensitivity === "high" ? "high" : "normal",
        tier: it.musicTier === "indie" ? "indie" : it.musicTier === "popular" ? "popular" : undefined,
        eventSlug: slugify(it.eventSlug || it.primaryEntity),
        primaryKeyword: it.primaryKeyword,
        primaryEntity: it.primaryEntity,
        entities: Array.isArray(it.entities) ? it.entities.filter(Boolean).slice(0, 4) : [],
        angle: it.angle,
        tmdbType: c.mediaType === "tv" ? "tv" : "movie",
        // v2: carry the discovery provenance so verify.mjs can corroborate + score can rank by freshness.
        source: c.source,
        sources: c.outlet ? [{ outlet: c.outlet, tier: c.sourceTier || 5, ageMin: c.ageMin ?? null, headline: c.title, summary: (c.summary || "").slice(0, 600) }] : [],
        ageMin: c.ageMin ?? null,
        _cand: { key: c.key, popularity: c.popularity || 0, voteCount: c.voteCount, kind: c.kind },
      }));
    }
  }
  monitor.stage("categorize", `${candidates.length} candidates → ${topics.length} relevant (${candidates.length - topics.length} dropped: off-topic/political/incomplete)`);

  // ENTITY RESOLUTION (v2: resolve the IDENTITY, never the event). Try the model's primaryEntity, then a
  // couple of disambiguator repairs, then fall back to the first supporting entity that resolves. Keep the
  // topic if ANY anchor entity resolves (so breaking news survives); drop only if NOTHING resolves (= no
  // grounding at all → hallucination risk).
  const resolved = [];
  for (const t of topics) {
    const anchor = await resolveEntity(t);
    if (anchor) {
      if (anchor.viaPrimary) {
        // the actual subject resolved → canonicalize the grounding title to the real page
        if (anchor.summary.title !== t.primaryEntity && !t.entities.includes(t.primaryEntity)) t.entities.unshift(t.primaryEntity);
        t.primaryEntity = anchor.summary.title;
      } else {
        // resolved ONLY via a supporting entity — KEEP the real subject as primaryEntity (don't retarget
        // onto a co-star); the supporting entity just provides extra grounding.
        if (!t.entities.includes(anchor.summary.title)) t.entities.unshift(anchor.summary.title);
      }
      t.entities = [...new Set(t.entities.filter((e) => e !== t.primaryEntity))].slice(0, 4);
      resolved.push(t);
    } else {
      monitor.stage("resolve", `dropped "${t.primaryEntity}" — no Wikipedia identity for primary OR supporting entities`);
    }
  }
  monitor.count("relevant", topics.length);
  monitor.count("entityResolved", resolved.length);
  monitor.stage("resolve", `${resolved.length}/${topics.length} topics have a resolved Wikipedia entity (identity, not event)`);
  return resolved;
}

// Niches that are ABOUT a specific released/aired film or show — for these the FILM ITSELF must be
// Wikipedia-notable (its own page that is genuinely about a screen work). This is the principled
// notability + identity gate: it drops obscure/fan TMDB entries AND wrong-entity resolutions
// (e.g. a "Minions & Monsters" with no real page, or a same-named different film).
const FILM_NICHES = new Set(["review", "box-office", "explainer", "trailer"]);

// A resolved Wikipedia page that is actually about a film/TV work (not a person, place, or unrelated topic).
function looksLikeScreenWork(s) {
  const hay = `${s.type || ""} ${(s.extract || "").slice(0, 400)}`.toLowerCase();
  return /\b(film|movie|miniseries|series|television|sitcom|documentary|anime|animated|show)\b/.test(hay);
}

// Resolve an anchor entity for a topic. For FILM_NICHES: ONLY the film itself (with disambiguator
// repairs), and it must read as a screen work — NO falling back to the franchise/supporting entity.
// For other niches (news/profile/list): the looser fallback keeps fresh news alive.
async function resolveEntity(t) {
  const strict = FILM_NICHES.has(t.formatTag);
  const bare = t.primaryEntity.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const yr = (t.title.match(/\b(19|20)\d{2}\b/) || [])[0];
  const primaryTries = [t.primaryEntity, bare, yr ? `${bare} (${yr} film)` : null, yr ? `${bare} (${yr} TV series)` : null].filter(Boolean);
  // 1) try the PRIMARY entity (the actual subject) first → resolving here is a true canonicalize.
  for (const v of [...new Set(primaryTries)]) {
    const s = await wikiSummary(v);
    if (s?.extract && (!strict || looksLikeScreenWork(s))) return { summary: s, viaPrimary: true };
    await new Promise((r) => setTimeout(r, 80));
  }
  // 2) for non-film niches, a SUPPORTING entity resolving keeps the topic alive for grounding — but we
  //    must NOT retarget the article onto it (it may be a famous co-star, not the real subject).
  if (!strict) {
    for (const v of [...new Set((t.entities || []).filter(Boolean))]) {
      const s = await wikiSummary(v);
      if (s?.extract) return { summary: s, viaPrimary: false };
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  return null;
}
