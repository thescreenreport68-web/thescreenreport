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
import { resolveEntity } from "../lib/resolveEntity.mjs";

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

// NEWS-ONLY: the automation publishes ONLY these 8 trending-news forms; everything else is a separate
// future automation. This is the SINGLE SOURCE OF TRUTH — imported by the MAKE path (run.mjs/classify.mjs)
// and the inside-stories expander so the news-only invariant is enforced in CODE (fail-closed), not just
// by the categorizer prompt.
export const NEWS_FORMS = ["news", "box-office", "trailer", "reaction", "watchguide", "awards", "music-news", "music-awards"];

// Force category+subcategory onto the REAL taxonomy (the LLM sometimes invents one, e.g. "tv/animation").
// Mirrors classify.mjs's niche-snapping so FIND and MAKE agree on the URL silo.
export function canonicalize(t) {
  let cat = t.category, sub = t.subcategory;
  // Defensive category/subcategory repair only — the drop gate below already rejects a non-news formatTag
  // BEFORE canonicalize, so a stray tag here is coerced to "news" purely as a belt-and-suspenders net.
  let ft = t.formatTag;
  if (!NEWS_FORMS.includes(ft)) ft = t.formatTag = "news";
  if (ft === "awards") { cat = "awards"; if (!TAXONOMY.awards.includes(sub)) sub = "winners"; }
  else if (ft === "box-office") { cat = "movies"; sub = "box-office"; }
  else if (ft === "trailer") { if (!["movies", "tv"].includes(cat)) cat = "movies"; sub = "trailers"; }
  else if (ft === "reaction") { if (!["movies", "tv"].includes(cat)) cat = "movies"; sub = "reactions"; }
  else if (ft === "watchguide") { cat = "streaming"; sub = "where-to-watch"; }
  else if (ft === "music-news") { cat = "music"; sub = "news"; }
  else if (ft === "music-awards") { cat = "music"; sub = "awards"; }
  else { ft = t.formatTag = "news"; if (!["movies", "tv", "celebrity"].includes(cat)) cat = "celebrity"; sub = "news"; }
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
    ⚠ FORM RULE — this automation posts TRENDING NEWS EVENTS ONLY. Also set relevant=false for anything that is a REVIEW (a critical verdict, ours or a critic's), an INTERVIEW write-up, a RANKING / "best … of all time" / listicle, a celebrity PROFILE or career retrospective, an ending/lore EXPLAINER, an episode RECAP, an awards PREDICTION (a who-will-win forecast — award RESULTS are fine), a "how to watch all the X movies" binge GUIDE, or any opinion / theory / speculation piece. Those are NOT news events and belong to SEPARATE automations. Keep ONLY a real news EVENT (casting, deal, death, box-office RESULT, trailer drop, award RESULT, music announcement, scandal, legal/health news).
(2) The single best ANGLE/niche to cover it RIGHT NOW, exactly as a real editor would.
You output STRICT JSON only. Be CONSERVATIVE: when a candidate is off-topic OR primarily political, set relevant=false with a one-word reason.`;

const NICHE_GUIDE = `This automation posts ONLY hardcore trending NEWS — a real EVENT. Pick ONE formatTag from THESE NEWS FORMS ONLY (there are no others; if the story is not one of these, it is NOT for us — set relevant=false):
- "news" → movies|tv|celebrity / "news": a development/announcement/casting/deal/scandal/health/legal/DEATH story (the default for any breaking item).
  CATEGORY CHOICE for a "news" item — MOVIES-FIRST. File the story in its TRUE home; do NOT lazily default to celebrity:
    • "movies" when the story centers on a FILM — a movie's casting, deal, production, release, or a filmmaker's movie work (e.g. "Zendaya joins Christopher Nolan's The Odyssey" is MOVIES, not celebrity).
    • "tv" when it centers on a TV or streaming SERIES — a show's casting, renewal, cancellation, premiere, or episodes.
    • "celebrity" ONLY for a person's PERSONAL life with no specific screen/music WORK as the subject — a relationship, wedding, family, appearance, feud, or a non-musician's health/legal/death story.
    • If the SUBJECT is a MUSICIAN and the event is a MUSIC event (a musician's death, tour, album/single, label deal, or a music ceremony), pick "music-news"/"music-awards" (category "music") — NEVER "celebrity".
- "box-office" → movies / box-office: a film whose box-office RESULT/record is the story.
- "trailer" → movies|tv / trailers: a title whose NEW TRAILER just dropped (the trailer RELEASE is the news event).
- "reaction" → movies|tv / reactions: a roundup of the public/critic REACTION to a just-released trailer/film/show (the reaction is the news).
- "watchguide" → streaming / where-to-watch: a SINGLE title that JUST hit streaming or got a streaming DATE (the "now streaming" news).
- "awards" → awards / winners: a film/TV ceremony's WINNERS / RESULTS (a real result — NEVER a prediction).
- "music-news" → music / news: a trending music NEWS event (tour announced, album/single dropped, label/streaming deal, a pop star's move).
- "music-awards" → music / awards: a music ceremony's WINNERS / RESULTS (Grammys/AMAs/VMAs/CMAs).
Prefer "news" when unsure. HARD RULE: NEVER pick "box-office" for an UNRELEASED film — use "trailer" or "news". Honor any [SUGGESTED NICHE] hint unless the summary clearly points elsewhere.`;

// Output contract for each candidate the model judges relevant.
const SCHEMA = `Return JSON: {"items":[{
 "i": <index>,
 "relevant": true|false,
 "reason": "short why-keep-or-drop",
 "formatTag": "news|box-office|trailer|reaction|watchguide|awards|music-news|music-awards",
 "category": "movies|tv|streaming|celebrity|awards|music",
 "subcategory": "the matching subcategory",
 "musicTier": "popular|indie — set ONLY for a music item: 'indie' if it's an under-the-radar/underground artist or track that UNEXPECTEDLY broke out; 'popular' for an established/trending mainstream act. Omit for non-music.",
 "eventType": "death|health|legal|arrest|lawsuit|marriage|divorce|breakup|pregnancy|birth|casting|trailer|boxoffice|review|award|renewal|cancellation|announcement|other",
 "sensitivity": "high|normal",   // high ONLY for death/health-crisis/legal/arrest — these need extra source confirmation
 "eventSlug": "outlet-agnostic kebab slug of the underlying EVENT so two outlets reporting the same story collide, e.g. 'pedro-pascal-fantastic-four-reshoots'",
 "primaryKeyword": "the real search query a fan would type, e.g. 'superman trailer' or 'zendaya movies'",
 "primaryEntity": "the EXACT canonical name of the most-established PERSON / FILM / SHOW central to the story (a real, notable entity), with a year disambiguator only if needed, e.g. 'Pedro Pascal' or 'Superman (2025 film)'. This is the ENTITY, never the event.",
 "entities": ["2-4 supporting exact entity names (director, lead cast, related film/show)"],
 "angle": "one-line TRUE angle",
 "title": "a working headline"
}]}
Only include RELEVANT items. primaryEntity MUST be a real, unambiguous, notable PERSON/FILM/SHOW (pick the most famous anchor entity; a brand-new or unreleased title is fine as long as it is a real one).`;

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
      // FAIL-CLOSED on FORM: if the LLM marks a non-news form (review/interview/ranking/profile/etc.),
      // DROP the story — do NOT silently relabel it as news. An explicit non-news formatTag is the LLM
      // telling us this is a review/interview/ranking piece, which belongs to a separate automation.
      if (!it.relevant || !it.primaryEntity || !it.formatTag || !NEWS_FORMS.includes(it.formatTag)) {
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
        // Phase A: the URL is carried so MAKE's content finder extracts the real article body (it was being
        // dropped here, the root cause of the writer fabricating on thin facts); the summary is the inline
        // fallback text the writer grounds on when extraction misses.
        source: c.source,
        sources: c.outlet ? [{ outlet: c.outlet, tier: c.sourceTier || 5, url: c.url || null, ageMin: c.ageMin ?? null, headline: c.title, summary: (c.summary || "").slice(0, 600) }] : [],
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
// Entity resolution + notability now live in lib/resolveEntity.mjs (TMDB/Deezer, NON-Wikipedia — confirms
// identity AND a notability magnitude, and tracks unreleased/fresh films Wikipedia hadn't covered yet).
