// AGENT 1 — SCOUT: pick today's slate for VIRAL potential (plan §2.2 #1, §4).
// Deterministic candidate pool (articles, freshness, category, ledger dedup) +
// one cheap LLM scoring call per candidate batch. Sendability first — sends-per-reach
// is the #1 lever for non-follower reach (Mosseri, verified).
import fs from "node:fs";
import path from "node:path";
import { IG } from "../config.mjs";
import { llm } from "../models.mjs";
import { isPosted, isHeld, isBuilt, builtTopics, topicKey, loadWeights } from "../lib/ledger.mjs";
import { parseFrontmatter, stripMarkdown, normWords, pastDateAsUpcoming } from "../lib/util.mjs";
import { scorePool, logDiscovery, logSlate } from "./discovery.mjs";

// The reaction / social-media lane is a SEPARATE automation (owner 2026-07-11): the VIDEO lane
// builds ONLY from genuine NEWS + GOSSIP stories — never a "how fans are reacting online" piece
// (those articles are wall-to-wall fan quotes and read terribly as a reel). Targeted so it drops
// reaction pieces ("Has Fans Celebrating", "Has the Internet Divided", "Fans react…") without
// nuking a real news story that merely mentions a reaction.
const REACTION_TITLE_RE = /\bhas (fans?|viewers?|the internet|audiences?)\b|^\s*(fans?|viewers?|the internet|social ?media)\b|\b(fans?|viewers?|the internet|social ?media|audiences?)\b[^.!?]{0,40}\b(are (reacting|divided|losing it|freaking|obsess\w*|split|melting)|react to|can'?t (stop|get over|even))|\b(reactions? (pour|flood|are pouring|erupt)|go(es|ing)? viral|took to (social|twitter|x|reddit|instagram)|sparked? (a )?(frenzy|backlash|debate|meltdown|wave of (praise|reactions)))\b/i;
const REACTION_TAGS = new Set(["fan reactions", "fan reaction", "social media reactions", "internet reactions", "viral moments", "reactions"]);
export function isReactionArticle(data) {
  if (REACTION_TITLE_RE.test(`${data.title || ""} ${data.dek || data.description || ""}`)) return true;
  const tags = Array.isArray(data.tags) ? data.tags.map((x) => String(x).toLowerCase().trim()) : [];
  return tags.some((x) => REACTION_TAGS.has(x));
}

// LANE FILTER (owner 2026-07-13): this video automation builds ONLY from the NEWS and GOSSIP
// automations — NOTHING else. Every article carries a `formatTag` naming the lane that produced it.
// box-office / streaming / watchguide (the BOX-OFFICE automation), trailer, music-news / music-awards
// (the MUSIC automation), awards, and inside (inside-stories) all belong to OTHER automations and are
// EXCLUDED. Accepting them was the scope leak that let a box-office "streaming" article get picked. An
// untagged legacy article is still allowed (treated as news; every real lane tags its output).
const VIDEO_FORMATS = new Set(["news", "gossip"]);
function inNewsOrGossipLane(data) {
  const ft = String(data.formatTag || "").toLowerCase().trim();
  return !ft || VIDEO_FORMATS.has(ft);
}

export function listCandidates({ now = new Date(), lane = null, days = null } = {}) {
  const files = fs.readdirSync(IG.articlesDir).filter((f) => f.endsWith(".md"));
  const cutoff = now.getTime() - (days ?? IG.poolDays ?? IG.freshDays) * 864e5;
  const doneTopics = builtTopics(); // topic tokens of every already-built story (cross-run topic dedup)
  const out = [];
  for (const f of files) {
    const slug = f.replace(/\.md$/, "");
    let raw;
    try { raw = fs.readFileSync(path.join(IG.articlesDir, f), "utf8"); } catch { continue; }
    const { data, body } = parseFrontmatter(raw);
    const category = String(data.category || "").toLowerCase();
    if (!IG.categories.includes(category)) continue;
    if (String(data.storyStatus || "").toUpperCase() === "RUMOR") continue;
    if (!inNewsOrGossipLane(data)) continue; // ONLY the news + gossip automations (not inside-stories)
    if (lane && String(data.formatTag || "").toLowerCase().trim() !== lane) continue; // owner-requested lane scope (e.g. --lane=gossip)
    if (isReactionArticle(data)) continue; // reaction/social-media lane = separate automation, not video
    const date = new Date(data.date || 0).getTime();
    if (!date || date < cutoff) continue;
    // STALE-DATE GUARD (owner audit 2026-07-16): "Kai Cenat Returns July 6th" shipped as fresh news on
    // 07-15 — the fresh-window pool (freshDays=10) keeps a story eligible long after its DATED moment
    // passed. A title/dek that frames a >48h-past date as UPCOMING is stale news and never enters the
    // slate. (The platformMeta validator is the downstream net for dates the writer introduces.)
    if (pastDateAsUpcoming(`${data.title || ""} ${data.dek || data.description || ""}`, now)) continue;
    if (isPosted(slug)) continue; // never repost — mine OR the old lane's
    if (isBuilt(slug)) continue; // never rebuild an already-built story (repetition guard)
    // TOPIC dedup: skip a story that shares 2+ significant tokens (names/nouns) with an
    // already-built reel — one Taylor Swift wedding reel is enough; move to a fresh topic.
    if (doneTopics.length) {
      const t = topicKey(`${data.title || ""} ${data.dek || data.description || ""}`);
      if (doneTopics.some((bt) => t.filter((x) => bt.includes(x)).length >= 2)) continue;
    }
    if (isHeld(slug)) continue; // held stories don't consume slate slots run after run
    // owner floor: every video is 30-40s of REAL story — thin articles can't carry that
    // without padding, so they never enter the slate (skip up front, zero spend)
    if (stripMarkdown(body).length < 1200) continue;
    out.push({
      slug,
      title: stripMarkdown(data.title || slug),
      dek: stripMarkdown(data.dek || data.description || "").slice(0, 240),
      category,
      date: data.date,
      heroImage: data.heroImage || data.image || null,
      sourceUrls: Array.isArray(data.sourceUrls) ? data.sourceUrls : [],
      formatTag: String(data.formatTag || "").toLowerCase(),
      body: stripMarkdown(body).slice(0, 1200),
      // popularity-engine inputs (2026-07-17): news/box-office articles arrive pre-scored by the FIND
      // pipeline; gossip carries none of these (its heat comes from Wikipedia spikes + event priors)
      trendScore: data.trendScore != null ? Number(data.trendScore) : null,
      eventType: data.eventType || null,
      primaryEntity: data.primaryEntity || null,
      imageAlt: data.imageAlt || null, // entity fallback: most articles lack primaryEntity but imageAlt names the subject
    });
  }
  out.sort((a, b) => new Date(b.date) - new Date(a.date));
  // SAME-EVENT DEDUP (owner 2026-07-12): don't stack two reels on ONE event — both Barkley and
  // Seacrest were "declined the Swift/Kelce wedding". Two stories are the same event when their
  // titles share 3+ significant tokens (a shared name/topic cluster). Keep the most recent.
  const GENERIC = new Set(["says", "after", "over", "into", "from", "with", "that", "this", "their", "your", "what", "when", "why", "how", "the", "and", "for", "reveals", "shares", "makes", "star", "new", "movie", "film", "show", "season"]);
  const sig = (t) => new Set(normWords(t).filter((w) => w.length >= 4 && !GENERIC.has(w)));
  const kept = [];
  for (const c of out) {
    const s = sig(c.title);
    const dup = kept.some((k) => { let n = 0; for (const w of s) if (k._sig.has(w)) n++; return n >= 3; });
    if (dup) continue;
    c._sig = s;
    kept.push(c);
  }
  return kept.map(({ _sig, ...c }) => c);
}

const SYS = `You score Hollywood news stories for ONE goal: which would go MOST VIRAL as an Instagram Reel right now.
Scoring lens (in order): (1) SENDABILITY — would a movie/TV fan DM this to a specific friend? (casting shocks, record numbers, first-looks, "X is back" nostalgia, fandom-identity beats score high); (2) HOOK POTENTIAL — is there one concrete, surprising fact that works as a ≤12-word opening line?; (3) SURPRISE DENSITY — enough strong facts for 20-35 seconds. Generic recaps, process stories ("X discussed Y"), and inside-baseball score low.
Return STRICT JSON: {"scores":[{"slug":string,"score":0-100,"sendability":0-10,"breaking":boolean,"hookIdea":string,"segment":string}]}
segment ∈ ["Box Office in 30","Casting Watch","Trailer Take","Celebrity Wire","TV Signal"]. breaking=true only for a still-developing, hours-old story.`;

// lane split: only two lanes reach here (VIDEO_FORMATS = news + gossip): gossip → gossip lane,
// everything else (news + untagged legacy) → news lane.
const laneOf = (c) => (String(c.formatTag || "").toLowerCase() === "gossip" ? "gossip" : "news");
// LANE BALANCE (owner 2026-07-13): interleave from each lane so gossip's higher volume can never
// starve news out of the scored batch. `order` decides WITHIN each lane (recency or starPower).
function interleaveBatch(pool, size = 18) {
  const news = pool.filter((c) => laneOf(c) === "news");
  const gossip = pool.filter((c) => laneOf(c) === "gossip");
  const batch = [];
  for (let i = 0; batch.length < size && (i < news.length || i < gossip.length); i++) {
    if (i < news.length) batch.push(news[i]);
    if (i < gossip.length) batch.push(gossip[i]);
  }
  return batch;
}

export async function scout({ limit = 3, candidates = null, lane = null } = {}) {
  // FRESH-FIRST POOL (owner 2026-07-24): rank TODAY + YESTERDAY's articles, not the whole 10-day
  // archive. Thin fresh pool (weekend, outage) → widen one day at a time up to freshDays so the
  // 7/day guarantee survives holds + topic-dedup; every widening is visible in the run log.
  let pool = candidates;
  if (!pool) {
    const minPool = IG.discovery?.minPool ?? 24;
    let days = IG.poolDays ?? 2;
    pool = listCandidates({ lane, days });
    while (pool.length < minPool && days < (IG.freshDays ?? 10)) {
      days++;
      pool = listCandidates({ lane, days });
    }
    if (days > (IG.poolDays ?? 2)) console.log(`  scout: fresh pool thin — widened to ${days} days (${pool.length} candidates)`);
    else console.log(`  scout: fresh pool ${pool.length} candidates (${days}-day window)`);
  }
  if (!pool.length) return [];
  const weights = loadWeights();
  // POPULARITY ENGINE v2 (owner 2026-07-17): the old batch was the NEWEST 18 of a ~250-450 pool —
  // under 10% seen, recency ≠ interest. The engine scores the WHOLE pool deterministically ($0:
  // trendScore + Wikipedia spike/fame + event priors + Google Trends) and the TOP of each lane fills
  // the batch instead. FAIL-OPEN: any engine failure → the old recency order, never an empty slate.
  // A discovery log is written every run (engine picks vs recency picks) for grading.
  const recencyBatch = interleaveBatch(pool); // the old behavior — fallback + grading baseline
  let batch = recencyBatch;
  let engineRanked = null;
  if ((IG.discovery?.mode || "off") !== "off") {
    try {
      engineRanked = await scorePool(pool);
      // GLOBAL TOP-BY-IMPORTANCE (owner 2026-07-24: "rank ALL the articles, choose the top 7").
      // The old lane interleave sent the judge "top 9 news + top 9 gossip" — on a weak day for one
      // lane its mediocre stories displaced the other lane's strong ones. The batch is now the
      // GLOBAL top of the ranked pool (qualifiers first, then starPower); the per-category cap
      // downstream still prevents a monoculture slate. Interleave remains only as the fail-open
      // recency baseline.
      const engineBatch = engineRanked.slice(0, 18);
      logDiscovery({
        mode: IG.discovery.mode, poolSize: pool.length,
        engineTop: engineBatch, recencyTop: recencyBatch,
        lookupsCached: engineRanked.filter((c) => c.signals?.wikiBaseline != null).length,
      });
      if (IG.discovery.mode === "live") batch = engineBatch;
      console.log(`  discovery: pool ${pool.length} → ${engineBatch.filter((c) => c.qualified).length} qualified (mode=${IG.discovery.mode}${IG.discovery.mode === "live" ? ", engine batch live" : ", shadow log only"})`);
    } catch (e) {
      console.warn(`  discovery engine failed (${String(e?.message || e).slice(0, 80)}) — recency batch (fail-open)`);
    }
  }
  const user = JSON.stringify(
    // heat/fame shown to the judge: a 250×-spike story deserves the benefit of the doubt on hook choice
    batch.map(({ slug, title, dek, category, date, heat, fame }) => ({ slug, title, dek, category, date, ...(heat != null ? { audienceHeat: heat } : {}), ...(fame != null ? { starFame: fame } : {}) })),
  ) + (Object.keys(weights.segments || {}).length
    ? `\n\nLEARNED SEGMENT PERFORMANCE (higher = our audience responds better): ${JSON.stringify(weights.segments)}`
    : "");
  // 1600 not 900: 18 candidates × a per-item hookIdea sentence overran 900 tokens → the JSON was
  // truncated mid-array → unparseable → the whole scout failed with no slate. (owner 2026-07-12)
  const res = await llm({ role: "classify", system: SYS, user, temp: 0.2, maxTokens: 1600, json: true });
  const scores = new Map((res.scores || []).map((s) => [s.slug, s]));
  const scored = batch
    .map((c) => ({ ...c, ...(scores.get(c.slug) || { score: 0, sendability: 0, breaking: false, segment: "Celebrity Wire" }) }))
    .filter((c) => c.score >= 40);
  // final order: LLM viral score blended with deterministic starPower (owner rule: popularity is
  // first-class), plus the movies-first nudge. Blend weights in config (default 60/40).
  const bl = IG.discovery?.blend || { llm: 1, star: 0 };
  const eff = (c) => bl.llm * c.score + bl.star * (c.starPower ?? c.score) + (c.category === "movies" ? 8 : 0);
  scored.sort((a, b) => eff(b) - eff(a));
  // Category variety cap — SCALES with the run's target so the slate can actually REACH `limit`.
  // ROOT CAUSE of "only 3/7 per day" (owner 2026-07-15): the old FLAT cap of 2, across just 3
  // categories (movies/tv/celebrity), hard-capped EVERY slate at 6 — so a single run could never build
  // the 7 the owner wants, and with celebrity/gossip-heavy supply it yielded ~3 (2 celebrity + 1 tv + 0
  // movies). The cap is now max(2, limit-2), so a scheduled --limit=15 run assembles up to ~13 of the
  // abundant category (attempt many, ship 7 after holds — the guarantee comes from ATTEMPTS surviving
  // holds, not from a small slate). The movies-first sort above still LEADS with movies/tv when they
  // exist, and topic-dedup still guarantees 7 DISTINCT stories. Small manual runs keep a tight cap.
  const perCatCap = Math.max(2, limit - 2);
  const out = [];
  const perCat = {};
  for (const c of scored) {
    if ((perCat[c.category] || 0) >= perCatCap) continue;
    perCat[c.category] = (perCat[c.category] || 0) + 1;
    out.push(c);
    if (out.length >= limit) break;
  }
  // RANKING RECORD (owner 2026-07-24): every run commits WHY these stories were chosen — the final
  // slate in build order with every quantified signal (viral score, starPower, heat, fame,
  // qualification). data/ig/discovery/<ts>-slate.json; auditable per day, feeds the learner reviews.
  logSlate(out);
  return out;
}
