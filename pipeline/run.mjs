// Pipeline orchestrator. Runs each topic through every stage in strict order; nothing is written
// unless it passes the rank-#1 gate (>=80, no hard-block) AND has a legal >=1200px image.
// Run:  cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; node site/pipeline/run.mjs [--dry-run] [--only=<id>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS } from "./config.mjs";
import { gatherFacts } from "./lib/groundFacts.mjs";
import { findContent } from "./lib/contentFinder.mjs";
import { generate } from "./stages/generate.mjs";
import { classify } from "./stages/classify.mjs";
import { editorialGate } from "./stages/editorialGate.mjs";
import { canonicalize } from "./find/categorize.mjs";
import { recordPublished, slugKey, loadPublished, entityKey } from "./find/store.mjs";
import { recentArticles, findDuplicate, entityDayCap } from "./lib/dupGuard.mjs";
import { findSameStory, myRecentArticles } from "./find/sameStory.mjs";
import { mergeUpdate } from "./stages/updateArticle.mjs";
import { sourceImage, measureRemote } from "./stages/image.mjs";
import { pickHeroImage } from "./lib/heroImage.mjs";
import { cutArticle } from "./lib/cutter.mjs";
import { dedupeSentences, trimIncomplete, dropOrphanHeadings } from "./lib/polish.mjs";
import { gate } from "./stages/gate.mjs";
import { assemble } from "./stages/assemble.mjs";
import { getWhereToWatch, factBlock, toWhereToWatch, discoverTop, discoverFactBlock, getTrailer, trailerFactBlock, getBoxOffice, boxOfficeFactBlock, getTitleFacts, titleFactBlock } from "./lib/tmdb.mjs";
import { omdb, omdbFactBlock } from "./lib/omdb.mjs";
import { getAuthoritativeAwards, awardsFactBlock, personAwards, personAwardsBlock } from "./lib/awardsCache.mjs";
import { cacheTweets, reactionFactBlock } from "./lib/tweets.mjs";
import { searchInterview, fetchTranscript, oEmbed, interviewFactBlock } from "./lib/youtube.mjs";
import { costReport } from "./lib/openrouter.mjs";
import { auditArticle, printAudit } from "./lib/articleAudit.mjs";
import { TOPICS } from "./topics.mjs";

// Repo-root-relative paths (portable — works locally AND in GitHub Actions/cloud; no hardcoded machine path).
const __dirname = path.dirname(fileURLToPath(import.meta.url)); // …/site/pipeline
const ART = path.resolve(__dirname, "../content/articles");
const STATE = path.resolve(__dirname, "../data/state");
fs.mkdirSync(STATE, { recursive: true });
const DRY = process.argv.includes("--dry-run");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
// FIND→MAKE seam: --from-find loads the autonomously-discovered ranked queue (data/find/queue.json)
// instead of the hand-typed topics.mjs. This is the single integration point (FIND_HALF_PLAN §3).
const FROM_FIND = process.argv.includes("--from-find");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 0;
let SOURCE_TOPICS = TOPICS;
if (FROM_FIND) {
  const q = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/find/queue.json"), "utf8"));
  SOURCE_TOPICS = q.topics || [];
  // DRIP-SAFE ledger-skip (2026-07-04): drop any queued topic already in the published ledger, so a drip that
  // re-enters the SAME queue across ticks NEVER re-publishes a story (the queue is static between FIND top-ups; the
  // ledger is the source of truth for what's done). Same keys FIND dedups on: title slug, eventSlug, entity+type.
  const _pub = loadPublished();
  const _n0 = SOURCE_TOPICS.length;
  SOURCE_TOPICS = SOURCE_TOPICS.filter((t) =>
    !(t.title && _pub.titles.has(slugKey(t.title))) &&
    !(t.eventSlug && _pub.events.has(t.eventSlug)) &&
    !(entityKey(t.primaryEntity, t.eventType) && _pub.entities.has(entityKey(t.primaryEntity, t.eventType))));
  console.log(`FROM-FIND: loaded ${_n0} topics (queue run ${q.runId}); ${_n0 - SOURCE_TOPICS.length} already-published skipped → ${SOURCE_TOPICS.length} fresh`);
  // CROSS-LANE 72h DUPLICATE-STORY GUARD (owner root-cause directive 2026-07-16): the ledger above only knows what
  // THIS lane published and only matches exact keys — the same story covered by another lane (inside ran the
  // Batman-2028 delay twice in 2h) or re-angled under a different headline slips through. Fuzzy-match each
  // candidate's entities+event words against EVERY article in the shared content/articles dir from the last 72h
  // (read-only — all lanes publish there); ≥3 shared non-generic stems = same story → skip.
  const _recent = recentArticles(168); // 7 days (2026-07-17: a 6-day-later rehash of our own Ariana Grande story slipped the old 72h window)
  // ONE STORY = ONE URL (owner standing policy 2026-07-19): before deciding to SKIP a near-duplicate, ask whether it
  // is actually a DEVELOPMENT on a story THIS lane already published. If so we keep the topic and route it to an
  // in-place UPDATE of that article (find/sameStory.mjs decides, at a much higher bar than the skip rule — a wrong
  // update overwrites a live URL). `myRecentArticles` is ledger-restricted, so another lane's file can never match.
  const _mine = myRecentArticles(168);
  const _n1 = SOURCE_TOPICS.length;
  let _updates = 0;
  SOURCE_TOPICS = SOURCE_TOPICS.filter((t) => {
    const u = findSameStory(t, _mine);
    if (u) {
      t._update = u; _updates++;
      console.log(`  ↻ UPDATE (one story = one URL): "${(t.title || "").slice(0, 62)}" → /${u.category}/${u.slug}/ (${u.why})`);
      return true; // proceed through the pipeline; the write step merges instead of creating a new slug
    }
    const d = findDuplicate(t, _recent);
    if (d) { console.log(`  ⏭ dup-story skip: "${(t.title || "").slice(0, 70)}" ≈ published "${d.slug}" (shared: ${d.shared.slice(0, 5).join(", ")})`); return false; }
    // PER-ENTITY DAY CAP (scale-up 2026-07-16): defer a topic whose entity already has ≥4 articles in 24h — the
    // measured professional ceiling (even Variety caps one film at ~3-4/day in its biggest release week). The topic
    // stays in the queue and becomes eligible again as the 24h window rolls.
    const cap = entityDayCap(t, _recent);
    if (cap) { console.log(`  ⏸ entity day-cap: "${(t.title || "").slice(0, 70)}" — ${cap.count} article(s) on this entity in 24h (cap ${cap.cap}; e.g. ${cap.sample.join(", ")})`); return false; }
    return true;
  });
  if (_n1 !== SOURCE_TOPICS.length || _updates) console.log(`  dup guard: ${_n1 - SOURCE_TOPICS.length} duplicate/capped topic(s) dropped → ${SOURCE_TOPICS.length} publishable (${_updates} routed to in-place UPDATE)`);
  // PACING BAR (Phase 4): the scheduler passes the day's adaptive quality bar — topics scoring below it wait for
  // a richer moment (or the bar to relax). Breaking topics are exempt (they pre-cleared the governor's gate).
  const PACE_BAR = Number(process.env.PACE_BAR || 0);
  if (PACE_BAR > 0) {
    const _n2 = SOURCE_TOPICS.length;
    SOURCE_TOPICS = SOURCE_TOPICS.filter((t) => t.breaking || !Number.isFinite(t.priority) || t.priority >= PACE_BAR);
    if (_n2 !== SOURCE_TOPICS.length) console.log(`  pacing bar ${PACE_BAR}: ${_n2 - SOURCE_TOPICS.length} below-bar topic(s) held → ${SOURCE_TOPICS.length} eligible`);
  }
}
let topics = ONLY ? SOURCE_TOPICS.filter((t) => t.id === ONLY) : SOURCE_TOPICS;
if (LIMIT) topics = topics.slice(0, LIMIT);
const BASE_ARG = (process.argv.find((a) => a.startsWith("--base=")) || "").split("=")[1];
const BASE = BASE_ARG ? new Date(BASE_ARG).getTime() : Date.now(); // real publish time in production; override with --base=<ISO>
// TRUST MODEL (owner 2026-07-04, NEWS_AUTOMATION_SPEC §3): sourcing from a top trade means the story is ALREADY
// verified — the outlet IS ground truth. We faithfully reproduce it and NEVER independently re-check it against the
// web (the Sonar web-check is removed). Accuracy enforcement = FIDELITY to the source (the gate trims any checkable
// specific the writer added beyond the source), never a hold.
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS) || 2; // generate→gate passes; attempt 2 only tightens format / trims strays

