// Pipeline orchestrator. Runs each topic through every stage in strict order; nothing is written
// unless it passes the rank-#1 gate (>=80, no hard-block) AND has a legal >=1200px image.
// Run:  cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; node site/pipeline/run.mjs [--dry-run] [--only=<id>]
import fs from "node:fs";
import path from "node:path";
import { MODELS } from "./config.mjs";
import { gatherFacts } from "./lib/groundFacts.mjs";
import { findContent } from "./lib/contentFinder.mjs";
import { generate } from "./stages/generate.mjs";
import { classify } from "./stages/classify.mjs";
import { editorialGate } from "./stages/editorialGate.mjs";
import { canonicalize } from "./find/categorize.mjs";
import { recordPublished, slugKey } from "./find/store.mjs";
import { sourceImage, measureRemote } from "./stages/image.mjs";
import { pickHeroImage } from "./lib/heroImage.mjs";
import { webVerifyArticle } from "./lib/webVerify.mjs";
import { cutArticle } from "./lib/cutter.mjs";
import { dedupeSentences, trimIncomplete } from "./lib/polish.mjs";
import { gate, classifyBlocks } from "./stages/gate.mjs";
import { assemble } from "./stages/assemble.mjs";
import { getWhereToWatch, factBlock, toWhereToWatch, discoverTop, discoverFactBlock, getTrailer, trailerFactBlock, getBoxOffice, boxOfficeFactBlock, getTitleFacts, titleFactBlock } from "./lib/tmdb.mjs";
import { omdb, omdbFactBlock } from "./lib/omdb.mjs";
import { getAuthoritativeAwards, awardsFactBlock, personAwards, personAwardsBlock } from "./lib/awardsCache.mjs";
import { cacheTweets, reactionFactBlock } from "./lib/tweets.mjs";
import { searchInterview, fetchTranscript, oEmbed, interviewFactBlock } from "./lib/youtube.mjs";
import { costReport } from "./lib/openrouter.mjs";
import { auditArticle, printAudit } from "./lib/articleAudit.mjs";
import { TOPICS } from "./topics.mjs";

