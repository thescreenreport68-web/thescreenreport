// Pipeline orchestrator. Runs each topic through every stage in strict order; nothing is written
// unless it passes the rank-#1 gate (>=80, no hard-block) AND has a legal >=1200px image.
// Run:  cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; node site/pipeline/run.mjs [--dry-run] [--only=<id>]
import fs from "node:fs";
import path from "node:path";
import { MODELS } from "./config.mjs";
import { gatherFacts } from "./lib/groundFacts.mjs";
import { generate } from "./stages/generate.mjs";
import { classify } from "./stages/classify.mjs";
import { sourceImage, downloadImage } from "./stages/image.mjs";
import { gate } from "./stages/gate.mjs";
import { assemble } from "./stages/assemble.mjs";
import { getWhereToWatch, factBlock, toWhereToWatch, discoverTop, discoverFactBlock, getTrailer, trailerFactBlock, getBoxOffice, boxOfficeFactBlock, searchPerson, getPersonCredits, personFactBlock, getTitleFacts, titleFactBlock } from "./lib/tmdb.mjs";
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
// CHEAP production judge by default (gemini-2.5-flash-lite) — NEVER Opus/premium (owner hard rule; would
// blow the budget). GATE_JUDGE can override to a cheap fallback (llama-4-maverick / gemini-2.5-flash) only.
const judge = process.env.GATE_JUDGE || MODELS.judge;