// (cutStrays moved to lib/cutter.mjs as cutArticle — 2026-07-03: ONE cutter now edits body AND
// keyTakeaways/FAQ/structured fields, closing the flagged-claim-survives-in-frontmatter hole.)

// Deterministic frontmatter tags from the topic (2026-07-03 strip: replaces the per-attempt classify() LLM call
// whose only SURVIVING output was 3-6 tags — its category/subcategory/formatTag were always overwritten by the
// topic's authoritative values right after it ran).
const deriveTags = (topic) => [...new Set(
  [topic.primaryKeyword, topic.primaryEntity, ...(topic.entities || [])]
    .filter(Boolean)
    .map((t) => String(t).toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim())
    .filter((t) => t.length >= 2)
)].slice(0, 6);
// Production judge (config.MODELS.judge = gemini-2.5-flash, a CHEAP-tier model) — NEVER Opus/premium (owner hard
// rule; would blow the budget). GATE_JUDGE may override ONLY to a model on the cheap allowlist below; a premium id
// is rejected, so the no-Opus rule is mechanically un-bypassable.
const JUDGE_ALLOW = new Set([MODELS.judge, MODELS.verify, ...(MODELS.judgeFallbacks || []), "google/gemini-2.5-flash-lite", "openai/gpt-4.1-mini"]);
const judge = (process.env.GATE_JUDGE && JUDGE_ALLOW.has(process.env.GATE_JUDGE)) ? process.env.GATE_JUDGE : MODELS.judge;