const ART = "/Users/sivajithcu/Movie News site/site/content/articles";
const STATE = "/Users/sivajithcu/Movie News site/site/data/state";
fs.mkdirSync(STATE, { recursive: true });
const DRY = process.argv.includes("--dry-run");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
// FIND→MAKE seam: --from-find loads the autonomously-discovered ranked queue (data/find/queue.json)
// instead of the hand-typed topics.mjs. This is the single integration point (FIND_HALF_PLAN §3).
const FROM_FIND = process.argv.includes("--from-find");
// PHASE C terminal-accept floor: on the FINAL attempt, an article that is VERIFIED ACCURATE (no fabrication /
// grounding / must-have block) but merely a B-grade on soft quality still PUBLISHES if it scores >= this — better a
// correct, slightly-imperfect news brief than holding it forever (the 0-published trap). Below it → needs_review.
const ACCEPT_FLOOR = 65;
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 0;
let SOURCE_TOPICS = TOPICS;
if (FROM_FIND) {
  const q = JSON.parse(fs.readFileSync("/Users/sivajithcu/Movie News site/site/data/find/queue.json", "utf8"));
  SOURCE_TOPICS = q.topics || [];
  console.log(`FROM-FIND: loaded ${SOURCE_TOPICS.length} autonomously-discovered topics (queue run ${q.runId}, built ${q.builtAt})`);
}
let topics = ONLY ? SOURCE_TOPICS.filter((t) => t.id === ONLY) : SOURCE_TOPICS;
if (LIMIT) topics = topics.slice(0, LIMIT);
const BASE_ARG = (process.argv.find((a) => a.startsWith("--base=")) || "").split("=")[1];
const BASE = BASE_ARG ? new Date(BASE_ARG).getTime() : Date.now(); // real publish time in production; override with --base=<ISO>
// LIGHT TARGETED FACT-CHECK (owner 2026-07-03): sourcing from top trades means the story is already verified — but
// even a top outlet occasionally errs (Billboard's promo gave Tyga's "Rack City" the wrong chart peak, which we
// faithfully inherited). So we run the Sonar web-check to catch the LOAD-BEARING specifics (chart numbers, dates,
// who-did-what) and CORRECT them in place — but LIGHT: it never fail-closed-HOLDS and never guts an article into a
// hold (WEB_VERIFY_LIGHT). If the check can't run, we publish on trust-the-source. Accuracy up, volume unaffected.
const WEB_VERIFY = process.env.WEB_VERIFY !== "0"; // on by default (light mode below); WEB_VERIFY=0 fully disables
const WEB_VERIFY_LIGHT = process.env.WEB_VERIFY_STRICT !== "1"; // light (never block/gut) unless STRICT is requested
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS) || 2; // generate→gate rewrite passes; 2 for speed (the web-cut + cut-and-publish catch the tail)

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

    let article, classification, image, scored, src, pass = false, corrections = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !pass; attempt++) {
      // Attempt 2+ = SURGICAL self-correction (gossip port): fix ONLY the flagged spots of the prior draft at
      // temp 0.2 — a full rewrite at 0.6 routinely invented NEW fabrications each retry (the Madonna class).
      ({ article } = await generate({ topic, model: MODELS.generator, corrections, previousArticle: attempt > 1 ? article : null }));
      if (wtw?.length) article.whereToWatch = toWhereToWatch(wtw); // accurate table straight from TMDB
      if (trailer?.youtubeId) { article.youtubeId = trailer.youtubeId; article.releaseInfo = fmtRelease(trailer.releaseDate); }
      if (reactionTweets?.ids?.length) { article.tweetIds = reactionTweets.ids; }
      if (interview) { article.youtubeId = interview.youtubeId; article.sourceOutlet = interview.sourceOutlet; article.sourceUrl = interview.sourceUrl; }
      if (boxoffice?.worldwide) { article.boxOffice = { ...(article.boxOffice || {}), worldwide: boxoffice.worldwide, budget: boxoffice.budget }; }
      // PROFILE: overwrite the model's filmography with the VERIFIED TMDB one (never trust an invented credit list).
      if (personCredits?.length) article.filmography = personCredits.map((c) => ({ year: c.year, title: c.title, role: c.character, type: c.type }));
      // CLASSIFICATION is TOPIC-derived, not draft-derived (2026-07-03 strip): a FIND/seed topic already carries
      // the authoritative category/subcategory/formatTag, and the old per-attempt classify() LLM call was
      // overwritten right here anyway (only its tags survived) — 1-2 wasted flash-lite calls per article. Tags
      // derive deterministically; the LLM classifier runs ONLY for a legacy topic with no categorization, once.
      if (!classification) {
        if (topic.category && topic.subcategory) {
          classification = { category: topic.category, subcategory: topic.subcategory, formatTag: topic.formatTag || "news", tags: deriveTags(topic) };
        } else {
          classification = await classify({ article, topic, model: MODELS.classifier });
          if (!classification.tags?.length) classification.tags = deriveTags(topic);
        }
        // NEWS-ONLY fail-closed CHOKEPOINT (covers BOTH the FIND path AND the legacy `node run.mjs` path):
        // clamp the final formatTag to the 8 news forms and re-derive category/subcategory to a news silo,
        // so no driver/queue producer can ever stamp a removed form/silo onto the published frontmatter.
        // Idempotent on already-canonical FIND topics; repairs a legacy/manual topic that bypassed categorize.
        canonicalize(classification);
      }
      // (HERO IMAGE moved to the LAST MILE, after every gate — 2026-07-03, audit D9: og:image fetches + vision
      // + measure calls were fully wasted on every held article. See the LAST-MILE block below the web check.)
      scored = await gate({ article, topic, judgeModel: judge });
      // Embed niches must carry their defining embed, or the page is an empty promise — route to review.
      if (topic.formatTag === "trailer" && !article.youtubeId) scored.hardBlocks.push("trailer: no embedded video");
      if (topic.formatTag === "reaction" && !article.tweetIds?.length) scored.hardBlocks.push("reaction: no embedded posts");
      // PHASE C — FIX-AND-PUBLISH. Split blocks: a BLOCK (fabrication / contradicted fact / ungrounded stray /
      // missing image-embed-title) must NEVER auto-publish; a FIXABLE (length/section/link/soft-quality nit) is
      // retried, and is ACCEPTABLE on the final attempt once the piece is verified accurate. So a clean article OR a
      // verified-accurate-but-B-grade one PUBLISHES; only a genuine fabrication/grounding failure is held.
      const { block, fixable } = classifyBlocks(scored.hardBlocks);
      const cleanPass = (scored.score || 0) >= 80 && scored.hardBlocks.length === 0;
      // C2 CUT-and-ACCEPT: a final-attempt article whose ONLY blocks are verify-gate CUT strays that are all
      // QUALITATIVE (no number/date/platform/season/renewal — a checkable specific is caught separately as
      // CONTRADICTED/fabricated and STAYS blocked) is accepted: the strays are accurate peripheral context, not a
      // "fact distinct from the source". This publishes the Matlin/NCIS-type score-85 pieces instead of holding them.
      const cutOnly = block.length > 0 && block.every((b) => /^verify-gate CUT:/.test(b));
      // A stray is only safe to publish if it is a pure SOFT CHARACTERIZATION — no checkable factual marker. Any
      // number/date/$/%, a quoted title, a platform, an award, a season/episode, a music term (album/song/single/
      // chart/billboard), a credit verb (played/starred/featured/placed/appeared/directed/produced/wrote), a work
      // type (film/movie/series), or "role" means it is a CHECKABLE fact that must stay BLOCKED unless grounded
      // (those are exactly the fabrications — a wrong song credit / award / platform — the owner forbids).
      const SPECIFIC = /\d|%|\$|["“”']|\b(netflix|prime|hulu|disney|max|peacock|paramount|apple|amazon|hbo|theaters?|million|billion|grammy|oscar|emmy|academy award|bafta|golden globe|award|nominee|nominat|winner|won|renew|cancel|season|episode|album|single|song|track|ep|record|chart|billboard|hot 100|no\.?\s*1|number one|film|movie|series|show|played|plays|stars?|starring|featured|feat|placed|appeared|directed|produced|wrote|co-?wrote|composed|role|character|signed|deal|joins?|cast)\b/i;
      const straysQualitative = (scored.vgStrays || []).length > 0 && scored.vgStrays.every((c) => !SPECIFIC.test(c));
      // PUBLISH-EVERYTHING (owner 2026-07-02): a verify-gate CUT verdict means the flagged lines were still >=85%
      // supported — PERIPHERAL background not in the single source, NOT a contradiction. Publish those (accept cutOnly).
      // A genuine wrong specific is caught separately as "fabricated:"/"CONTRADICTED [" (NOT a CUT) → not cutOnly → the
      // cut-and-publish pass below DELETES that exact sentence, or it holds. So accuracy on specifics stays strict.
      // 2026-07-03 audit #4: a CUT is only auto-acceptable when EVERY stray is a pure soft characterization
      // (straysQualitative). If any stray carries a checkable specific (number/$/%/date/platform/award/credit/
      // title), acceptableBlocks stays false → the cut-and-publish pass DELETES those exact stray sentences (or
      // holds) instead of relying on the probabilistic web-check to notice an invented specific.
      const acceptableBlocks = block.length === 0 || (cutOnly && straysQualitative);
      const accept = !cleanPass && attempt === MAX_ATTEMPTS && acceptableBlocks && (scored.score || 0) >= ACCEPT_FLOOR;
      pass = cleanPass || accept;
      rec.acceptReason = accept ? `terminal-accept (verified accurate, score ${scored.score}${cutOnly ? `, ${scored.vgStrays.length} qualitative stray(s) accepted` : `, ${fixable.length} quality nit(s)`})` : undefined;
      // SELF-CORRECTION LOOP: feed the writer ALL feedback so each retry fixes everything known while keeping the
      // engaging voice + writing SHORTER rather than adding any ungrounded fact (Phase B). Cumulative → converges fast.
      const cc = scored.claimCheck;
      corrections = !pass
        ? [
            scored.hardBlocks?.length ? "Fix these from your last draft (keep the voice + engagement intact; write SHORTER rather than add ANY fact not in the sources): " + scored.hardBlocks.join("; ") : "",
            cc?.corrections || "",
          ].filter(Boolean).join("\n").trim() || null
        : null;
      rec.stages[`attempt${attempt}`] = { score: scored.score, cat: `${classification.category}/${classification.subcategory}`, hardBlocks: scored.hardBlocks, block, fixable, badClaims: cc?.bad?.length || 0 };
      console.log(`  attempt ${attempt}: score ${scored.score} [${classification.category}/${classification.subcategory}] claims:${cc ? `${(cc.verdicts || []).length - (cc.bad?.length || 0)}/${(cc.verdicts || []).length} ok` : "n/a"} ${cleanPass ? "PASS ✅" : accept ? `ACCEPT ✅ (verified-accurate, ${fixable.length} nit(s))` : `block:${JSON.stringify(block)} fixable:${JSON.stringify(fixable)}`}`);
    }
    // PUBLISH-EVERYTHING (owner 2026-07-02): if all attempts still left a block, DELETE the flagged (fabricated/
    // ungrounded) claims — from the body AND takeaways/FAQ/structured fields (the ONE cutter, 2026-07-03) — and
    // publish the clean remainder; never leave a built article unpublished. A gutted result still holds rather
    // than shipping a stub. Grounding-BLOCKs not tied to a cuttable claim (no image, garbled) legitimately hold.
    const bsrcN = (topic._bundle && topic._bundle.sources) || [];
    const thinG = bsrcN.length < 2 || bsrcN.reduce((n, s) => n + (s.text || "").length, 0) < 1500;
    const wordsOf = (b) => (String(b || "").match(/\b[\w']+\b/g) || []).length;
    const cutFloor = thinG ? 200 : 300; // a thin-grounding brief is LEGAL at ~220w — don't hold it for missing 300
    let cutPublished = false; // set when the gate SHORT-CIRCUITED (score 0) and cut-and-publish salvaged it → must RE-GATE
    if (!pass && scored?.cutClaims?.length && !DRY) {
      const idBlock = (scored.hardBlocks || []).some((b) => /wrong-title|identity mismatch|wrong[- ]entity/i.test(String(b)));
      const bodyBefore = article.body;
      const { cut, fieldCuts } = cutArticle(article, scored.cutClaims);
      const words = wordsOf(article.body);
      const ent = (topic.primaryEntity || "").toLowerCase();
      const nucleusSurvives = !ent || article.body.toLowerCase().includes(ent) || ent.split(/\s+/).some((w) => w.length > 3 && article.body.toLowerCase().includes(w));
      if (!idBlock && cut + fieldCuts > 0 && words >= cutFloor && nucleusSurvives) {
        pass = true;
        cutPublished = true; // gate score is STALE (0 from the short-circuit) — re-gate the cleaned article below
        rec.acceptReason = `cut-and-publish (removed ${cut} sentence(s) + ${fieldCuts} field item(s); ${words}w remain)`;
        console.log(`  ✂ cut-and-publish: removed ${cut} flagged sentence(s) + ${fieldCuts} field item(s), ${words}w remain → web-check next`);
      } else if (cut + fieldCuts > 0) {
        article.body = bodyBefore; // restore — this article is HELD, keep the audit trail intact
        console.log(`  ⛔ HELD (not cut-and-published): ${idBlock ? "wrong-entity/identity block" : !nucleusSurvives ? "the cut removed the story's subject" : `gutted to ${words}w (<${cutFloor})`} — a broken article is held, never shipped`);
      }
    }

    // Re-apply the DETERMINISTIC structured fields the writer must NEVER own (verified TMDB/OMDb figures, the
    // official trailer/embed ids, the reaction tweet ids). Used after a surgical web-correction re-writes the
    // article, so a corrected draft can't drop or re-hallucinate a system-supplied value.
    const reapplyStructured = () => {
      if (wtw?.length) article.whereToWatch = toWhereToWatch(wtw);
      if (trailer?.youtubeId) { article.youtubeId = trailer.youtubeId; article.releaseInfo = fmtRelease(trailer.releaseDate); }
      if (reactionTweets?.ids?.length) article.tweetIds = reactionTweets.ids;
      if (interview) { article.youtubeId = interview.youtubeId; article.sourceOutlet = interview.sourceOutlet; article.sourceUrl = interview.sourceUrl; }
      if (boxoffice?.worldwide) article.boxOffice = { ...(article.boxOffice || {}), worldwide: boxoffice.worldwide, budget: boxoffice.budget };
      if (personCredits?.length) article.filmography = personCredits.map((c) => ({ year: c.year, title: c.title, role: c.character, type: c.type }));
    };

    // ── INDEPENDENT WEB REALITY-CHECK — the LAST gate before EVERY publish, and the ONLY NON-CIRCULAR one: every
    // other gate checks the article against the SAME bundle the writer used, so a single source's OWN error (a
    // wrong credit, "set to reprise"→"confirmed") passes them all. This step checks the load-bearing specifics
    // against the LIVE OPEN WEB. Two root-cause fixes (2026-07-03, PART HH.2):
    //  (1) FAIL-CLOSED — if the check cannot run after retries, the article is UNVERIFIED-against-the-world → HOLD.
    //      Never silently publish an unverified article (the Thor `webCheck:{ran:false}`-then-published failure).
    //  (2) CORRECT-IN-PLACE — a contradiction that carries a known-correct value is fixed by a SURGICAL writer pass
    //      using the web's value, then RE-VERIFIED; only what is STILL wrong is cut. This stops cut-only from
    //      deleting the TRUE sentence while keeping the FALSE one (the Kamiyama-directs vs Tada-directs failure).
    if (pass && WEB_VERIFY && !DRY && article?.body) {
      let web = await webVerifyArticle({ topic, article }).catch((e) => ({ ran: false, contradictions: [], error: String(e?.message || e).slice(0, 120) }));
      // (1) COULD-NOT-RUN. LIGHT mode: publish on trust-the-source (the story is from a top outlet). STRICT mode
      // (WEB_VERIFY_STRICT=1): fail-closed HOLD. The owner's model is trust-the-source + a light corrective check.
      if (!web.ran) {
        rec.webCheck = { ran: false, error: web.error || "no result" };
        if (WEB_VERIFY_LIGHT) { console.log(`  ⚠ web check could not run (${web.error || "no result"}) — publishing on trust-the-source (light mode)`); }
        else { pass = false; rec.holdReason = `web reality-check could not run (${web.error || "no result"}) — held (strict)`; console.log(`  ⛔ HELD: web check could not run — fail-closed (strict)`); }
      } else if (web.contradictions.length) {
        console.log(`  🌐 web reality-check: ${web.contradictions.length} contradicted — ${web.contradictions.map((c) => c.claim.slice(0, 40)).join(" | ")}`);
        // (2a) CORRECT-IN-PLACE: hand the web's CORRECT values to a surgical writer pass (fix only these specifics —
        // e.g. the Tyga chart-peak numbers), then RE-VERIFY. Repairs the wrong specific instead of deleting the line.
        const correctable = web.contradictions.filter((c) => c.correct && c.correct.trim().length > 1);
        if (correctable.length) {
          const webCorr = correctable.map((c) => `- The article states "${c.claim}" — FACTUALLY WRONG per the live web. ${c.problem}. The CORRECT fact is: ${c.correct}. Replace the wrong specific with the correct one IN PLACE; keep all surrounding TRUE information (never delete a true neighbouring sentence).`).join("\n");
          const fixed = await generate({ topic, model: MODELS.generator, corrections: webCorr, previousArticle: article }).catch(() => null);
          if (fixed?.article?.body) {
            article = fixed.article;
            cutPublished = true; // body rewritten → re-gate below re-scores it (no stale quality score ships)
            reapplyStructured();
            web = await webVerifyArticle({ topic, article }).catch(() => ({ ran: false, contradictions: [] }));
            console.log(`  ↻ web-correct: surgically fixed ${correctable.length} specific(s) → re-verify: ${web.ran ? web.contradictions.length + " still wrong" : "n/a (light: publish)"}`);
          }
        }
        // (2b) whatever is STILL contradicted after correction → box-office structured fix + CUT that exact prose.
        const remaining = web.ran ? web.contradictions : [];
        if (remaining.length) {
          if (article.boxOffice) {
            for (const c of remaining) {
              if (/\$|\bmillion\b|\bbillion\b|gross|box.?office|domestic/i.test(`${c.claim} ${c.problem}`)) {
                const m = String(c.correct || "").match(/\$\s?[\d][\d,.]*\s?(?:million|billion|m|b)?/i);
                if (m) article.boxOffice.domestic = m[0].replace(/\s+/g, " ").trim(); else delete article.boxOffice.domestic;
              }
            }
          }
          const { cut, fieldCuts } = cutArticle(article, remaining.map((c) => c.claim));
          if (cut + fieldCuts > 0) console.log(`  ✂ web-cut: removed ${cut} still-wrong sentence(s) + ${fieldCuts} field item(s)`);
          // LIGHT mode never HOLDS on a gutted result — it publishes the corrected/trimmed remainder (a top-outlet
          // brief minus one wrong line is still good). STRICT mode holds a gutted piece.
          const words = wordsOf(article.body);
          if (!WEB_VERIFY_LIGHT && words < cutFloor) {
            pass = false;
            rec.holdReason = `web reality-check gutted the article (${words}w) — held (strict)`;
            console.log(`  ⛔ HELD after web-cut: ${words}w remain (strict)`);
          }
        }
        rec.webCheck = { ran: true, corrected: correctable.length, remaining: (web.ran ? web.contradictions.length : 0) };
      } else { rec.webCheck = { ran: true, contradictions: 0, checked: web.checkedCount || 0 }; }
    }

    // PUBLISH INVARIANT (STRICT only): a published article MUST have been checked against the live world.
    // STRICT-only invariant: never publish an unverified article. In LIGHT mode (the default) trust-the-source
    // covers a check that couldn't run, so this does not apply.
    if (!WEB_VERIFY_LIGHT && pass && WEB_VERIFY && !DRY && !(rec.webCheck && rec.webCheck.ran === true)) {
      pass = false;
      rec.holdReason = rec.holdReason || "publish invariant: web reality-check did not run — held (strict)";
      console.log(`  ⛔ HELD (publish invariant, strict): the web reality-check did not run`);
    }

    // ── RE-GATE AFTER CUTTING (2026-07-03 fix — the score-0 publish bug). When the gate SHORT-CIRCUITED on a fact
    // block it returned score 0 without ever running the quality judge; cut-and-publish then removed the flagged
    // claims but the article shipped UNSCORED at 0 (and a cut could leave the body incoherent — a dangling "That
    // series…" with its antecedent removed). Re-run the gate ONCE on the fully-cleaned article: the fabrications
    // are gone so it no longer short-circuits → a REAL score + a fresh block scan. If it now clears the floor,
    // publish with the true score; if it still blocks or scores below ACCEPT_FLOOR, HOLD (never ship a broken cut).
    if (cutPublished && pass && !DRY) {
      const rescore = await gate({ article, topic, judgeModel: judge }).catch(() => null);
      if (rescore) {
        const reBlocks = classifyBlocks(rescore.hardBlocks).block;
        if (reBlocks.length || (rescore.score || 0) < ACCEPT_FLOOR) {
          pass = false;
          rec.holdReason = `re-gate after cut: ${reBlocks.length ? "residual block — " + reBlocks.slice(0, 2).join("; ") : `score ${rescore.score} < ${ACCEPT_FLOOR} after cutting`}`;
          console.log(`  ⛔ HELD (re-gate after cut): ${reBlocks.length ? reBlocks.slice(0, 2).join("; ") : `score ${rescore.score} < ${ACCEPT_FLOOR}`}`);
        } else {
          scored = rescore; // adopt the REAL score + scorecard (no more score-0 publishes)
          rec.acceptReason = `${rec.acceptReason || "cut-and-publish"} → re-gated clean at ${rescore.score}`;
          console.log(`  ↻ re-gate after cut: clean at score ${rescore.score} — publishing with the real score`);
        }
      }
    }

    // FINAL POLISH (deterministic, before assemble): collapse duplicated sentences and trim any truncated/
    // cut-orphaned fragment — can never add a fact.
    if (pass && article?.body) article.body = trimIncomplete(dedupeSentences(article.body));

    // ── HERO IMAGE — LAST MILE (2026-07-03, audit D9: previously picked BEFORE the gate, so og:image fetches +
    // the vision call + measure downloads were fully wasted on every held article — 4/6 in the last run). Picked
    // ONLY for an article that has passed every gate, keyed by the EDITORIAL-CORRECTED entity. Policy unchanged
    // (owner 2026-07-01, gossip-parity): source outlet og:image (the real on-topic story photo) → cinematic TMDB
    // stills, vision-ranked → Wikimedia Commons last resort; HOTLINKED (measured remotely, never re-hosted);
    // >=1200px Discover floor; landscape preferred. A passed article with NO image on any ladder still HOLDS.
    if (pass) {
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
      const out = assemble({ article, classification, image, topic, dateISO });
      auditBody = out.body; internalLinks = out.internalLinks || [];
      if (!DRY) {
        fs.writeFileSync(path.join(ART, out.slug + ".md"), out.md);
        // DEDUP LEDGER: record the story so FIND never re-processes/re-publishes it (owner: no dupes = save credits +
        // protect Google trust + keep the feed fresh). Keyed by eventSlug (cross-outlet), the title slug, AND the
        // robust primaryEntity+eventType key (catches a story whose headline drifts across runs — the KVIFF bug).
        // + the VIDEO-FEED fields (Reels automation): source URLs for the image-gatherer, priority/signals for the
        // top-10 picker, hero image + category for frame filler/diversity — lost otherwise (queue.json is overwritten).
        recordPublished({
          eventSlug: topic.eventSlug, titleKey: slugKey(topic.title), primaryEntity: topic.primaryEntity, eventType: topic.eventType, slug: out.slug, title: topic.title,
          sourceUrls: (topic.sources || []).map((s) => s?.url).filter(Boolean),
          priority: topic.priority, signals: topic.signals,
          image: image?.image || null, category: classification.category,
          verifyStatus: topic.verification?.status || null,
        });
      }
      rec.status = "published"; rec.score = scored.score; rec.category = classification.category; rec.subcategory = classification.subcategory;
      console.log(`  ✓ ${DRY ? "DRY (md not written)" : "WROTE " + out.slug + ".md"}${rec.acceptReason ? " [" + rec.acceptReason + "]" : ""} [${classification.category}/${classification.subcategory}] score ${scored.score}`);
    } else {
      // C6 terminal disposition: distinguish a HELD-FOR-FABRICATION/grounding failure (a block remained) from a
      // HELD-FOR-WEAK-WRITING article (verified accurate, but score < the accept floor). Both go to review; the
      // reason makes the queue triageable (and tells us whether the writer or the grounding is the bottleneck).
      const finalBlocks = classifyBlocks(scored.hardBlocks);
      rec.holdReason = finalBlocks.block.length ? `accuracy/grounding block: ${finalBlocks.block.slice(0, 3).join("; ")}` : `verified accurate but score ${scored.score} < ${ACCEPT_FLOOR} (weak writing)`;
      rec.status = "needs_review";
      console.log(`  → REVIEW QUEUE (score ${scored.score}) — ${finalBlocks.block.length ? "ACCURACY/GROUNDING block" : "weak writing, accurate"}`);
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
let cursor = 0, publishedCount = 0;
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
