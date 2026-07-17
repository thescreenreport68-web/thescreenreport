// AGENT 1 — FINDER / SCOUT. One job: from the discovered in-theater + trending pool, pick the
// films worth a money story RIGHT NOW, assign the best FORM, and write plain search queries the
// gatherer feeds to contentFinder to pull the trade box-office report. Highest call-count role →
// the cheapest model (nova-micro), because every pick is re-verified downstream (plan §8).
import { discoverFilms, discoverTrendingTv } from "../discover.mjs";
import { agentChat } from "../models.mjs";
import { FORMS, scopeOk, BOX_OFFICE_FORMS } from "../config.bo.mjs";
import { loadTracked, streamingExits } from "../tracker.mjs";
import { fetchNetflixTop10 } from "../netflix.mjs";
import { fetchDailyChart } from "../dailyChart.mjs";
import { readQueue, markConsumed } from "../find/findrun.mjs";
import { getTitleFacts } from "../../lib/tmdb.mjs";

// Build a {film, trigger, angle} entry in the finder's canonical shape (used for tracker-surfaced
// NOW-STREAMING exits; the LLM-classified in-theater picks build the same shape inline below).
function mkEntry(f, formKey, { workingTitle = "", star = "", queries = [] } = {}) {
  const form = FORMS[formKey];
  const priority = Math.max(1, Math.min(100, Math.round(f.popularity || 0)));
  const base = String(f.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    film: { tmdbId: f.id, title: f.title, year: f.year, releaseDate: f.releaseDate, primaryEntity: f.title, overview: f.overview || "", originalLanguage: f.originalLanguage, popularity: f.popularity || 0, via: f.via, providers: f.providers, netflix: f.netflix || null },
    trigger: { eventSlug: `${base}-${formKey.toLowerCase()}`, title: f.title, primaryEntity: star || f.title, category: form.category, subcategory: form.subcategory, priority, signals: { recency: f.trendingHot ? 5 : 3, pop: Math.min(10, Math.round((f.popularity || 0) / 50)), breakout: f.trendingHot ? 4 : 0 }, eventType: "boxoffice", sources: [] },
    angle: { form: formKey, workingTitle: (workingTitle || `${f.title} box office`).slice(0, 140), star, queries: (Array.isArray(queries) ? queries : []).filter(Boolean).slice(0, 3) },
  };
}

const SYS = `You are the editor of a BOX-OFFICE money desk for a Hollywood / English-language film site.
For EACH numbered film, decide whether it is worth a box-office story right now and pick ONE form:
- BO-OPENING: the film just opened / is posting its first weekend.
- BO-UPDATE: an in-theater film made a MATERIAL move (weekend actuals, a hold/drop, a milestone like $100M, overtaking another film).
- NOW-STREAMING: the film has left theaters and just landed on a streaming/PVOD platform.
HARD SCOPE: Hollywood / English-language films ONLY. REJECT Bollywood / other-language / non-Hollywood
box office no matter how popular. Skip films with no genuine money angle right now.
For each pick: a working headline (stars + the number, curiosity without clickbait), the star(s) to lead
with, and 2 SIMPLE search queries (3-5 plain words, e.g. "Wicked box office weekend"). Output STRICT JSON only.`;

