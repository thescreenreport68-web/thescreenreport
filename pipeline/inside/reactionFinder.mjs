// HARVEST — the lane's core stage. Per angle: gather outlet coverage of the ripple (contentFinder,
// free), LLM-extract every on-record reaction, then pass each through a DETERMINISTIC verbatim
// wall (a quote must literally exist in the extracted source text or it never enters the fact
// block). Per-form floors decide if the angle has enough real material to become an article.
// Fail-closed at every step: no material → no angle → no article. Never an invented reaction.
import { chat } from "../lib/openrouter.mjs";
import { findContent } from "../lib/contentFinder.mjs";
import { cacheTweets } from "../lib/tweets.mjs";
import { redditSearchPosts, redditTopComments } from "../find/sources/reddit.mjs";
import { xSearchIds } from "./xsearch.mjs";
import { bskySearchPosts } from "./bsky.mjs";
import { MODELS, FORMS, MAX_EMBEDS, NO_X, MIN_QUOTE_WORDS } from "./config.inside.mjs";

// Normalization for the verbatim wall: curly→straight quotes, dashes unified, whitespace
// collapsed, lowercased. Loose enough to survive extraction artifacts, strict enough that a
// paraphrase can never pass as a quote.
export const norm = (s) =>
  (s || "")
    // Drop apostrophes AND quote-marks entirely (both curly and straight): the writer may add
    // emphasis quotes ('choose the bear') or re-punctuate — orthography, not a changed statement.
    // The owner's rule is the WORDS can't change, so we compare word content; a real word swap still
    // fails the substring check.
    .replace(/[‘’‛′`']/g, "")
    .replace(/[“”‟″"]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// Bot/spam/foreign filter (owner audit of the Barbara Ling article: auto-repost bot posts —
// ftwr.cloud, hashtag spam, foreign-language reposts — were quoted as "fans"). A real reaction is a
// person's own words, not a headline-bot with 3 hashtags + a link, and English for an English desk.
const BOT_DOMAINS = /\b(ftwr\.cloud|dlvr\.it|ift\.tt|buff\.ly|paper\.li)\b/i;
export function looksLikeSpam(text) {
  const t = text || "";
  const tags = (t.match(/#[\w]+/g) || []).length;
  const links = (t.match(/https?:\/\/\S+/g) || []).length;
  if (BOT_DOMAINS.test(t)) return true;
  if (tags >= 2 && links >= 1) return true;               // headline-bot pattern
  if (tags >= 4) return true;                             // hashtag spam
  const nonAscii = (t.replace(/\s/g, "").match(/[^\x00-\x7F]/g) || []).length;
  if (t.length > 20 && nonAscii / t.replace(/\s/g, "").length > 0.15) return true; // non-Latin script
  // Latin-script foreign (Spanish/Portuguese/etc.) is mostly ASCII — catch by distinctly-Iberian words.
  const iberian = (t.match(/\b(uma|una|que|con|para|por|del|você|não|são|homenagem|pioneira|leyenda|transformó|diseño|pel[ií]cula|producci[óo]n|produção|espetacular|una?\s+leyenda|cine)\b/gi) || []).length;
  if (iberian >= 2) return true;
  return false;
}
// The quotable span = the person's words BEFORE any trailing link/hashtag run — still a verbatim
// prefix of the source text (the wall passes it), just without the URL/hashtag noise in the card.
export function cleanQuote(text, maxWords = 45) {
  let t = (text || "").split(/\s+(?=https?:\/\/|#\w)/)[0].trim();
  t = t.replace(/\s+[#@]\w+(\s+[#@]\w+)*\s*$/g, "").trim();
  return t.split(/\s+/).slice(0, maxWords).join(" ");
}

export function quoteIsVerbatim(quote, sources) {
  const q = norm(quote);
  if (q.length < 8) return false;
  return sources.some((s) => norm(s.text || "").includes(q));
}

const EXTRACT_SYS = `You extract REACTIONS & QUOTES about a specific movie/TV/music SUBJECT from source text, for an
audience-reaction desk. Extract ONLY what is literally in the text.
ABSOLUTE RULES:
- SUBJECT-MATCH FIRST: only extract material genuinely about the SUBJECT named below. If the text is about
  something else — a different work with a similar/short title, an unrelated news story (local politics,
  a different person) — return {"reactions":[]}. A short/common title (e.g. "From", "It", "Us") is NOT a
  license to grab unrelated text.
- "quote" must be COPIED CHARACTER-FOR-CHARACTER from the text (machine-checked; edited/merged/paraphrased
  quotes are discarded). Pick the most distinctive 1-2 sentence span, ≤45 words.
- speaker = who said it (exact name). A KNOWN figure (director/actor/musician/critic/official) → their name +
  speakerType. An ordinary viewer/fan → speakerType "fan" and speaker "" (never name private individuals).
- connection = their stated relationship to the subject, ONLY if the text states it. Never guess.
- stance: positive | negative | mixed | neutral. Output STRICT JSON only.`;

async function extractFromSource(src, i, trigger, angle, { model, chatImpl, subject }) {
  const user = `SUBJECT: ${subject}
ANGLE: ${angle.angle} (form: ${angle.form})

SOURCE ${i} (${src.domain || src.owner || "unknown"}):
${(src.text || "").slice(0, 5800)}

Extract every distinct reaction/quote ABOUT THE SUBJECT (see the subject-match rule). JSON:
{"reactions":[{"speaker":"","speakerType":"celebrity|filmmaker|castmate|crew|musician|company|official|fan|other",
"connection":"","platform":"X|Instagram|statement|interview|podcast|press|other","date":"","quote":"","stance":"positive|negative|mixed|neutral"}]}
Not about the subject, or no quotes → {"reactions":[]}.`;
  try {
    const { data } = await chatImpl({ model, system: EXTRACT_SYS, user, json: true, maxTokens: 2200, temperature: 0 });
    return (data?.reactions || []).map((r) => ({ ...r, sourceIdx: i }));
  } catch {
    return [];
  }
}

const TWEET_URL_RX = /https?:\/\/(?:twitter\.com|x\.com)\/[A-Za-z0-9_]+\/status(?:es)?\/(\d{8,25})/g;
export function findTweetIds(sources) {
  const ids = new Set();
  for (const s of sources) {
    for (const m of (s.text || "").matchAll(TWEET_URL_RX)) ids.add(m[1]);
    for (const m of (s.url || "").matchAll(TWEET_URL_RX)) ids.add(m[1]);
  }
  return [...ids];
}

// Text extraction STRIPS embedded tweets (blockquotes/scripts don't survive into the clean text),
// so reaction-roundup pages read as tweet-free — the exact posts the fan-pulse form needs. Scan
// the RAW HTML of the top source pages instead; hard-capped fetches, every failure skipped.
export async function scanPagesForTweets(sources, { fetchImpl = fetch, maxPages = 4, timeoutMs = 8000 } = {}) {
  const ids = new Set();
  for (const s of (sources || []).filter((x) => x?.url && !/x\.com|twitter\.com/.test(x.url)).slice(0, maxPages)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      t.unref?.();
      const res = await fetchImpl(s.url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; ScreenReportBot)" }, redirect: "follow" });
      const html = await res.text();
      clearTimeout(t);
      for (const m of html.matchAll(TWEET_URL_RX)) ids.add(m[1]);
    } catch { /* dead/slow page — skip */ }
  }
  return [...ids];
}

// Tweets ARE reactions, not just embeds: a public post is the primary artifact itself (the
// playbook's "official oEmbed is the receipt"). The text comes from X's own syndication API, so
// it is verbatim by construction; one cheap LLM pass classifies relevance + who the author is.
// Known ENTERTAINMENT-NEWS OUTLET / AGGREGATOR handles (owner REV 7: "we want PEOPLE, not media"). A
// news org posting a headline is not "people talking". Individual critics/commentators/creators are
// NOT here (owner keeps them). Deterministic backstop for the LLM's isOutlet flag.
const MEDIA_HANDLES = new Set([
  "deadline", "variety", "thr", "hollywoodreporter", "thewrap", "ign", "collider", "discussingfilm",
  "screenrant", "comicbook", "comicbookmovie", "empiremagazine", "totalfilm", "rottentomatoes",
  "metacritic", "cinemablend", "slashfilm", "indiewire", "ew", "entertainmentweekly", "people",
  "tmz", "etonline", "accessonline", "billboard", "pitchfork", "rollingstone", "complex", "pagesix",
  "toonhive", "culturecrave", "popbase", "popcrave", "filmupdates", "worldofreel", "thefilmstage",
  "cbr", "gamespot", "polygon", "kotaku", "nme", "consequence", "stereogum", "uproxx", "bleedingcool",
  "screendaily", "filmupdates", "flixchatter", "discussingfilm", "culturecrave", "dexerto",
]);
export const isMediaHandle = (h) => MEDIA_HANDLES.has(String(h || "").toLowerCase().replace(/^@/, ""));

const CLASSIFY_TWEETS_SYS = `You classify public X (Twitter) posts for an audience-reaction desk. For each post decide:
- aboutEvent: is it a genuine reaction ABOUT THE SUBJECT (not spam/ads/unrelated, not a different work with
  a similar name)? Be strict for short/common titles.
- isOutlet: is the AUTHOR a NEWS ORGANIZATION, media outlet, or news-AGGREGATOR account that REPORTS
  entertainment news / posts headlines (e.g. Deadline, Variety, The Hollywood Reporter, IGN, DiscussingFilm,
  Pop Crave, Culture Crave)? true ONLY for such reporting/aggregator accounts. An individual critic,
  commentator, creator, celebrity, or ordinary fan giving their OWN opinion is NOT an outlet → false.
- speakerType: celebrity|filmmaker|castmate|crew|musician|critic|creator if the AUTHOR is a publicly known
  individual — otherwise "fan" for ordinary users. (Never label an ordinary user a company.)
- connection: the author's publicly-known relationship to the subject ONLY if certain — else "".
- stance: positive|negative|mixed|neutral. Output STRICT JSON only.`;

async function classifyTweets(tweets, trigger, angle, { model, chatImpl, subject }) {
  const items = tweets.map((t, i) => ({
    i, author: t.user?.name || "", handle: t.user?.screen_name || "",
    verified: !!(t.user?.verified || t.user?.is_blue_verified), text: (t.text || "").slice(0, 500),
  }));
  const user = `SUBJECT: ${subject}
ANGLE: ${angle.angle} (form: ${angle.form})

POSTS:
${JSON.stringify(items, null, 1)}

JSON: {"posts":[{"i":0,"aboutEvent":true,"isOutlet":false,"speakerType":"","connection":"","stance":""}]}`;
  try {
    const { data } = await chatImpl({ model, system: CLASSIFY_TWEETS_SYS, user, json: true, maxTokens: 1200, temperature: 0 });
    // Drop MEDIA/OUTLET posts entirely — we embed PEOPLE, not news orgs posting headlines (owner REV 7).
    return (data?.posts || []).filter((p) => p && p.aboutEvent && Number.isInteger(p.i) && tweets[p.i]
      && !p.isOutlet && !isMediaHandle(tweets[p.i]?.user?.screen_name));
  } catch {
    return [];
  }
}

// The ONLY fail-closed floor left (REV 2): require a few REAL anchor posts so the embeds are real and
// the sentiment we characterize is honest. An "anchor" = any real named quote OR audience post
// (X/Reddit). creator-answers-critics additionally needs ≥1 real NAMED creator quote.
export function meetsFloor(form, stats) {
  const f = FORMS[form] || {};
  const anchors = (stats.namedVoices || 0) + (stats.fanPosts || 0);
  if (f.minCreatorQuotes && stats.namedVoices < f.minCreatorQuotes)
    return { ok: false, reason: `creator quotes ${stats.namedVoices} < ${f.minCreatorQuotes}` };
  // Audience-first (owner): these articles are about NORMAL PEOPLE's posts — critics can't fill in.
  if (f.minFanPosts && stats.fanPosts < f.minFanPosts)
    return { ok: false, reason: `audience posts ${stats.fanPosts} < ${f.minFanPosts}` };
  if (f.minAnchors && anchors < f.minAnchors)
    return { ok: false, reason: `real anchor posts ${anchors} < ${f.minAnchors}` };
  // A debate needs BOTH sides in the anchors — a one-sided harvest parks here instead of tempting
  // the writer into a dishonest "divided" framing that the honesty wall would kill anyway.
  if (f.needsBothSides && !(stats.hasPositive && stats.hasNegative))
    return { ok: false, reason: "one-sided anchors for a both-sides form" };
  return { ok: true };
}

// Deterministic per-form fallback queries — plain words, the way a person actually searches.
export function fallbackQueries(trigger, angle) {
  const who = angle.focusEntity || trigger.primaryEntity;
  // Disambiguate a short/common title with its medium so the finder doesn't match unrelated text.
  const medium = trigger.work ? (trigger.work.type === "tv" ? "TV series" : "movie") : "";
  const w = trigger.work && who === trigger.work.title ? `${who} ${medium}` : who;
  const F = {
    // Hunt pages that EMBED real fan posts (roundups carry the X/Instagram/Reddit posts we need in
    // their raw HTML) — the X-search source finds tweets directly; these surface IG/Reddit posts too.
    "audience-reaction": [`${w} fans react twitter`, `${w} reddit reaction`, `${w} instagram reaction`],
    "the-debate": [`${w} fans divided`, `${w} reddit debate`, `${w} twitter debate`],
    "creator-answers-critics": [`${w} responds criticism`, `${w} instagram statement`, `${w} addresses backlash`],
    "breakout-buzz": [`who is ${who}`, `${who} reddit`, `${who} everyone talking`],
  };
  return F[angle.form] || [`${w} reactions`];
}

// Cheap relevance+stance pass over Reddit comments (the audience anchors). Comment text is verbatim
// from the API; this only decides which are on-subject and their stance.
const CLASSIFY_REDDIT_SYS = `You classify Reddit comments for an audience-reaction desk. For each comment:
- aboutSubject: is it genuinely reacting to / discussing THIS subject (not off-topic, spam, or meta)?
- stance: positive|negative|mixed|neutral toward the subject. Output STRICT JSON only.`;
async function classifyRedditComments(comments, trigger, angle, { model, chatImpl, subject }) {
  const items = comments.map((c, i) => ({ i, text: (c.text || "").slice(0, 300) }));
  const user = `SUBJECT: ${subject}
ANGLE: ${angle.angle} (form: ${angle.form})

COMMENTS:
${JSON.stringify(items, null, 1)}

JSON: {"comments":[{"i":0,"aboutSubject":true,"stance":"positive|negative|mixed|neutral"}]}`;
  try {
    const { data } = await chatImpl({ model, system: CLASSIFY_REDDIT_SYS, user, json: true, maxTokens: 1000, temperature: 0 });
    return (data?.comments || []).filter((p) => p && p.aboutSubject && Number.isInteger(p.i) && comments[p.i]);
  } catch {
    return [];
  }
}

// Harvest telemetry, gated on INSIDE_DIAG=1 (the 24/7 workflow sets it): every supply step logs
// what it actually delivered, so a starved cloud run diagnoses from the Actions log in one look
// instead of guessing which free tier / datacenter block ate the material. Log-only — no behavior.
const DIAG = process.env.INSIDE_DIAG === "1";
const diag = (...a) => { if (DIAG) console.log("    [diag]", ...a); };

export async function harvestReactions(trigger, angle, {
  findContentImpl = findContent,
  chatImpl = chat,
  cacheTweetsImpl = cacheTweets,
  model = MODELS.verify, // flash-lite: extraction is cheap classification, not writing
  embeds = true,
  scanImpl = scanPagesForTweets,
  reddit = true,
  redditSearchImpl = redditSearchPosts,
  redditCommentsImpl = redditTopComments,
  xSearchImpl = xSearchIds,
  bskyImpl = bskySearchPosts,
  maxQueries = 3,
  // Soft self-deadline: stop STARTING new queries past this, return gracefully with whatever was
  // harvested (→ under-floor park + retry next cycle) instead of being watchdog-killed (→ blocked,
  // no retry accounting). The orchestrator watchdog stays as the hard backstop.
  softDeadlineMs = 150000, // decode adds batchexecute round-trips; gatherer watchdog (180s) keeps 30s headroom
} = {}) {
  const t0 = Date.now();
  // Disambiguated subject label — threaded into EVERY extraction/classification pass so off-topic
  // material (a different work with a short/common title, an unrelated news story) is rejected at the
  // source. This replaces REV 1's heavy editorial event-match gate with a cheap in-pass filter.
  const subject = trigger.headline
    ? `the trending story: "${trigger.headline}"${trigger.overview ? ` — ${trigger.overview.slice(0, 160)}` : ""}`
    : trigger.work
    ? `the ${trigger.work.type === "tv" ? "TV series" : "movie"} "${trigger.work.title}"${trigger.work.year ? ` (${trigger.work.year})` : ""}${trigger.overview ? ` — ${trigger.overview.slice(0, 160)}` : ""}`
    : `${trigger.primaryEntity} (a ${trigger.category || "film/TV"} figure)`;
  // 1. Enumerate + extract ripple coverage (free: gnews/GDELT/extraction inside contentFinder).
  //    The PARENT event's own source articles seed the first pass — initial coverage routinely
  //    carries the first statements/reactions, so the harvest always has a foothold. Then LLM
  //    angle queries, then deterministic per-form fallbacks, until the floor is met (≤maxQueries).
  // FORM-TARGETED queries FIRST (deterministic, entity-disambiguated — the "fans react" roundup
  // hunt is what actually fills the audience floors; cloud run 3 got 13 fan posts from it, run 4
  // starved because the soft deadline cut it off as query #3). The finder-LLM's queries follow.
  const queries = [...new Set([...fallbackQueries(trigger, angle), ...(angle.searchQueries || [])])].slice(0, maxQueries);
  const parentSeeds = (trigger.sources || []).filter((s) => s?.url).slice(0, 4);

  let bundle = null;
  let withText = [];
  let raw = [];
  const seenUrl = new Set();

  const runQuery = async (q, seeds) => {
    const b = await findContentImpl(
      { primaryEntity: trigger.primaryEntity, title: angle.workingTitle, query: q, sources: seeds },
      // corroborate:true is LOAD-BEARING — the post-restructure default (false) extracts ONLY the
      // seeds and ignores the query (news' trust-the-source model). The ripple harvest exists to
      // widen across outlets, so it always searches (gnews + GDELT). maxExtract caps the parallel
      // extraction burst (free keyless Jina is per-minute limited); a single reaction-roundup page
      // already carries many named voices, so 5 sources is ample for the floors.
      { maxSources: 5, maxExtract: 5, corroborate: true },
    ).catch(() => ({ blocked: true, reason: "finder error" }));
    if (b.blocked) { diag(`q="${q}" → BLOCKED (${b.reason || "?"})`); return false; }
    const fresh = (b.sources || []).filter((s) => (s.text || "").length > 200 && (!s.url || !seenUrl.has(s.url)));
    diag(`q="${q}" → sources ${(b.sources || []).length} (fresh ${fresh.length})${fresh.length ? ": " + fresh.map((s) => `${s.via || "?"}/${s.domain || s.owner || "?"}/${(s.text || "").length}ch`).join(" ") : ""}`);
    for (const s of fresh) if (s.url) seenUrl.add(s.url);
    if (fresh.length) {
      const base = withText.length;
      const lists = await Promise.all(fresh.map((s, i) => extractFromSource(s, base + i, trigger, angle, { model, chatImpl, subject })));
      withText = [...withText, ...fresh];
      raw = [...raw, ...lists.flat()];
    }
    bundle = bundle ? { ...bundle, sources: [...(bundle.sources || []), ...fresh] } : b;
    return true;
  };

  await runQuery(queries[0], parentSeeds);

  // 2. THE VERBATIM WALL — deterministic, not a model opinion. A quote that isn't literally in a
  //    source is dropped here and can never reach the writer.
  // HEADLINE-QUOTE GUARD (owner review of the run-6 article): outlet headlines live inside the
  // extracted page text, so a headline passes the verbatim wall and can masquerade as "a viewer"
  // post. A quote that IS a title — of any harvested source or of the parent story — is never a
  // reaction, whoever it's attributed to.
  const titlePool = () => [trigger.headline, trigger.parentTitle, ...withText.map((s) => s.title)]
    .filter(Boolean).map((t) => norm(t)).filter((t) => t.length >= 15);
  const isHeadlineQuote = (q) => {
    const nq = norm(q);
    if (nq.length < 15) return false;
    // Drop when the quote IS a title: contained in one, or a title plus a small tail (site suffix,
    // punctuation). A quote that merely MENTIONS the work's title is normal fan speech — keep it.
    return titlePool().some((t) => t.includes(nq) || (nq.includes(t) && nq.length <= t.length + 25));
  };
  const wall = (list, sources) => list.filter((r) => r.quote && quoteIsVerbatim(r.quote, sources) && !isHeadlineQuote(r.quote));

  const dedupe = (list) => {
    const seen = new Set(); const out = [];
    for (const r of list) {
      const k = norm(r.quote).slice(0, 90);
      if (seen.has(k)) continue;
      seen.add(k); out.push(r);
    }
    return out;
  };

  // SUBSTANTIVE QUOTES ONLY (owner: the selector kept tiny one-liners — "When season 3?", "love this!").
  // A fan quote must be a real, meaningful thought: ≥ MIN_QUOTE_WORDS words AND ≥ 40 chars. And the pool
  // is sorted LONGEST/most-substantive first so the writer builds on the best, most explainable posts.
  const wc = (q) => (q || "").trim().split(/\s+/).filter(Boolean).length;
  const substantive = (r) => wc(r.quote) >= MIN_QUOTE_WORDS && (r.quote || "").trim().length >= 40;
  const split = (list) => ({
    named: list.filter((r) => r.speaker && r.speakerType !== "fan"),
    fans: list.filter((r) => r.speakerType === "fan" && substantive(r))
      .map(({ speaker, ...rest }) => ({ ...rest, speaker: "" }))
      .sort((a, b) => wc(b.quote) - wc(a.quote)),
  });

  let passed = [], named = [], fans = [];
  const statsOf = () => ({
    namedVoices: new Set(named.map((r) => norm(r.speaker))).size,
    companyVoices: named.filter((r) => ["company", "official"].includes(r.speakerType)).length,
    fanPosts: fans.length,
    hasPositive: [...named, ...fans].some((r) => r.stance === "positive"),
    hasNegative: [...named, ...fans].some((r) => r.stance === "negative"),
    longestQuoteWords: Math.max(0, ...passed.map((r) => (r.quote || "").split(/\s+/).length)),
    reactionsTotal: passed.length,
  });
  const recompute = () => { passed = dedupe(wall(raw, withText)); ({ named, fans } = split(passed)); };
  recompute();

  // 3. Remaining queries only while the floor is unmet — a met floor stops the spend immediately;
  //    the soft deadline stops new queries when time is nearly up.
  for (let qi = 1; qi < queries.length && !meetsFloor(angle.form, statsOf()).ok; qi++) {
    if (Date.now() - t0 > softDeadlineMs) break;
    if (await runQuery(queries[qi], [])) recompute();
  }

  // (No early bail on empty contentFinder — Reddit below is an independent anchor source that works
  // even when the keyless article-extraction tier is throttled.)

  // 3b. TWEETS AS REACTIONS. The outlet coverage carries the reaction posts' URLs; resolve them
  //     through the keyless syndication cache (deleted/protected drop silently), classify author
  //     + relevance once, and feed them into the pool: known figures = named voices, ordinary
  //     users = the fan pool. Quote = the post's own text (verbatim by construction; the ≤45-word
  //     cut stays substring-safe under norm()'s whitespace collapse).
  let tweetIds = [];
  let tweets = [];
  if (embeds) {
    try {
      // THREE tweet sources merged, all resolved through the ONE syndication cache (verbatim +
      // embeddable): (1) twitterapi.io SEARCH — the real reaction posts about the subject (REV 5,
      // the fan-post spine once TWITTERAPI_KEY is set); (2) tweet URLs already embedded in the
      // coverage pages; (3) a raw-HTML page scan (roundups carry the posts extraction strips).
      const who = angle.focusEntity || trigger.primaryEntity;
      // FREE MODE: skip the paid twitterapi.io search; keep the free page-scan tweet sources.
      const searchIds = NO_X ? [] : await xSearchImpl(who, { max: MAX_EMBEDS * 3 }).catch((e) => { diag(`x-search → ERR ${String(e?.message || e).slice(0, 80)}`); return []; });
      const ids = [...new Set([...searchIds, ...findTweetIds(withText), ...await scanImpl(bundle?.sources || withText)])];
      ({ tweets = [], ids: tweetIds = [] } = await cacheTweetsImpl(ids.slice(0, MAX_EMBEDS * 3)));
      diag(`x → search ${searchIds.length}, total-ids ${ids.length}, syndication-resolved ${tweets.length}`);
    } catch (e) { diag(`tweet-scan → ERR ${String(e?.message || e).slice(0, 80)}`); tweets = []; tweetIds = []; }
  }
  if (tweets.length) {
    const classified = await classifyTweets(tweets, trigger, angle, { model, chatImpl, subject });
    for (const c of classified) {
      const t = tweets[c.i];
      const text = (t.text || "").trim();
      if (!text || looksLikeSpam(text)) continue;
      const quote = cleanQuote(text);
      if (norm(quote).length < 8) continue;
      const id = String(t.id_str || tweetIds[c.i] || "");
      withText.push({ url: id ? `https://x.com/i/status/${id}` : null, domain: "x.com", owner: "x", tier: "social", title: "public post", text, quotes: [text] });
      raw.push({
        speaker: c.speakerType === "fan" ? "" : (t.user?.name || ""),
        speakerType: c.speakerType || "fan",
        connection: c.connection || "",
        platform: "", // FREE MODE: generic attribution ("one user wrote") — never a platform name
        date: (t.created_at || "").slice(0, 10),
        quote,
        stance: c.stance || "neutral",
        sourceIdx: withText.length - 1,
        tweetId: id || undefined,
      });
    }
    recompute();
  }

  // 3b2. BLUESKY AS TEXT QUOTES — the keyless, free raw-fan-post source (works from any IP). Used
  //      ONLY for quote TEXT here (never embedded, never named as "Bluesky" to the reader — attributed
  //      generically as "one user"). The same relevance/speaker classify gates every post.
  try {
    const who = angle.focusEntity || trigger.primaryEntity;
    const found = await bskyImpl(who, { nowMs: t0 }).catch((e) => { diag(`bsky → ERR ${String(e?.message || e).slice(0, 80)}`); return []; });
    diag(`bsky → found ${found.length}`);
    if (found.length) {
      const asPosts = found.slice(0, 16).map((p) => ({ text: p.text, user: { name: p.displayName, screen_name: p.handle }, created_at: p.createdAt }));
      const classified = await classifyTweets(asPosts, trigger, angle, { model, chatImpl, subject });
      for (const c of classified) {
        const p = asPosts[c.i];
        const text = (p.text || "").trim();
        if (!text || looksLikeSpam(text)) continue;
        const quote = cleanQuote(text);
        if (norm(quote).length < 8) continue;
        withText.push({ url: null, domain: "social", owner: "social", tier: "social", title: "public post", text, quotes: [text] });
        raw.push({
          speaker: c.speakerType === "fan" ? "" : (p.user?.name || ""),
          speakerType: c.speakerType || "fan",
          connection: c.connection || "",
          platform: "", // generic — never "Bluesky"
          date: (p.created_at || "").slice(0, 10),
          quote,
          stance: c.stance || "neutral",
          sourceIdx: withText.length - 1,
        });
      }
      recompute();
    }
  } catch { /* bsky outage — other anchors may suffice */ }

  // 3c. REDDIT AS ANCHORS — the keyless, reliable discourse source (audience posts, verbatim from the
  //     API). Discovered posts + a targeted search; pull top comments; classify relevance+stance once.
  //     Reddit users are pseudonymous → aggregate "fan" anchors (never named).
  if (reddit) {
    try {
      const who = angle.focusEntity || trigger.primaryEntity;
      const found = await redditSearchImpl(who, { nowMs: t0 }).catch((e) => { diag(`reddit-search → ERR ${String(e?.message || e).slice(0, 80)}`); return []; });
      diag(`reddit → discovered ${(trigger.redditPosts || []).length}, searched ${found.length}`);
      const posts = [...(trigger.redditPosts || []), ...found];
      const seenPerma = new Set();
      const topPosts = posts.filter((p) => p?.permalink && !seenPerma.has(p.permalink) && (seenPerma.add(p.permalink), true)).slice(0, 4);
      const commentLists = await Promise.all(topPosts.map((p) => redditCommentsImpl(p.permalink).then((cs) => cs.map((c) => ({ ...c, _perma: p.permalink }))).catch(() => [])));
      const comments = commentLists.flat().slice(0, 14);
      if (comments.length) {
        const classified = await classifyRedditComments(comments, trigger, angle, { model, chatImpl, subject });
        for (const c of classified) {
          const cm = comments[c.i];
          if (!cm?.text || looksLikeSpam(cm.text)) continue;
          const rq = cleanQuote(cm.text);
          if (norm(rq).length < 8) continue;
          withText.push({ url: cm._perma || null, domain: "reddit.com", owner: "reddit", tier: "social", title: "reddit comment", text: cm.text, quotes: [cm.text] });
          raw.push({ speaker: "", speakerType: "fan", connection: "", platform: "", date: "", quote: rq, stance: c.stance || "neutral", sourceIdx: withText.length - 1, ...(cm._perma ? { redditUrl: cm._perma } : {}) });
        }
        recompute();
      }
    } catch { /* reddit outage — skip; other anchors may suffice */ }
  }

  const stats = statsOf();
  diag(`harvest done → ${JSON.stringify(stats)}`);
  const floor = meetsFloor(angle.form, stats);
  if (!floor.ok) return { ok: false, reason: `under floor: ${floor.reason}`, stats };

  // "divided/split" framing needs BOTH stances in the anchors (the-debate honesty precondition).
  stats.divided = stats.hasPositive && stats.hasNegative;
  tweetIds = tweetIds.slice(0, MAX_EMBEDS); // embed cap is separate from the anchor pool

  return {
    ok: true,
    factBlock: { reactions: named, aggregateFans: fans, tweetIds, sources: bundle?.sources || trigger.sources || [], stats },
    bundle: bundle || { sources: trigger.sources || [] },
  };
}

