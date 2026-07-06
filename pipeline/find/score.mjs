// Stages 4 + 6 (v2) — DEMAND + PRIORITY ranking on FREE signals only. v1 sorted by TMDB popularity,
// which is broken for breaking news (RSS items have popularity 0 and would sort last). v2 ranks by:
//   recency (the breaking clock) + cross-source corroboration + verification trust + event-type weight.
// This is the free-stack approximation of MASTER_PLAN App-S (demand) + App-N (priority); the GDELT-NGram
// velocity + Wikipedia-pageview spike signals slot in here later (they only raise accuracy, not shape).

// App-S Signal D — article-type weight. REALIGNED MOVIES-FIRST (owner 2026-07-06): the mandate is big trending
// Hollywood — movies/box-office FIRST (~80/20). The old table was engagement-first (death/scandal/marriage on top,
// box-office/trailer only mid) — which is why soft celebrity personal-life items kept out-ranking the tentpole film
// news the site is supposed to lead with. Now the BIG FILM/TV forms lead; a major death/scandal is still real news
// (kept high) but no longer ABOVE the tentpole film forms; soft celebrity personal-life is demoted to the ~20% side;
// industry inside-baseball stays lowest.
const TYPE_WEIGHT = {
  // BIG FILM/TV NEWS — leads.
  boxoffice: 1.0, trailer: 1.0, casting: 0.92, award: 0.9, breakout: 0.72, reaction: 0.72,
  cancellation: 0.7, announcement: 0.62, renewal: 0.6, review: 0.58,
  // MAJOR human-interest — still real news, just not above the tentpole film forms.
  death: 0.9, arrest: 0.85, scandal: 0.8, health: 0.8, legal: 0.8, lawsuit: 0.8,
  // SOFT celebrity personal-life — the ~20% side, demoted below film news.
  divorce: 0.55, breakup: 0.5, marriage: 0.5, pregnancy: 0.48, birth: 0.42, interview: 0.45, other: 0.35,
  // industry inside-baseball — lowest (unchanged).
  festival: 0.3, industry: 0.3, panel: 0.28, dealmaking: 0.28, financing: 0.28, promo: 0.3, market: 0.3,
};
// REALITY / COMPETITION-TV demotion (owner 2026-07-06): a reality-show casting/announcement is NOT marquee scripted
// film/TV news — but it lands category=tv, so isFilmTV() wrongly gave it the big-Hollywood bonus (Love Island tied a
// $400M box-office story at the top). Demote these out of the big tier so real movie/TV news leads.
// (audit 2026-07-06) Tested against primaryEntity ONLY (not the title) so a SCRIPTED/movie story that merely NAMES a
// reality show ("Big Brother Alum Joins A24 Drama") is NOT demoted — only stories whose SUBJECT is the reality show
// are. Collision-prone names that are also real film/scripted titles (survivor, big brother, the traitors, the voice)
// are excluded to avoid demoting a legit movie that shares the name.
const SOFT_TV = /\b(love island|summer house|the bachelor(ette)?|the kardashians|keeping up with|real housewives|below deck|vanderpump|american idol|dancing with the stars|90 day fianc|teen mom|jersey shore|selling sunset|rupaul|love is blind|married at first sight)\b/i;
const STATUS_WEIGHT = { CONFIRMED: 25, DEVELOPING: 18, EVERGREEN: 14, RUMOR: 8, QUEUE: 4, CONFIRMING: 3, "EDITORIAL-HOLD": 1 };

function recencyPts(ageMin) {
  if (ageMin == null) return 7; // TMDB-backbone / evergreen: a flat baseline, not "old"
  if (ageMin <= 15) return 30;
  if (ageMin <= 60) return 24;
  if (ageMin <= 180) return 16;
  if (ageMin <= 360) return 9;
  if (ageMin <= 720) return 4;
  return 1;
}

function corroborationPts(t) {
  const sources = t.sources || [];
  const maxTier = sources.reduce((m, s) => Math.max(m, s.tier || 0), 0);
  const distinct = sources.length;
  // more independent outlets + a higher top-tier = stronger signal (cap ~25)
  return Math.min(25, distinct * 6 + Math.max(0, maxTier - 4) * 2);
}

// BIG TRENDING HOLLYWOOD (owner 2026-07-03): focus ~70% on the film/TV stories every outlet is covering — a big
// trailer drop (the Odyssey!), a box-office result, a movie's audience reaction, a major casting/award — and less
// on celebrity fashion/wedding-look color. These film/TV production forms get a boost so they out-rank a same-hour
// celebrity-fashion piece; and a story carried by MULTIPLE top outlets is, by definition, "what's trending".
const BIG_FILMTV_FORM = new Set(["boxoffice", "trailer", "reaction", "casting", "award", "renewal", "cancellation", "review", "announcement"]);
const isFilmTV = (t) => ["movies", "tv", "streaming"].includes((t.category || "").toLowerCase());
const outletCount = (t) => t.verification?.outletCount || (t.sources ? new Set((t.sources || []).map((s) => s.outlet)).size : 1) || 1;