export async function findFilms({ limit = 3, discoverImpl = discoverFilms, chatImpl = null, nowMs = null, trackedImpl = null, providersImpl = null, netflixImpl = null, dailyChartImpl = null, queueImpl = null, dryQueueMark = false, trendingTvImpl = null, preferStreaming = false, seen = null } = {}) {
  const films = await discoverImpl({ nowMs });
  const seenSlugs = seen?.slugs || new Set();
  const seenTitles = seen?.titles || new Set();
  // A pick is a REPEAT (drop it → rotate to something fresh) when: a BO-OPENING whose film we've already
  // covered (by title), or any non-update piece whose exact eventSlug we've already published. BO-UPDATE
  // is NEVER dropped here — the materiality gate downstream decides if the new number is a real story.
  const isRepeat = (eventSlug, form, title) =>
    form === "BO-UPDATE" ? false
      : form === "BO-OPENING" ? seenTitles.has(String(title || "").toLowerCase())
      : seenSlugs.has(eventSlug);

  // NOW-STREAMING exit candidates from the tracker: films tracked in theaters that have since left and
  // now carry a TMDB-confirmed platform (plan §6). Best-effort — never break normal discovery.
  let exitEntries = [];
  try {
    const tracked = trackedImpl || loadTracked();
    const providersFor = providersImpl || (async (rec) => {
      const f = await getTitleFacts(rec.title, "movie", (rec.releaseDate || "").slice(0, 4)).catch(() => null);
      return f?.providers || null;
    });
    const nowPlayingIds = films.filter((f) => f.via === "now_playing").map((f) => f.id);
    const exits = await streamingExits(tracked, nowPlayingIds, { providersFor, max: 2 });
    exitEntries = exits.filter((f) => scopeOk(f)).map((f) => mkEntry(f, "NOW-STREAMING", {
      workingTitle: `${f.title} now streaming`, queries: [`${f.title} streaming`, `${f.title} where to watch`],
    })).filter((e) => !isRepeat(e.trigger.eventSlug, "NOW-STREAMING", e.film.title));
  } catch { exitEntries = []; }

  // STREAMING picks (deterministic, from Netflix Top 10 — first-hand hours; plan §4b/§5). Best-effort.
  // NETFLIX-TOP10 = the week's top English film; TRENDING-TV = the week's top English series. Priority
  // tracks the Netflix rank so #1 places well.
  let streamPicks = [];
  try {
    const nf = await (netflixImpl || fetchNetflixTop10)();
    // Year hint = the Netflix chart week's year, so TMDB resolves the CURRENT title (not an old same-name
    // film): without it, "Turbo"/"Swapped" match a decade-old movie, castTrustworthy rejects the cast, and the
    // writer is starved to ~120 words. With the hint, the current title's cast+characters+premise+genre flow
    // through → a full 200-word streaming brief.
    const nfYear = String(nf?.week || "").slice(0, 4);
    // WEEK-KEYED slugs: the Netflix chart is a WEEKLY story — a title holding the Top 10 in a NEW week with
    // new hours is a new article. The old week-less slug meant a title covered once could never re-post
    // (a top cause of the dead streaming mix); same-week repeats are still blocked by the same key.
    const weekTag = String(nf?.week || "").slice(0, 10);
    const slugFor = (title, formKey) => `${String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${formKey.toLowerCase()}${weekTag ? `-w${weekTag}` : ""}`;
    const mkStream = (row, formKey, kind, wt, q2) => {
      const e = mkEntry(
        { id: null, title: row.title, year: nfYear, releaseDate: nf?.week || "", popularity: Math.max(40, 100 - (row.rank || 1) * 8), overview: "", originalLanguage: "en", via: kind, netflix: { ...row, week: nf.week } },
        formKey, { workingTitle: wt, queries: [`${row.title} netflix`, q2] });
      e.trigger.eventSlug = slugFor(row.title, formKey);
      return e;
    };
    // VOLUME FIX: surface EVERY fresh (uncovered) Netflix Top 10 entry — not just the first — so the lane can
    // work the WHOLE chart (10 films + 10 TV per week = ~20 reliable streaming stories) across the day's ticks,
    // rotating to the next uncovered title each tick. Netflix's own hours anchor these, so they publish
    // reliably (a title staying #1 for weeks still never re-posts — it's already in seenSlugs).
    const freshRows = (rows, formKey, n) => {
      const picked = new Set(); const out = [];
      for (const r of rows || []) {
        const sl = r?.title ? slugFor(r.title, formKey) : null;
        if (!sl || seenSlugs.has(sl) || picked.has(sl)) continue; // skip covered + within-pool dupes (same title at 2 ranks)
        picked.add(sl); out.push(r);
        if (out.length >= n) break;
      }
      return out;
    };
    for (const r of freshRows(nf?.films, "NETFLIX-TOP10", 8))
      streamPicks.push(mkStream(r, "NETFLIX-TOP10", "netflix-top10", `${r.title} on Netflix's Top 10`, `${r.title} netflix cast`));
    for (const r of freshRows(nf?.tv, "TRENDING-TV", 8))
      streamPicks.push(mkStream(r, "TRENDING-TV", "netflix-tv", `${r.title} trending on Netflix`, `${r.title} season reactions`));
  } catch { streamPicks = []; }

  // P5 — TMDB daily trending-TV picks (ANY platform, appended after the Netflix hours-anchored picks):
  // catches "an episode just hit and the show is blowing up" the day it happens. The platform resolves
  // from TMDB providers downstream; hours stay Netflix/named-source-only (the watch-hours guard).
  try {
    const tv = await (trendingTvImpl || discoverTrendingTv)({});
    const streamTitles = new Set(streamPicks.map((e) => e.film.title.toLowerCase()));
    for (const t of (tv || []).slice(0, 4)) {
      const base = String(t.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const sl = `${base}-trending-tv`;
      if (!t.title || seenSlugs.has(sl) || streamTitles.has(t.title.toLowerCase())) continue; // Netflix pick wins (it has hours)
      const e = mkEntry(
        { id: t.id, title: t.title, year: t.year, releaseDate: t.firstAir, popularity: Math.min(90, 40 + Math.round((t.popularity || 0) / 20)), overview: t.overview || "", originalLanguage: "en", via: "tmdb-tv-trending" },
        "TRENDING-TV",
        { workingTitle: `${t.title} trending`, queries: [`${t.title} series trending`, `${t.title} season reactions`] },
      );
      streamPicks.push(e);
    }
  } catch { /* additive — Netflix picks carry streaming regardless */ }

  // DAILY BOX-OFFICE CHART — the box-office volume engine (owner: cover EVERY film in theaters, day 11 → day 12
  // with its real running cume). Each in-release film becomes a BO-UPDATE carrying its chart cume; the
  // strictly-higher materiality gate downstream publishes it ONCE/day and never reuses yesterday's number.
  let chartPicks = [];
  try {
    const nowYear = String(new Date(nowMs || Date.now()).getFullYear()); // year hint → TMDB resolves the CURRENT film
    const chart = await (dailyChartImpl || fetchDailyChart)({ chatImpl, nowMs });
    for (const f of chart?.films || []) {
      if (!f?.title || !scopeOk({ title: f.title })) continue;
      const e = mkEntry(
        { id: null, title: f.title, year: nowYear, releaseDate: "", popularity: Math.max(50, 100 - (f.rank || 1) * 4), overview: "", originalLanguage: "en", via: "daily-chart" },
        "BO-UPDATE",
        { workingTitle: `${f.title} box office ${f.dayInRelease || ""}`.trim(), queries: [`${f.title} box office ${f.dayInRelease || "latest"}`, `${f.title} box office cume`] },
      );
      e.film.dailyChart = { cume: f.cume || null, dailyGross: f.dailyGross || null, dailyChangePct: f.dailyChangePct || null, theaters: f.theaters || null, dayInRelease: f.dayInRelease || null };
      chartPicks.push(e);
    }
  } catch { chartPicks = []; }

  // P2 EVENT QUEUE — the breaking/event stream (trade RSS + gnews → categorized, clustered, demand-scored
  // by findrun). A fresh corroborated OPENING/milestone/streaming-arrival outranks inventory walking. An
  // event matching a chart film BOOSTS that chart entry (the chart carries the real numbers); an event for
  // a film NOT on the chart (a brand-new opening, a streaming arrival) becomes its own candidate.
  let queueEvents = [];
  try {
    const q = queueImpl ? queueImpl() : readQueue({ nowMs });
    queueEvents = (q?.events || []).filter((ev) => !ev.consumedAt && ev.filmTitle && scopeOk({ title: ev.filmTitle }));
  } catch { queueEvents = []; }
  const eventEntries = [];
  const chartByTitle = new Map(chartPicks.map((e) => [e.film.title.toLowerCase(), e]));
  for (const ev of queueEvents.slice(0, 8)) {
    const chartHit = chartByTitle.get(ev.filmTitle.toLowerCase());
    if (chartHit) { // demand signal on a tracked chart film → boost its rank in the pool
      chartHit.trigger.priority = Math.max(chartHit.trigger.priority, Math.min(100, 30 + (ev.priority || 0)));
      chartHit.trigger.signals.breakout = 4;
      continue;
    }
    // P5 CROSS-NAMESPACE DEDUP: a milestone/record headline about a film we've ALREADY covered (in any
    // form) is not a new story unless its number advanced — and that judgement belongs to the chart entry
    // + materiality gate, not a parallel event entry (the michael-ev-milestone re-cover class: the trades
    // kept re-writing Michael's $1B days after we covered it). Off-chart + covered → drop the event.
    if ((ev.kind === "milestone" || ev.kind === "record") && seenTitles.has(ev.filmTitle.toLowerCase())) continue;
    const form = ev.form && FORMS[ev.form] ? ev.form : "BO-UPDATE";
    if (seenSlugs.has(ev.slug)) continue;
    const e = mkEntry(
      { id: null, title: ev.filmTitle, year: String(new Date(nowMs || Date.now()).getFullYear()), releaseDate: "", popularity: Math.min(100, 30 + (ev.priority || 0)), overview: "", originalLanguage: "en", via: `event-${ev.kind}` },
      form,
      { workingTitle: (ev.sources?.[0]?.title || `${ev.filmTitle} box office`).slice(0, 140), queries: [`${ev.filmTitle} box office`, `${ev.filmTitle} ${ev.kind === "streaming-arrival" ? "streaming" : "weekend gross"}`] },
    );
    e.trigger.eventSlug = ev.slug;
    e.trigger.sources = (ev.sources || []).filter((s) => s.url).map((s) => ({ url: s.url, outlet: s.owner, tier: s.tier }));
    e.trigger.signals.recency = 5;
    eventEntries.push(e);
  }
  if (eventEntries.length && !dryQueueMark) { try { markConsumed(eventEntries.map((e) => e.trigger.eventSlug)); } catch {} }

  // Candidate POOL for the tick. EVENT entries lead (breaking beats inventory), then the DAILY-CHART
  // box-office engine (real running numbers for every film in theaters = the 15/day engine); streaming
  // picks are a REACHABLE fallback so a tick never comes up empty. preferStreaming puts streaming first.
  const poolSize = Math.max(limit, 6);
  const merge = (bo) => (preferStreaming
    ? [...eventEntries, ...streamPicks, ...chartPicks, ...exitEntries, ...bo]
    : [...eventEntries, ...chartPicks, ...exitEntries, ...bo.slice(0, 2), ...streamPicks, ...bo.slice(2)]).slice(0, poolSize);

  if (!films.length) return merge([]);

  const listing = films.map((f, i) =>
    `${i}. "${f.title}"${f.year ? ` (${f.year})` : ""} | released ${f.releaseDate || "?"} | popularity ${Math.round(f.popularity)} | via ${f.via}${f.trendingHot ? " · TRENDING" : ""} | ${(f.overview || "").slice(0, 90)}`).join("\n");

  const deadline = (p, ms) => Promise.race([p, new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(`classify deadline ${ms / 1e3}s`)), ms); t.unref?.(); })]);
  let picks = [];
  try {
    const { data } = await deadline(agentChat("finder", {
      system: SYS,
      user: `FILMS:\n${listing}\n\nForms allowed: ${BOX_OFFICE_FORMS.join(", ")}\nJSON: {"picks":[{"i":0,"form":"BO-OPENING","workingTitle":"","star":"","queries":["",""]}]}\nOnly films worth covering now. Order strongest first.`,
    }, chatImpl ? { chatImpl } : {}), 55e3);
    picks = data?.picks || [];
  } catch {
    // Finder LLM down → deterministic fallback: freshest films get BO-OPENING, entity queries.
    picks = films.slice(0, limit).map((f, i) => ({
      i, form: "BO-OPENING", workingTitle: `${f.title} box office`, star: "",
      queries: [`${f.title} box office`, `${f.title} weekend`],
    }));
  }

  const priorityOf = (f) => Math.max(1, Math.min(100, Math.round(f.popularity)));
  const out = [];
  for (const p of picks) {
    const f = films[p.i];
    if (!f || !p.form || !FORMS[p.form] || FORMS[p.form].streaming) continue; // never let the LLM assign a streaming form to a theatrical film
    if (!scopeOk(f)) continue; // scope clamp — never trust the enum
    const form = FORMS[p.form];
    const priority = priorityOf(f);
    const eventSlug = `${f.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${p.form.toLowerCase()}`;
    if (isRepeat(eventSlug, p.form, f.title)) continue; // already covered → rotate to a fresh story
    out.push({
      film: {
        tmdbId: f.id, title: f.title, year: f.year, releaseDate: f.releaseDate,
        primaryEntity: f.title, overview: f.overview, originalLanguage: f.originalLanguage,
        popularity: f.popularity, via: f.via,
      },
      trigger: {
        eventSlug,
        title: f.title,
        primaryEntity: p.star || f.title,
        category: form.category, subcategory: form.subcategory,
        priority,
        signals: { recency: f.trendingHot ? 5 : 3, pop: Math.min(10, Math.round(f.popularity / 50)), breakout: f.trendingHot ? 4 : 0 },
        eventType: "boxoffice",
        sources: [], // the gatherer's contentFinder fills real trade-report sources
      },
      angle: {
        form: p.form,
        workingTitle: (p.workingTitle || `${f.title} box office`).slice(0, 140),
        star: p.star || "",
        queries: (Array.isArray(p.queries) ? p.queries : []).filter(Boolean).slice(0, 3),
      },
    });
    if (exitEntries.length + streamPicks.length + out.length >= limit) break;
  }

  // BACKFILL — if repeats/scope drops left us short, rotate DOWN the discovered pool to fresh, uncovered
  // films (deterministic BO-OPENING) so a run never comes up empty just because the top story was already
  // covered. borun reclassifies + materiality-gates these downstream, so a stale one still won't publish.
  const picked = new Set(out.map((e) => String(e.film.title || "").toLowerCase()));
  for (const f of films) {
    if (exitEntries.length + streamPicks.length + out.length >= Math.max(limit, 1)) break;
    if (!scopeOk(f)) continue;
    const t = String(f.title || "").toLowerCase();
    if (!t || picked.has(t) || seenTitles.has(t)) continue;
    out.push(mkEntry(f, "BO-OPENING", { workingTitle: `${f.title} box office`, queries: [`${f.title} box office`, `${f.title} weekend`] }));
    picked.add(t);
  }

  // ADVANCE-COVERED (owner's fallback): when the fresh/uncovered pool is exhausted and slots remain, surface
  // films we've ALREADY covered as BO-UPDATE candidates — advancing them day-by-day (Day 10 → Day 11+). The
  // tracker's strictly-higher rule downstream only lets one through if today's number is genuinely higher than
  // the last we published, so this NEVER re-posts old numbers.
  const filled = () => exitEntries.length + streamPicks.length + out.length >= Math.max(limit, 1);
  if (!filled()) {
    const covered = trackedImpl || loadTracked();
    const byTitle = new Map(films.map((f) => [String(f.title || "").toLowerCase(), f]));
    for (const rec of Object.values(covered?.films || {})) {
      if (filled()) break;
      if (rec.status !== "in-theaters" || !rec.title) continue;
      const t = String(rec.title).toLowerCase();
      if (picked.has(t)) continue;
      const f = byTitle.get(t) || { id: rec.tmdbId, title: rec.title, year: (rec.releaseDate || "").slice(0, 4), releaseDate: rec.releaseDate, popularity: 0, overview: "", originalLanguage: "en", via: "advance-covered" };
      if (!scopeOk(f)) continue;
      out.push(mkEntry(f, "BO-UPDATE", { workingTitle: `${f.title} box office`, queries: [`${f.title} box office latest`, `${f.title} box office cume`] }));
      picked.add(t);
    }
  }
  return merge(out);
}