// Deterministic, accurate release-date string for the trailer module (never model-generated).
function fmtRelease(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

// PROCESS ONE TOPIC — extracted from the old sequential for-loop (2026-07-03) so a CONCURRENCY POOL can run
// several topics at once: the biggest speed win, with ZERO change to how any single article is written/verified/
// scored (quality is untouched — only the schedule changes). Safe because recordPublished + the state/.md writes
// are all SYNCHRONOUS = atomic under Node's single thread, so parallel topics never corrupt the shared ledger.
async function processTopic(topic, i) {
  // 1-MINUTE stagger keeps a stable feed order within a batch WITHOUT backdating (the old 3h-per-index stagger
  // dated article #6 fifteen hours before the run — misrepresenting freshness on a breaking-news site).
  const dateISO = new Date(BASE - i * 60 * 1000).toISOString();
  const rec = { id: topic.id, slug: topic.slug, status: "started", stages: {} };
  const t0 = Date.now();
  try {
    console.log(`\n=== [${i + 1}/${topics.length}] ${topic.title} ===`);
    topic.facts = await gatherFacts(topic); // NON-Wikipedia typed grounding (person→TMDB bio, music→Deezer)
    console.log(`  facts: ${topic.facts.length} block(s)`);
    // Give the writer the REAL current month so streaming "as of …" is dated, not a placeholder/guess.
    const NOW_LABEL = new Date(BASE).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    topic.facts.push({ title: "CURRENT DATE", extract: `Today is ${NOW_LABEL}. Any "as of" availability phrasing must read exactly "as of ${NOW_LABEL}". Never invent a different month/year.` });

    // FIND v2 breaking news: the EVENT isn't on Wikipedia yet (Wikipedia gave us the ENTITY identity only).
    // Ground the writer on the corroborated SOURCE facts + the verification label, so it re-reports the
    // event in our words with honest attribution and never invents details beyond what was reported.
    const v = topic.verification;
    if (v && topic.sources?.length && v.status !== "EVERGREEN") {
      const srcFacts = topic.sources.map((s) => `• ${s.headline}${s.summary ? " — " + s.summary : ""} (reported by ${s.outlet})`).join("\n");
      const frame =
        v.framing === "rumor-safe"
          ? `UNCONFIRMED RUMOR — attribute to ${v.attribution} with cautious wording ("reportedly", "according to ${v.attribution}"); NEVER state as established fact.`
          : v.framing === "attributed"
          ? `DEVELOPING — attribute the core claim in words to ${v.attribution} (e.g. "according to ${v.attribution}"); do NOT present it as independently confirmed.`
          : `CONFIRMED by multiple outlets — you may state it plainly.`;
      topic.facts.unshift({
        title: `BREAKING EVENT FACTS (${v.status}) — these are the ONLY event details you may report; if a detail is not here, do NOT state it. ${frame} Attribute by NAME only; do NOT hyperlink the reporting outlet or any competitor outlet.`,
        extract: srcFacts,
      });
      console.log(`  breaking: ${v.status}${v.attribution ? ` (via ${v.attribution})` : ""} · ${topic.sources.length} source(s) injected`);
    }

    // CONTENT FINDER (rebuild Step 2→4): gather the FULL source-article TEXT + on-the-record QUOTES for this
    // trending topic (free: seed URLs + GDELT real-URL artlist → article-extractor/Jina) so the writer works from
    // the REAL reporting, not thin RSS summaries — and stash the tiered bundle on topic._bundle for the verify gate.
    try {
      const cf = await findContent({
        primaryEntity: topic.primaryEntity, title: topic.title, query: topic.primaryKeyword || topic.title,
        // Pass FIND's full sources[] (outlet+tier+url+summary): the finder uses the inline summary text directly
        // AND extracts the real article body from the url, so the writer always has real reporting (Phase A).
        sources: topic.sources || [],
      });
      // (corroborate defaults FALSE — trust-the-source: extract ONLY the top outlet's own article, no gnews/GDELT.)
      if (!cf.blocked && cf.sources?.length) {
        topic._bundle = cf;
        const srcText = cf.sources.map((s) => `[${s.domain || s.owner} · ${s.tier}]\n${s.text}${s.quotes?.length ? "\nON-THE-RECORD QUOTES: " + s.quotes.map((q) => `"${q}"`).join(" | ") : ""}`).join("\n\n");
        topic.facts.unshift({
          title: `GATHERED SOURCE REPORTING (${cf.sources.length} outlets · ${cf.independentOwners?.length || 0} independent · ${cf.majorCount || 0} major${cf.inlineCount ? ` · ${cf.extractedCount} full-text + ${cf.inlineCount} summary` : ""}) — your PRIMARY material; write ONLY what these sources say, and quote ONLY the ON-THE-RECORD QUOTES shown, verbatim.${cf.singleSource ? " ⚠ SINGLE SOURCE: only ONE outlet corroborates this — stick to its EXACT wording. Do NOT interpret or infer who-does-what (roles/casting), numbers, or dates beyond what it literally states; if the source is ambiguous about a specific, stay general rather than guess (a confident wrong guess is fake news)." : ""}`,
          extract: srcText.slice(0, 14000),
        });
        console.log(`  content finder: ${cf.sources.length} sources · ${cf.independentOwners?.length || 0} owners · ${cf.totalQuotes || 0} quotes${cf.inlineCount ? ` (${cf.extractedCount} full-text, ${cf.inlineCount} summary)` : ""} · ${cf.trusted ? "trusted" : "single/untrusted → attributed framing"}`);
      } else {
        console.log(`  ⚠ content finder: ${cf.blocked ? "BLOCKED (" + cf.reason + ")" : "no sources"} — grounding on structured facts only`);
      }
    } catch (e) {
      console.log("  ⚠ content finder error:", e.message);
    }

    // ── EDITORIAL GATE (Stage 3.5, 2026-07-03 — the gossip automation's wrong-subject killer, news-scoped).
    // An LLM editor reads the ACTUAL gathered text and OVERRIDES the discovery guesses: is this even ONE current
    // news event (reject power); the TRUE primary subject; the precise WORK (title/year/medium — feeds the
    // year-hinted TMDB resolve below, the ROOT fix for the Spartacus same-name class); the outlet that REALLY
    // reported it; confirmed/official/denied/unconfirmed; and a clean event summary for the writer's lede.
    // FAIL-SAFE: on any gate error the pipeline proceeds exactly as before. (Corrections land BEFORE the
    // structured grounding + form branches below, so they steer the right grounding.)
    let editorial = null;
    if (topic._bundle) {
      editorial = await editorialGate({ topic, bundle: topic._bundle });
      if (editorial.reject) {
        rec.status = "rejected_editorial"; rec.holdReason = `editorial gate: ${editorial.reason}`;
        console.log(`  ⛔ EDITORIAL REJECT: ${editorial.reason}`);
        rec.ms = Date.now() - t0;
        const sf = path.join(STATE, topic.id + ".json");
        try { const prev = JSON.parse(fs.readFileSync(sf, "utf8")); const { previousRuns, ...prevRec } = prev; rec.previousRuns = [...(previousRuns || []).slice(-4), prevRec]; } catch { /* first run */ }
        fs.writeFileSync(sf, JSON.stringify(rec, null, 2));
        return rec;
      }
      if (editorial.ran) {
        // WRONG-WORK REJECTION (root-fix 2026-07-17, the Runner-as-TV-series case): the gate once "corrected"
        // a Gal Gadot film topic to entity/work "Army of Shadows" medium=tv — a DIFFERENT queue story — and the
        // wrong medium cascaded into category/about/seriesContext. A correction is only trustworthy when it
        // shares at least one significant token with the topic's own title/entity; otherwise it is contamination.
        const _sig = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|for|with|new|from)$/.test(w));
        const _topicToks = new Set([..._sig(topic.title), ..._sig(topic.primaryEntity)]);
        const _related = (s) => _sig(s).some((w) => _topicToks.has(w));
        if (editorial.primaryEntity && !_related(editorial.primaryEntity) && !(editorial.work?.title && _related(editorial.work.title))) {
          console.log(`  ✋ editorial correction REJECTED as unrelated to the topic: entity "${editorial.primaryEntity}" / work "${editorial.work?.title}" share 0 tokens with "${topic.title?.slice(0, 60)}"`);
          editorial.primaryEntity = null; editorial.work = null; editorial.coSubjects = null;
        }
        if (editorial.primaryEntity && editorial.primaryEntity.toLowerCase() !== (topic.primaryEntity || "").toLowerCase()) {
          console.log(`  ✎ editorial: subject corrected "${topic.primaryEntity}" → "${editorial.primaryEntity}"`);
          topic._entityBefore = topic.primaryEntity;
          topic.primaryEntity = editorial.primaryEntity;
        }
        if (editorial.coSubjects?.length) topic.entities = [...new Set([...(editorial.coSubjects || []), ...(topic.entities || [])])];
        // Attribution = the outlet the TEXT shows actually reported it (never the aggregator that echoed it).
        if (editorial.reportingOutlet && topic.verification && topic.verification.attribution && topic.verification.attribution !== editorial.reportingOutlet) {
          console.log(`  ✎ editorial: attribution "${topic.verification.attribution}" → "${editorial.reportingOutlet}"`);
          topic.verification.attribution = editorial.reportingOutlet;
        }
        // Form/category by what the story IS (canonicalize keeps the news-only invariant + a legal subcategory).
        if ((editorial.form && editorial.form !== topic.formatTag) || (editorial.category && editorial.category !== topic.category)) {
          console.log(`  ✎ editorial: filed ${topic.category}/${topic.formatTag} → ${editorial.category || topic.category}/${editorial.form || topic.formatTag}`);
          if (editorial.form) topic.formatTag = editorial.form;
          if (editorial.category) topic.category = editorial.category;
          canonicalize(topic);
        }
        if (editorial.status === "denied")
          topic.facts.unshift({ title: "⚠ THE CLAIM IS DENIED (per the gathered text)", extract: "The gathered reporting shows the core claim is DENIED. The story is the denial itself — report claim + denial with attribution; never present the denied claim as fact." });
        if (editorial.eventSummary)
          topic.facts.unshift({ title: "EDITORIAL EVENT SUMMARY (what happened, per the gathered text — your lede's spine)", extract: editorial.eventSummary });
        rec.editorial = { status: editorial.status, entity: topic.primaryEntity, work: editorial.work, outlet: editorial.reportingOutlet };
      }
    }

    // AUTHORITATIVE STRUCTURED FACTS (the Wikipedia-free spine, 2026-06-28). For any topic centered on a
    // FILM/TV TITLE, ground on TMDB structured facts (credits/typed dates/providers/OTT) + OMDb EXACT ratings
    // & box office, placed FIRST so they are the writer's source of truth and the judge's deterministic diff
    // target (stashed on topic._titleFacts / topic._omdb for PR3). This replaces Wikipedia reception/box-office.
    const TITLE_FORMS = new Set(["review", "box-office", "trailer", "explainer", "list", "guide", "watchguide", "reaction", "recap", "screen-music"]);
    const titleCentric = TITLE_FORMS.has(topic.formatTag) ||
      (["movies", "tv", "reviews", "streaming"].includes(topic.category) && topic.formatTag === "news");
    if (titleCentric) {
      // EDITORIAL WORK HINT (the Spartacus root fix): resolve the WORK the gathered text actually describes —
      // title + year + medium from the editorial gate — instead of a popularity-ranked name search that returns
      // the most famous same-named work. The consistency gate below stays as the deterministic backstop.
      const wk = editorial?.work;
      const tf = await getTitleFacts(
        wk?.title || topic.primaryEntity,
        wk?.medium || topic.tmdbType || (topic.category === "tv" ? "tv" : "movie"),
        wk?.year || null
      );
      // CONSISTENCY GATE (2026-07-03, Spartacus fix): TMDB matches by NAME only and can resolve the WRONG same-named
      // work (the 1960 Kirk Douglas FILM for a 2010-TV-series story). If the resolved title is OLD and NONE of its
      // year / director / cast is corroborated anywhere in the gathered source reporting, it is a DIFFERENT work — DROP
      // it rather than inject a different work's cast/year/ratings as "authoritative" (the root of the Spartacus mess).
      let tfOk = !!tf;
      if (tf) {
        const srcText = [...((topic._bundle?.sources || []).map((s) => s.text || "")), ...((topic.sources || []).map((s) => `${s.headline || ""} ${s.summary || ""}`))].join(" ").toLowerCase();
        const cues = [tf.year, tf.director, ...((tf.cast || []).slice(0, 4).map((c) => c && c.name))].filter(Boolean).map((x) => String(x).toLowerCase());
        const corroborated = !srcText || cues.some((c) => c.length > 3 && srcText.includes(c));
        const yr = Number(String(tf.year || "").slice(0, 4));
        const stale = yr && (new Date(BASE).getUTCFullYear() - yr) > 2; // an OLD resolved title for a fresh news story = name-collision red flag
        if (stale && !corroborated) { tfOk = false; console.log(`  ⚠ authoritative DROPPED: TMDB "${tf.title}" (${tf.year}) not corroborated in the gathered reporting — likely a same-name mismatch; grounding on source reporting only`); }
      }
      if (tf && tfOk) {
        topic._titleFacts = tf;
        topic.facts.unshift({ title: "AUTHORITATIVE TITLE FACTS", extract: titleFactBlock(tf) });
        if (tf.imdbId) {
          const o = await omdb(tf.imdbId);
          if (o) { topic._omdb = o; const b = omdbFactBlock(o); if (b) topic.facts.unshift({ title: "AUTHORITATIVE RATINGS & BOX OFFICE", extract: b }); }
        }
        console.log(`  authoritative: TMDB "${tf.title}" (imdb ${tf.imdbId || "—"})${topic._omdb ? ` · OMDb RT ${topic._omdb.ratings.rt?.value || "—"} MC ${topic._omdb.ratings.metacritic?.value || "—"}` : ""}${tf.isOTT ? " · STREAMING-ORIGINAL (no box office)" : ""}`);
      } else {
        console.log("  ⚠ no TMDB title match for authoritative facts");
      }
    }

    // Trailer niche: pull the official YouTube trailer + verified film context from TMDB.
    let trailer = null;
    if (topic.formatTag === "trailer") {
      trailer = await getTrailer(topic.primaryEntity || topic.title, topic.tmdbType || "movie");
      if (trailer?.youtubeId) {
        topic.facts.push({ title: "TRAILER + FILM CONTEXT (TMDB, verified — use ONLY this; you have NOT watched the trailer)", extract: trailerFactBlock(trailer) });
        console.log(`  TMDB trailer: ${trailer.youtubeId} — ${trailer.title} (${trailer.year})`);
      } else {
        console.log("  ⚠ no TMDB trailer found for this title");
      }
    }

    // Reaction niche: fetch + cache the real public X posts; their text grounds the consensus synthesis.
    let reactionTweets = null;
    if (topic.formatTag === "reaction" && topic.tweetIds?.length) {
      const { tweets, ids } = await cacheTweets(topic.tweetIds);
      reactionTweets = { tweets, ids };
      if (tweets.length) {
        topic.facts.push({ title: "AUDIENCE REACTIONS (real public X posts — synthesize ONLY from these)", extract: reactionFactBlock(tweets) });
        console.log(`  cached ${tweets.length}/${topic.tweetIds.length} reaction posts`);
      } else {
        console.log("  ⚠ no reaction posts resolved");
      }
    }

    // Box-office niche: verified worldwide gross + budget from TMDB (the model must not invent figures).
    let boxoffice = null;
    if (topic.formatTag === "box-office") {
      boxoffice = await getBoxOffice(topic.primaryEntity || topic.title);
      if (boxoffice?.worldwide) {
        topic.facts.push({ title: "BOX OFFICE (TMDB, verified — use these EXACT figures)", extract: boxOfficeFactBlock(boxoffice) });
        console.log(`  TMDB box office: ${boxoffice.worldwide} ww / ${boxoffice.budget} budget`);
      } else {
        console.log("  ⚠ no TMDB box-office figures found");
      }
      // (Detailed box-office splits/records now come from OMDb domestic + TMDB worldwide in the AUTHORITATIVE
      // block above — exact figures keyed by IMDb id — replacing the scraped Wikipedia box-office prose.)
    }

    // Awards-family niches: ground on AUTHORITATIVE, NON-Wikipedia winners (PR5, owner rule 2026-06-28) —
    // the OFFICIAL Academy Awards Database (committed cache) for the Oscars, the first-party Golden Globes /
    // Emmys endpoints otherwise. Stashed on topic._awards for the deterministic winner-diff in verifyEngine.
    // Ceremonies with no first-party structured source (Grammys/BAFTA/Critics Choice) ground on the attributed
    // trade-RSS already in topic.facts — NEVER on Wikipedia. This replaces the stripped-table Wikipedia scrape
    // that was the root of the 97th-Oscars fabrication.
    if (["awards", "music-awards", "predictions"].includes(topic.formatTag)) {
      const aw = await getAuthoritativeAwards(topic);
      if (aw && aw.categories?.length) {
        topic._awards = aw;
        topic.facts.unshift({ title: "AUTHORITATIVE AWARDS WINNERS", extract: awardsFactBlock(aw) });
        console.log(`  authoritative awards: ${aw.show} (${aw.source}) · ${aw.categories.length} categories`);
      } else {
        console.log("  ⚠ no first-party awards source for this ceremony — grounding on attributed trade sources only (no Wikipedia)");
      }
    }
    // (Music grounding is now handled by groundFacts: music-profile/music-news ground on Deezer catalog;
    // screen-music grounds on the screen work's AUTHORITATIVE TITLE FACTS block. No Wikipedia music section.
    // Chart positions / certifications / music awards stay qualitative until PR6 wires MusicBrainz/Discogs/Last.fm.)

    // PROFILE niche: the dated filmography (TMDB) + biography were already grounded by groundFacts
    // (topic._person). Reuse the credits for the structured-field overwrite, and add the person's Oscar
    // history from the OFFICIAL Academy DB (the non-Wikidata replacement — WON vs NOMINATED stays exact).
    let personCredits = topic.formatTag === "profile" ? (topic._person?.credits || null) : null;
    if (topic.formatTag === "profile") {
      const pa = personAwards(topic.primaryEntity);
      const pab = personAwardsBlock(topic.primaryEntity, pa);
      if (pab) { topic.facts.push({ title: "AUTHORITATIVE OSCAR HISTORY", extract: pab }); console.log(`  Oscar history: ${pa.wins.length} wins, ${pa.noms.length} noms`); }
    }

    // (RT/Metacritic reception now comes from OMDb in the AUTHORITATIVE RATINGS block above — exact current
    // scores keyed by IMDb id — replacing the stale/approx Wikipedia "Reception" prose that caused the
    // RT 90%-vs-86% fabrication. Wikipedia is no longer scraped for scores.)

    // Interview niche: pull the official video's TRANSCRIPT (yt-dlp, subs only) to ground an ORIGINAL summary.
    let interview = null;
    if (topic.formatTag === "interview") {
      let vid = topic.youtubeId ? { id: topic.youtubeId, title: "", channel: "" } : (await searchInterview(topic.interviewQuery || `${topic.primaryEntity} interview`))[0];
      if (vid?.id) {
        const [oe, transcript] = await Promise.all([oEmbed(vid.id), fetchTranscript(vid.id)]);
        if (transcript) {
          const video = { id: vid.id, title: oe?.title || vid.title || `${topic.primaryEntity} interview`, channel: oe?.author_name || vid.channel || "" };
          interview = { youtubeId: vid.id, sourceOutlet: video.channel, sourceUrl: `https://www.youtube.com/watch?v=${vid.id}` };
          topic.facts.push({ title: "INTERVIEW (official video embedded; transcript = grounding for an ORIGINAL summary)", extract: interviewFactBlock({ video, transcript }) });
          console.log(`  interview: ${vid.id} — "${video.title}" (${video.channel}), transcript ${transcript.length} chars`);
        } else {
          console.log("  ⚠ no usable transcript for the interview video");
        }
      } else {
        console.log("  ⚠ no interview video found");
      }
    }

    // Streaming guides: ground on LIVE TMDB data so they never guess platforms.
    let wtw = null;
    if (topic.provider) {
      // "Best on <platform>": discover the real top-rated films on that provider → a substantial, accurate pool to rank.
      const disc = await discoverTop(topic.provider, "US", 12);
      if (disc.titles?.length) {
        topic.facts.push({ title: `BEST ON ${topic.provider}`, extract: discoverFactBlock(disc) });
        wtw = disc.titles.map((t) => ({ title: t.title, year: t.year, type: "movie", providers: { stream: [topic.provider], rent: [], buy: [] } }));
        topic.facts.push({ title: "WHERE TO WATCH — CURRENT US AVAILABILITY (TMDB, verified)", extract: factBlock(wtw) });
        console.log(`  TMDB discover: ${disc.titles.length} films on ${topic.provider}`);
      }
    } else if (topic.category === "streaming" || /guide|where/i.test(topic.contentType || "")) {
      wtw = await getWhereToWatch(topic.entities || []);
      if (wtw?.length) {
        topic.facts.push({
          title: "WHERE TO WATCH — CURRENT US AVAILABILITY (TMDB, verified — use ONLY this for any platform/availability claim)",
          extract: factBlock(wtw),
        });
        console.log(`  TMDB where-to-watch: ${wtw.length} titles`);
      }
    }

    let article, classification, image, scored, pass = false, corrections = null;
    const RUN_JUDGE = process.env.RUN_JUDGE === "1"; // paid quality judge OFF by default (cost) — QA opt-in only

    // Attach the DETERMINISTIC, system-owned structured fields the writer must NEVER author (verified TMDB/OMDb
    // figures, the official embed ids, the reaction tweet ids). Re-run after every generate so a retry can't drop them.
    const attachStructured = () => {
      if (wtw?.length) article.whereToWatch = toWhereToWatch(wtw);
      if (trailer?.youtubeId) { article.youtubeId = trailer.youtubeId; article.releaseInfo = fmtRelease(trailer.releaseDate); }
      if (reactionTweets?.ids?.length) article.tweetIds = reactionTweets.ids;
      if (interview) { article.youtubeId = interview.youtubeId; article.sourceOutlet = interview.sourceOutlet; article.sourceUrl = interview.sourceUrl; }
      if (boxoffice?.worldwide) article.boxOffice = { ...(article.boxOffice || {}), worldwide: boxoffice.worldwide, budget: boxoffice.budget };
      if (personCredits?.length) article.filmography = personCredits.map((c) => ({ year: c.year, title: c.title, role: c.character, type: c.type }));
    };

    // ── WRITE (faithful rewrite) → FIDELITY GUARD (2026-07-04, NEWS_AUTOMATION_SPEC §3). The writer works ONLY from
    // the injected REFERENCE FACTS (the top outlet's own reporting + the AUTHORITATIVE TMDB/OMDb figures); the guard
    // trims any checkable specific it introduced beyond the source. NO Sonar, NO padding, NO accuracy holds — a
    // faithful brief (short if the source is thin) is a valid article. Attempt 2 (only if needed) tightens format or
    // re-grounds a stray; whatever remains publishes (strays are trimmed after the loop).
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      ({ article } = await generate({ topic, model: MODELS.generator, corrections, previousArticle: attempt > 1 ? article : null }));
      attachStructured();
      // CLASSIFICATION is TOPIC-derived (a FIND/seed topic carries the authoritative category/subcategory/formatTag);
      // tags derive deterministically. The LLM classifier runs ONLY for a legacy topic with no categorization, once.
      if (!classification) {
        if (topic.category && topic.subcategory) classification = { category: topic.category, subcategory: topic.subcategory, formatTag: topic.formatTag || "news", tags: deriveTags(topic) };
        else { classification = await classify({ article, topic, model: MODELS.classifier }); if (!classification.tags?.length) classification.tags = deriveTags(topic); }
        canonicalize(classification); // NEWS-ONLY chokepoint: clamp to the 8 news forms + a news silo
      }
      scored = await gate({ article, topic, judgeModel: judge, runJudge: RUN_JUDGE });
      const embedMissing = (topic.formatTag === "trailer" && !article.youtubeId) || (topic.formatTag === "reaction" && !article.tweetIds?.length);
      // Retry ONCE only to IMPROVE — a format nit (missing FAQ / keyword-not-in-title / dense), a stray to re-ground,
      // or a missing required embed. Never a hard failure: whatever remains after the final attempt publishes.
      const needsRetry = attempt < MAX_ATTEMPTS && (scored.formatBlocks.length > 0 || scored.cutClaims.length > 0 || embedMissing);
      corrections = needsRetry
        ? ([scored.corrections, scored.formatBlocks.length ? "Also tighten these (keep the voice + engagement; add NOTHING not in the sources): " + scored.formatBlocks.join("; ") : ""].filter(Boolean).join("\n").trim() || null)
        : null;
      rec.stages[`attempt${attempt}`] = { score: scored.score, cat: `${classification.category}/${classification.subcategory}`, format: scored.formatBlocks, cuts: scored.cutClaims.length, broken: scored.brokenHold };
      console.log(`  attempt ${attempt}: ${scored.score != null ? `score ${scored.score} ` : ""}[${classification.category}/${classification.subcategory}] fidelity-cuts:${scored.cutClaims.length} format-nits:${scored.formatBlocks.length}${scored.brokenHold.length ? ` ⛔BROKEN:${scored.brokenHold.join(";")}` : ""}`);
      if (!needsRetry) break;
    }
    // FIDELITY TRIM (never a hold): delete any checkable specific the writer added beyond the source — from the body
    // AND takeaways/FAQ/structured fields (the ONE cutter) — and publish the faithful remainder. With the faithful
    // writer this is usually a no-op; when it fires it removes exactly the kind of invented figure that used to ship.
    if (!DRY && scored.cutClaims.length) {
      const { cut, fieldCuts } = cutArticle(article, scored.cutClaims);
      if (cut + fieldCuts > 0) { article.body = trimIncomplete(dedupeSentences(article.body)); console.log(`  ✂ fidelity trim: removed ${cut} sentence(s) + ${fieldCuts} field item(s) not found in the source`); }
    }

    // PUBLISHABILITY — accuracy NEVER holds (the piece is faithful-by-construction + trimmed). The only holds are a
    // genuinely broken article (no title / garbled / prompt-leak), a niche whose required embed is missing, or a body
    // trimmed below a real-article floor. (No hero image → held at the last-mile image step below.)
    const embedMissing = (topic.formatTag === "trailer" && !article.youtubeId) || (topic.formatTag === "reaction" && !article.tweetIds?.length);
    const bodyWords = (article.body || "").split(/\s+/).filter(Boolean).length;
    pass = scored.brokenHold.length === 0 && !embedMissing && bodyWords >= 80;
    if (!pass) rec.holdReason = scored.brokenHold.length ? `broken article: ${scored.brokenHold.join("; ")}` : embedMissing ? `${topic.formatTag}: required embed missing` : `body too short after trim (${bodyWords}w)`;

    // FINAL POLISH (deterministic, before assemble): collapse duplicated sentences and trim any truncated/
    // cut-orphaned fragment — can never add a fact.
    if (pass && article?.body) article.body = dropOrphanHeadings(trimIncomplete(dedupeSentences(article.body)));

    // ── HERO IMAGE — LAST MILE (2026-07-03, audit D9: previously picked BEFORE the gate, so og:image fetches +
    // the vision call + measure downloads were fully wasted on every held article — 4/6 in the last run). Picked
    // ONLY for an article that has passed every gate, keyed by the EDITORIAL-CORRECTED entity. Policy unchanged
    // (owner 2026-07-01, gossip-parity): source outlet og:image (the real on-topic story photo) → cinematic TMDB
    // stills, vision-ranked → Wikimedia Commons last resort; HOTLINKED (measured remotely, never re-hosted);
    // >=1200px Discover floor; landscape preferred. A passed article with NO image on any ladder still HOLDS.
    // ONE STORY = ONE URL: an in-place UPDATE keeps the published article's hero (updateArticle.PRESERVE), so the
    // whole ladder — og:image fetch, vision ranking, remote measures — would be paid for and then discarded. REUSE
    // the existing hero instead: it satisfies assemble()'s image contract (a bare `image: undefined` makes YAML
    // dumping throw) and mergeUpdate re-freezes the same values, so nothing on the live page actually changes.
    if (pass && topic._update) {
      if (topic._update.image) image = { image: topic._update.image, imageWidth: topic._update.imageWidth, imageHeight: topic._update.imageHeight, credit: topic._update.imageCredit || "Wikimedia Commons" };
      else { pass = false; rec.holdReason = "update target has no stored hero image"; console.log("  ⛔ HELD: update target missing hero — cannot merge safely"); }
    } else if (pass) {
      const isTitleStory = ["movies", "tv", "streaming"].includes(topic.category) || ["box-office", "trailer", "watchguide", "reaction"].includes(topic.formatTag);
      // For a TITLE story, search the image by the REAL WORK (the resolved TMDB title / editorial work), never the
      // editorial-corrected PERSON entity — that grabbed a wrong same-name cooking show's chef for the Silo story.
      const titleForImage = topic._titleFacts?.title || editorial?.work?.title || topic._entityBefore || null;
      const hero = await pickHeroImage({ topic, article, bundle: topic._bundle, isTitleStory, titleOverride: titleForImage }).catch(() => null);
      const take = (cand, dims) => { image = { image: cand.url, imageWidth: dims.imageWidth, imageHeight: dims.imageHeight, credit: cand.credit }; if (cand.alt) article.imageQuery = cand.alt; };
      if (hero?.candidates?.length) {
        let portrait = null; // first passing-but-portrait candidate, used only if no landscape clears the gate
        for (const cand of hero.candidates) {
          const dims = await measureRemote(cand.url).catch(() => null);
          if (!dims || dims.imageWidth < 1200) continue; // Discover floor
          if (dims.imageWidth >= dims.imageHeight) { take(cand, dims); console.log(`  image: ${cand.kind} landscape ${dims.imageWidth}x${dims.imageHeight} (best of ${hero.candidateCount}${hero.score != null ? `, vision ${hero.score}` : ""}) — ${hero.why}`); break; }
          if (!portrait) portrait = { cand, dims };
        }
        if (!image && portrait) { take(portrait.cand, portrait.dims); console.log(`  image: ${portrait.cand.kind} portrait ${portrait.dims.imageWidth}x${portrait.dims.imageHeight} (no landscape candidate)`); }
      }
      // LAST-RESORT fallback — a free Wikimedia Commons photo of the subject (also hotlinked + measured), so a
      // VERIFIED article is only dropped for lack of an image when EVERY ladder truly produced nothing.
      if (!image) {
        const imgCandidates = [...new Set([
          article.imageQuery, topic.primaryEntity, ...(topic.entities || []), ...(trailer ? [trailer.director, ...(trailer.cast || [])] : []),
        ].filter(Boolean))];
        for (const cq of imgCandidates) {
          const wsrc = await sourceImage(cq); if (!wsrc) continue;
          const dims = await measureRemote(wsrc.downloadUrl).catch(() => null);
          if (dims && dims.imageWidth >= 1200) { image = { image: wsrc.downloadUrl, imageWidth: dims.imageWidth, imageHeight: dims.imageHeight, credit: wsrc.credit }; console.log(`  image: Wikimedia Commons fallback ${dims.imageWidth}x${dims.imageHeight}`); break; }
        }
      }
      if (!image) {
        pass = false;
        rec.holdReason = "no >=1200px hero image sourced (og:image + TMDB + Commons all failed)";
        console.log("  ⛔ HELD: no >=1200px hero image on any ladder");
      }
    }
    rec.scorecard = { score: scored.score, subscores: scored.subscores, strengths: scored.strengths, weaknesses: scored.weaknesses, deterministic: scored.deterministic, hardBlocks: scored.hardBlocks };
    let auditBody = article.body, internalLinks = [];
    if (pass) {
      // HARD TARGET CAP (2026-07-17): with CONCURRENCY>1, in-flight topics used to complete PAST the target
      // (allow 2 → published 3, four times in the first 12h) — the write itself is now the atomic gate.
      if (TARGET && writtenCount >= TARGET) {
        rec.status = "deferred"; rec.deferReason = "target-reached (in-flight overshoot guard)";
        console.log(`  ⏸ deferred (target ${TARGET} already written): ${topic.title?.slice(0, 60)}`);
        return rec;
      }
      writtenCount++;
      const out = assemble({ article, classification, image, topic, dateISO });
      auditBody = out.body; internalLinks = out.internalLinks || [];
      // ONE STORY = ONE URL: when this topic was matched to an article we already published, merge the fresh facts
      // into THAT file (identity fields frozen, dateModified stamped) instead of writing a second slug. A null merge
      // means the target became unreadable — fall through and publish normally rather than lose the development.
      const merged = topic._update ? mergeUpdate({ file: path.join(ART, topic._update.file), out, nowISO: new Date().toISOString() }) : null;
      if (topic._update && !merged) console.log(`  ⚠ update target unreadable (${topic._update.slug}) — publishing as a new article instead`);
      // ANTI-CHURN: the target was refreshed very recently. Do NOT publish a second URL as a consolation —
      // that is precisely what this policy forbids. Drop the topic; it stays eligible once the cooldown clears.
      if (merged?.skipped) {
        writtenCount--;
        rec.status = "deferred";
        rec.deferReason = `update cooldown (${merged.slug} refreshed ${merged.ageH.toFixed(1)}h ago < ${merged.cooldownH}h)`;
        console.log(`  ⏸ update cooldown: /${topic._update.category}/${merged.slug}/ was refreshed ${merged.ageH.toFixed(1)}h ago — deferring (no second URL)`);
        return rec;
      }
      const upd = merged;
      if (!DRY) {
        // UPDATE writes to the EXISTING slug; a normal publish writes the new one. Everything downstream
        // (ledger record, status, audit, state file) is shared — only the destination and the keys differ.
        fs.writeFileSync(path.join(ART, (upd ? upd.slug : out.slug) + ".md"), upd ? upd.md : out.md);
        // DEDUP LEDGER: record the story so FIND never re-processes/re-publishes it (owner: no dupes = save credits +
        // protect Google trust + keep the feed fresh). Keyed by eventSlug (cross-outlet), the title slug, AND the
        // robust primaryEntity+eventType key (catches a story whose headline drifts across runs — the KVIFF bug).
        // On an UPDATE the NEW event keys are recorded against the SAME slug, so the next tick recognises this
        // development as already covered instead of re-opening it.
        // + the VIDEO-FEED fields (Reels automation): source URLs for the image-gatherer, priority/signals for the
        // top-10 picker, hero image + category for frame filler/diversity — lost otherwise (queue.json is overwritten).
        recordPublished({
          eventSlug: topic.eventSlug, titleKey: slugKey(topic.title), primaryEntity: topic.primaryEntity, eventType: topic.eventType,
          slug: upd ? upd.slug : out.slug, title: upd ? upd.frontmatter.title : topic.title,
          sourceUrls: (topic.sources || []).map((s) => s?.url).filter(Boolean),
          priority: topic.priority, signals: topic.signals,
          image: (upd ? upd.frontmatter.image : image?.image) || null,
          category: upd ? upd.frontmatter.category : classification.category,
          verifyStatus: topic.verification?.status || null,
        });
      }
      rec.status = "published"; rec.score = scored.score;
      rec.category = upd ? upd.frontmatter.category : classification.category;
      rec.subcategory = upd ? upd.frontmatter.subcategory : classification.subcategory;
      if (upd) rec.updatedSlug = upd.slug;
      if (upd) {
        console.log(`  ↻ ${DRY ? "DRY (not written)" : "UPDATED"} /${upd.frontmatter.category}/${upd.slug}/ · dateModified ${upd.frontmatter.dateModified} · rev ${upd.frontmatter.updateCount} · ${upd.titleChanged ? `headline REFRESHED (sim ${upd.sim.toFixed(2)}) → "${upd.frontmatter.title}"` : "headline unchanged"} · no new URL`);
      } else {
        console.log(`  ✓ ${DRY ? "DRY (md not written)" : "WROTE " + out.slug + ".md"}${rec.acceptReason ? " [" + rec.acceptReason + "]" : ""} [${classification.category}/${classification.subcategory}] score ${scored.score}`);
      }
    } else {
      // Terminal hold — rare in the lean model: a genuinely broken article (no title/garbled), a missing required
      // embed, a body trimmed too short, or no hero image. rec.holdReason was set where the hold was decided.
      rec.status = "needs_review";
      rec.holdReason = rec.holdReason || "held (no hero image)";
      console.log(`  → REVIEW QUEUE — ${rec.holdReason}`);
    }
    // FULL-PIPELINE MONITOR — verify every stage was covered + audit the article for everything.
    const report = auditArticle({ topic, article, classification, image, scored, body: auditBody });
    printAudit(report, `${topic.id} · ${pass ? "PUBLISHED" : "REVIEW"}`);
    rec.audit = { ok: report.ok, internalLinks: internalLinks.length, failed: report.failed.map((f) => f.name) };
    rec.ms = Date.now() - t0;
  } catch (e) {
    rec.status = "error"; rec.error = String(e?.stack || e).slice(0, 300);
    console.log("  ERROR", rec.error);
  }
  // AUDIT TRAIL (2026-07-03 strip): never silently overwrite a prior run's state for the same topic id —
  // keep the last 5 prior records inline so a re-queued story's attempt history survives.
  const stateFile = path.join(STATE, topic.id + ".json");
  try {
    const prev = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const { previousRuns, ...prevRec } = prev;
    rec.previousRuns = [...(previousRuns || []).slice(-4), prevRec];
  } catch { /* first run for this id */ }
  fs.writeFileSync(stateFile, JSON.stringify(rec, null, 2));
  return rec;
}