// The writer's ONLY quote source + the verify-gate grounding. Numbered so the writer can cite.
export function factBlockText(factBlock, trigger) {
  const L = [`STORY: ${trigger.parentTitle} (subject: ${trigger.primaryEntity})`];
  L.push("NAMED QUOTES (creators/critics — SECONDARY color only: at most ONE short beat in the article unless the form is creator-answers-critics; reproduce EXACTLY, attribute to this name):");
  factBlock.reactions.forEach((r, i) =>
    L.push(`R${i + 1}. ${r.speaker}${r.connection ? ` (${r.connection})` : ""} — ${r.platform || "on the record"}${r.date ? `, ${r.date}` : ""} [${r.stance}]${r.tweetId ? ` [tweet:${r.tweetId}]` : ""}: "${r.quote}"`));
  if (factBlock.aggregateFans.length) {
    L.push("AUDIENCE POSTS (THE SPINE of the article — real posts by normal people; quote WITHOUT any name and WITHOUT naming a platform: \"one user wrote,\" \"another viewer said,\" \"a fan online posted\" — these are TEXT quotes, not embeds):");
    factBlock.aggregateFans.forEach((r, i) => L.push(`A${i + 1}. [${r.stance}] ${r.platform || ""}: "${r.quote}"`));
  }
  const s = factBlock.stats;
  L.push(`SENTIMENT PICTURE (characterize honestly, anchored by the posts above): ${s.divided ? "DIVIDED (both sides present)" : s.hasNegative && !s.hasPositive ? "mostly negative" : s.hasPositive && !s.hasNegative ? "mostly positive" : "mixed / neutral"} — ${s.namedVoices} named quotes, ${s.fanPosts} audience posts.`);
  return L.join("\n");
}

// verifyGate/quoteGuard bundle: outlet sources + the fact block itself as a "fact"-tier source so
// every reaction line is entailment-checkable and every quote substring-checkable.
export function buildVBundle(factBlock, trigger) {
  return {
    sources: [
      ...factBlock.sources,
      {
        url: null, domain: "reaction-harvest", owner: "harvest", tier: "fact",
        title: "verified reaction fact block",
        text: factBlockText(factBlock, trigger),
        quotes: [...factBlock.reactions, ...factBlock.aggregateFans].map((r) => r.quote),
      },
    ],
  };
}