export function scoreTopics(topics, monitor) {
  for (const t of topics) {
    const rec = recencyPts(t.ageMin);
    const corr = corroborationPts(t);
    const statusW = STATUS_WEIGHT[t.verification?.status] ?? 5;
    const typeW = (TYPE_WEIGHT[t.eventType] ?? 0.4) * 15;
    const popNudge = Math.min(6, Math.log10(1 + (t._cand?.popularity || 0)) * 2); // mild TMDB-backbone tilt
    const breakoutPts = Math.min(10, (t.breakoutVelocity || 0) / 4); // an accelerating indie breakout ranks up
    // BIG-HOLLYWOOD boost: a film/TV story gets +8; a marquee film/TV form (trailer/box-office/reaction/casting/
    // award) gets a further +10 — so a big movie trailer beats a fresher celebrity-fashion piece on the same feed.
    // reality/competition-TV lands category=tv, so isFilmTV would wrongly hand it the big-Hollywood bonus (Love Island
    // tied a $400M box-office story). Treat it as NOT big (FORFEIT the film/TV bonus) AND apply a small penalty so
    // routine reality casting/announcements fall below the newsworthiness floor; a genuinely huge reality story still
    // clears on its own recency + a scandal/death eventType.
    const isSoftTv = SOFT_TV.test(t.primaryEntity || ""); // primaryEntity only (audit 2026-07-06) — don't demote a scripted story that merely names a reality show
    const bigBonus = isSoftTv ? 0 : (
      (isFilmTV(t) ? 6 : 0)
      + (isFilmTV(t) && BIG_FILMTV_FORM.has(t.eventType) ? 12 : 0)
      + ((t.category || "").toLowerCase() === "movies" ? 6 : 0)); // movies-first tilt (owner 2026-07-06)
    // TRENDING = many top outlets carrying it. Each extra top outlet beyond the first adds up to +15 (cap): the
    // Odyssey trailer, covered by Variety+THR+Deadline, out-ranks a one-outlet wedding-look item.
    const trendingBonus = Math.min(15, Math.max(0, outletCount(t) - 1) * 8);
    const softTvPenalty = isSoftTv ? 12 : 0;
    const priority = Math.round(rec + corr + statusW + typeW + popNudge + breakoutPts + bigBonus + trendingBonus - softTvPenalty);
    t.priority = priority;
    t.signals = { recency: rec, corroboration: corr, status: statusW, type: Math.round(typeW), pop: Math.round(popNudge), breakout: Math.round(breakoutPts), big: bigBonus, trending: trendingBonus, softTv: -softTvPenalty };
  }
  topics.sort((a, b) => b.priority - a.priority);
  if (monitor) monitor.stage("score", `ranked ${topics.length} topics by freshness+corroboration+type (top=${topics[0]?.priority ?? "-"})`);
  return topics;
}

// TREND-PRIORITY SELECTION (rebuild 2026-06-29). The old version hard-capped each subcategory at perSubcatMax=2,
// which DROPPED the 3rd+ top-trending story in a hot subcategory (a scandal day, a music chart event) to make room
// for lower-priority items elsewhere — exactly the "drop a trending story for its shape" the owner forbids. Now we
// pick strictly by PRIORITY, with diversity only a SOFT tiebreak: each already-taken item from a subcategory adds a
// small penalty so near-ties spread out, but a genuinely higher-priority trending story is NEVER displaced. Music,
// box-office, celebrity, every shape compete in this ONE pool (the old music 10% quota / 60-40 lanes are gone —
// topic.tier pop/indie survives only as a downstream WRITING preset). publishableOnly drops held topics.
// 70/30 CONTENT MIX (owner 2026-07-03): ~70% of the queue is BIG film/TV/streaming/music news (movies, trailers,
// box office, reactions, castings — the trending Hollywood stories), ~30% is celebrity personal-life (weddings,
// relationships, fashion). We pick strictly by priority WITHIN each bucket, filling the big bucket first up to its
// target and overflowing either way if one bucket runs dry — so a normal news day leads with movies, not weddings.
export function selectDiverse(rankedTopics, { n = 10, spreadPenalty = 6, publishableOnly = true, bigShare = 0.7, floor = 0, minKeep = 4 } = {}) {
  let pool = (publishableOnly ? rankedTopics.filter((t) => t.verification?.publishable) : rankedTopics).slice();
  // NEWSWORTHINESS FLOOR (owner 2026-07-06): drop soft filler below `floor` so the drip stops padding a slow tick with
  // marginal items — but ALWAYS keep at least `minKeep` (the pool is priority-sorted) so the queue never fully starves.
  if (floor > 0 && pool.length > minKeep) {
    const above = pool.filter((t) => (t.priority || 0) >= floor);
    pool = above.length >= minKeep ? above : pool.slice(0, minKeep);
  }
  const isBig = (t) => (t.category || "").toLowerCase() !== "celebrity"; // celebrity = the personal-life 30% bucket
  const bigTarget = Math.round(n * bigShare);
  const picked = [];
  const taken = {};
  const pickFrom = (wantBig) => {
    let bestIdx = -1, bestEff = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      if (wantBig !== null && isBig(pool[i]) !== wantBig) continue; // this pass only draws from the wanted bucket
      const k = `${pool[i].category}/${pool[i].subcategory}`;
      const eff = (pool[i].priority || 0) - (taken[k] || 0) * spreadPenalty; // soft diversity nudge, NOT a hard cap
      if (eff > bestEff) { bestEff = eff; bestIdx = i; }
    }
    if (bestIdx < 0) return false;
    const t = pool.splice(bestIdx, 1)[0];
    taken[`${t.category}/${t.subcategory}`] = (taken[`${t.category}/${t.subcategory}`] || 0) + 1;
    picked.push(t);
    return true;
  };
  while (picked.length < n && pool.length) {
    const bigSoFar = picked.filter(isBig).length;
    const wantBig = bigSoFar < bigTarget; // still under the 70% big target → prefer a big story
    if (!pickFrom(wantBig)) pickFrom(!wantBig); // bucket empty → overflow from the other
  }
  return picked;
}