// Deterministic, accurate release-date string for the trailer module (never model-generated).
function fmtRelease(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

let pub = 0, review = 0, err = 0;
for (let i = 0; i < topics.length; i++) {
  const topic = topics[i];
  const dateISO = new Date(BASE - i * 3 * 3600 * 1000).toISOString();
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

    // AUTHORITATIVE STRUCTURED FACTS (the Wikipedia-free spine, 2026-06-28). For any topic centered on a
    // FILM/TV TITLE, ground on TMDB structured facts (credits/typed dates/providers/OTT) + OMDb EXACT ratings
    // & box office, placed FIRST so they are the writer's source of truth and the judge's deterministic diff
    // target (stashed on topic._titleFacts / topic._omdb for PR3). This replaces Wikipedia reception/box-office.
    const TITLE_FORMS = new Set(["review", "box-office", "trailer", "explainer", "list", "guide", "watchguide", "reaction", "recap", "screen-music"]);
    const titleCentric = TITLE_FORMS.has(topic.formatTag) ||
      (["movies", "tv", "reviews", "streaming"].includes(topic.category) && topic.formatTag === "news");
    if (titleCentric) {
      const tf = await getTitleFacts(topic.primaryEntity, topic.tmdbType || (topic.category === "tv" ? "tv" : "movie"));
      if (tf) {
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
    for (let attempt = 1; attempt <= 3 && !pass; attempt++) {
      ({ article } = await generate({ topic, model: MODELS.generator, corrections }));
      if (wtw?.length) article.whereToWatch = toWhereToWatch(wtw); // accurate table straight from TMDB
      if (trailer?.youtubeId) { article.youtubeId = trailer.youtubeId; article.releaseInfo = fmtRelease(trailer.releaseDate); }
      if (reactionTweets?.ids?.length) { article.tweetIds = reactionTweets.ids; if (topic.instagramUrls?.length) article.instagramUrls = topic.instagramUrls; }
      if (interview) { article.youtubeId = interview.youtubeId; article.sourceOutlet = interview.sourceOutlet; article.sourceUrl = interview.sourceUrl; }
      if (boxoffice?.worldwide) { article.boxOffice = { ...(article.boxOffice || {}), worldwide: boxoffice.worldwide, budget: boxoffice.budget }; }
      // PROFILE: overwrite the model's filmography with the VERIFIED TMDB one (never trust an invented credit list).
      if (personCredits?.length) article.filmography = personCredits.map((c) => ({ year: c.year, title: c.title, role: c.character, type: c.type }));
      classification = await classify({ article, topic, model: MODELS.classifier });
      // FIND/coverage topics already have an AUTHORITATIVE category/subcategory/formatTag (from categorize
      // or coverage targeting) — respect it so classify can't scramble the per-subcategory coverage.
      if (FROM_FIND && topic.category && topic.subcategory) {
        classification.category = topic.category;
        classification.subcategory = topic.subcategory;
        classification.formatTag = topic.formatTag || classification.formatTag;
      }
      // Source a legal >=1200px hero: try the model's pick, the entity, then (for embed niches) the real cast/director.
      const imgCandidates = [...new Set([
        article.imageQuery, topic.primaryEntity, ...(topic.entities || []), ...(trailer ? [trailer.director, ...(trailer.cast || [])] : []),
      ].filter(Boolean))];
      src = null;
      for (const cq of imgCandidates) { src = await sourceImage(cq); if (src) break; }
      image = src ? await downloadImage({ url: src.downloadUrl, slug: topic.slug }) : null;
      if (image && src) image.credit = src.credit;
      scored = await gate({ article, topic, judgeModel: judge });
      if (!image) scored.hardBlocks.push("no >=1200px image sourced");
      // Embed niches must carry their defining embed, or the page is an empty promise — route to review.
      if ((topic.formatTag === "trailer" || topic.formatTag === "interview") && !article.youtubeId) scored.hardBlocks.push(`${topic.formatTag}: no embedded video`);
      if (topic.formatTag === "reaction" && !(article.tweetIds?.length || article.instagramUrls?.length)) scored.hardBlocks.push("reaction: no embedded posts");
      pass = (scored.score || 0) >= 80 && scored.hardBlocks.length === 0;
      // SELF-CORRECTION LOOP: feed the writer ALL feedback (structural blocks + per-claim corrections) so
      // each retry fixes everything known while keeping the engaging voice (owner mandate). Cumulative =
      // converges in fewer paid generations.
      const cc = scored.claimCheck;
      corrections = !pass
        ? [
            scored.hardBlocks?.length ? "Issues to fix from your last draft (keep the voice + engagement intact): " + scored.hardBlocks.join("; ") : "",
            cc?.corrections || "",
          ].filter(Boolean).join("\n").trim() || null
        : null;
      rec.stages[`attempt${attempt}`] = { score: scored.score, cat: `${classification.category}/${classification.subcategory}`, img: image?.image || null, hardBlocks: scored.hardBlocks, badClaims: cc?.bad?.length || 0 };
      console.log(`  attempt ${attempt}: score ${scored.score} [${classification.category}/${classification.subcategory}] img:${image ? "yes" : "NO"} claims:${cc ? `${(cc.verdicts || []).length - (cc.bad?.length || 0)}/${(cc.verdicts || []).length} ok` : "n/a"} ${pass ? "PASS ✅" : "blocks:" + JSON.stringify(scored.hardBlocks)}`);
    }
    rec.scorecard = { score: scored.score, subscores: scored.subscores, strengths: scored.strengths, weaknesses: scored.weaknesses, deterministic: scored.deterministic, hardBlocks: scored.hardBlocks };
    let auditBody = article.body, internalLinks = [];
    if (pass) {
      const out = assemble({ article, classification, image, topic, dateISO });
      auditBody = out.body; internalLinks = out.internalLinks || [];
      if (!DRY) fs.writeFileSync(path.join(ART, out.slug + ".md"), out.md);
      rec.status = "published"; rec.score = scored.score; rec.category = classification.category; rec.subcategory = classification.subcategory; pub++;
      console.log(`  ✓ ${DRY ? "DRY (md not written)" : "WROTE " + out.slug + ".md"} [${classification.category}/${classification.subcategory}] score ${scored.score}`);
    } else {
      rec.status = "needs_review"; review++;
      console.log(`  → REVIEW QUEUE (score ${scored.score})`);
    }
    // FULL-PIPELINE MONITOR — verify every stage was covered + audit the article for everything.
    const report = auditArticle({ topic, article, classification, image, scored, body: auditBody });
    printAudit(report, `${topic.id} · ${pass ? "PUBLISHED" : "REVIEW"}`);
    rec.audit = { ok: report.ok, internalLinks: internalLinks.length, failed: report.failed.map((f) => f.name) };
    rec.ms = Date.now() - t0;
  } catch (e) {
    rec.status = "error"; rec.error = String(e?.stack || e).slice(0, 300); err++;
    console.log("  ERROR", rec.error);
  }
  fs.writeFileSync(path.join(STATE, topic.id + ".json"), JSON.stringify(rec, null, 2));
}
console.log(`\nDONE. published:${pub} review:${review} error:${err}. State in ${STATE}`);

// MEASURED cost of this run (real OpenRouter token usage × current rates).
const cost = costReport();
console.log(`\n── MEASURED COST (this run) ──`);
for (const [m, s] of Object.entries(cost.byModel)) console.log(`  ${m}: ${s.calls} calls · ${s.in} in + ${s.out} out tok · $${s.usd.toFixed(4)}`);
console.log(`  TOTAL: $${cost.total.toFixed(4)} across ${cost.calls} calls` + (topics.length ? ` · $${(cost.total / topics.length).toFixed(4)}/article` : ""));