// ── CONCURRENCY POOL — run several topics at once (the speed win). CONCURRENCY workers pull from the queue; each
// runs the FULL per-article pipeline unchanged. --target=N stops launching new topics once N have PUBLISHED, so
// "give me 5" reliably delivers 5 (or exhausts the queue and reports honestly). Default concurrency 4 for a FIND
// batch (tune via CONCURRENCY=n); 1 for the manual single-topic path. Sonar/OpenRouter tolerate this; each call
// keeps its own retry/fail-closed safety, so a transient rate-limit on one topic never affects another.
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || (FROM_FIND ? 4 : 1));
const TARGET = Number((process.argv.find((a) => a.startsWith("--target=")) || "").split("=")[1]) || 0;
let cursor = 0, publishedCount = 0, writtenCount = 0;
const results = [];
async function worker() {
  while (true) {
    if (TARGET && publishedCount >= TARGET) return;
    const i = cursor++;
    if (i >= topics.length) return;
    const rec = await processTopic(topics[i], i);
    results.push(rec);
    if (rec.status === "published") publishedCount++;
  }
}
console.log(`\n▶ processing ${topics.length} topic(s) · concurrency ${CONCURRENCY}${TARGET ? ` · target ${TARGET} published` : ""}`);
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, topics.length || 1) }, () => worker()));
const pub = results.filter((r) => r.status === "published").length;
const review = results.filter((r) => r.status === "needs_review").length;
const rej = results.filter((r) => r.status === "rejected_editorial").length;
const err = results.filter((r) => r.status === "error").length;
console.log(`\nDONE. published:${pub} review:${review} rejected:${rej} error:${err} (processed ${results.length}/${topics.length}). State in ${STATE}`);

// MEASURED cost of this run (real OpenRouter token usage × current rates).
const cost = costReport();
console.log(`\n── MEASURED COST (this run) ──`);
for (const [m, s] of Object.entries(cost.byModel)) console.log(`  ${m}: ${s.calls} calls · ${s.in} in + ${s.out} out tok · $${s.usd.toFixed(4)}`);
console.log(`  TOTAL: $${cost.total.toFixed(4)} across ${cost.calls} calls` + (topics.length ? ` · $${(cost.total / topics.length).toFixed(4)}/article` : ""));
