// HARVEST — the lane's core stage. Per angle: gather outlet coverage of the ripple (contentFinder,
// free), LLM-extract every on-record reaction, then pass each through a DETERMINISTIC verbatim
// wall (a quote must literally exist in the extracted source text or it never enters the fact
// block). Per-form floors decide if the angle has enough real material to become an article.
// Fail-closed at every step: no material → no angle → no article. Never an invented reaction.
import { chat } from "../lib/openrouter.mjs";
import { findContent } from "../lib/contentFinder.mjs";
import { cacheTweets } from "../lib/tweets.mjs";
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
// A LEADING reply-mention run ("@user @user2 totally agree…") is also stripped — the remainder is a
// verbatim SUBSTRING of the source (the wall passes it) and reads clean, without an @handle that the
// QA fact-lock (no handles in prose) would otherwise block on.
export function cleanQuote(text, maxWords = 45) {
  let t = (text || "").split(/\s+(?=https?:\/\/|#\w)/)[0].trim();
  t = t.replace(/^(@[A-Za-z0-9_.]+[\s,:]+)+/, "").trim();      // reply prefix ("@user great point…")
  t = t.replace(/\s+[#@]\w+(\s+[#@]\w+)*\s*$/g, "").trim();
  return t.split(/\s+/).slice(0, maxWords).join(" ");
}
// An @handle anywhere in the FINAL quote would leak into reader-facing prose (the audience-handle
// fact-lock blocks it, and it breaks the generic-attribution rule). Reply-prefix mentions are already
// stripped by cleanQuote; a post with an INTERIOR @mention is a conversation fragment — drop it from
// the anchor pool (the free-mode Bluesky/Reddit supply has plenty of clean standalone posts).
export const hasHandle = (q) => /@[A-Za-z0-9_]{3,15}\b/.test(q || "");

export function quoteIsVerbatim(quote, sources) {
  const q = norm(quote);
  if (q.length < 8) return false;
  return sources.some((s) => norm(s.text || "").includes(q));
}

// TRUNCATION SCAR (owner review of the Toy Story 5 run): a page's text is sliced at a char boundary
// before extraction, so a quote near the cut ends MID-WORD ("…on cognitive, social, emot"). It's
// verbatim (the wall passes it) but reads broken. If the quote ends where its source continues with a
// letter, drop the trailing partial word (and any dangling connector) until it ends on a whole word —
// still a verbatim prefix, just clean. Bounded loop; leaves clean quotes untouched.
export function trimScar(quote, srcText) {
  let q = (quote || "").trim();
  const ns = norm(srcText || "");
  if (!ns) return q;
  for (let i = 0; i < 4; i++) {
    const nq = norm(q);
    if (nq.length < 8) break;
    const idx = ns.indexOf(nq);
    if (idx < 0) break;
    if (!/[a-z0-9]/.test(ns[idx + nq.length] || "")) break;   // ends on a clean boundary in the source
    const trimmed = q.replace(/[\s,;:—–-]*\S+$/, "").trim();   // drop the trailing (partial) word + connector
    if (!trimmed || trimmed === q) break;
    q = trimmed;
  }
  return q;
}

const EXTRACT_SYS = `You extract REACTIONS & QUOTES BY REAL PEOPLE about a specific movie/TV/music SUBJECT from source text,
for an audience-reaction desk. Extract ONLY what is literally in the text.
ABSOLUTE RULES:
- SUBJECT-MATCH FIRST: only extract material genuinely about the SUBJECT named below. If the text is about
  something else — a different work with a similar/short title, an unrelated news story (local politics,
  a different person) — return {"reactions":[]}. A short/common title (e.g. "From", "It", "Us") is NOT a
  license to grab unrelated text.
- PEOPLE ONLY — NEVER the outlet's own voice. The source is an ARTICLE/BLOG. Its author's own editorial
  prose (the writer's opinion, analysis, plot summary, "the film feels…", "critics are divided…") is NOT a
  reaction — SKIP it. Extract ONLY: (a) words the article explicitly attributes to a NAMED person (a critic,
  filmmaker, cast member, musician — "X wrote", "X said", "according to X"), or (b) a clearly-quoted
  reaction/post it reproduces. If a sentence has no identifiable human speaker, DO NOT extract it.
- NEVER use a website, publication, outlet, blog, aggregator, or domain as the speaker (e.g.
  "animatedviews.com", "Collider", "Variety", "the site"). The speaker is a HUMAN BEING or it is not extracted.
- QUOTE = the PERSON'S OWN WORDS ONLY — copied CHARACTER-FOR-CHARACTER (machine-checked; edited/merged/
  paraphrased quotes are discarded). When the person's words sit inside the article's framing
  (The film "ranks alongside the classics," she wrote), extract ONLY the words inside the person's
  quotation marks — never the outlet's lead-in words around them. Pick the most distinctive 1-2 sentence
  span, ≤45 words.
- speaker = who said it (exact human name). A KNOWN figure (director/actor/musician/critic) → their name +
  speakerType. An ordinary viewer/fan → speakerType "fan" and speaker "" (never name private individuals).
- connection = their stated relationship to the subject, ONLY if the text states it. Never guess.
- isMedia = true if the speaker is a professional CRITIC, reviewer, journalist, or an editor/writer/staffer
  at a media outlet or publication (a Variety editor, a Collider writer, "film critic", etc.). false for a
  cast/crew member, filmmaker, musician, the work's own creators, a celebrity reacting, or an ordinary viewer.
- stance: positive | negative | mixed | neutral. Output STRICT JSON only.`;

async function extractFromSource(src, i, trigger, angle, { model, chatImpl, subject }) {
  const user = `SUBJECT: ${subject}
ANGLE: ${angle.angle} (form: ${angle.form})

SOURCE ${i} (${src.domain || src.owner || "unknown"}):
${(src.text || "").slice(0, 5800)}

Extract every distinct reaction/quote ABOUT THE SUBJECT (see the subject-match rule). JSON:
{"reactions":[{"speaker":"","speakerType":"celebrity|filmmaker|castmate|crew|musician|company|official|fan|other",
"connection":"","isMedia":false,"platform":"X|Instagram|statement|interview|podcast|press|other","date":"","quote":"","stance":"positive|negative|mixed|neutral"}]}
Not about the subject, or no quotes → {"reactions":[]}.`;
  try {
    const { data } = await chatImpl({ model, system: EXTRACT_SYS, user, json: true, maxTokens: 2200, temperature: 0 });
    // A named voice pulled from an article often arrives wrapped in the outlet's framing
    // (The fifth film "ranks right alongside…") — snap to the person's own quoted words so the card
    // shows the speaker, not the outlet. Fan/anonymous rows are left as-is (and dropped downstream).
    return (data?.reactions || []).map((r) => ({ ...r, quote: r.speaker ? unwrapQuote(r.quote) : r.quote, sourceIdx: i }));
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

// ── PROVENANCE GUARD (owner review of the Toy Story 5 run, 2026-07-11) ─────────────────────────────
// The media filter above guards the X path; the ARTICLE-extraction path had no equivalent, so free-mode
// runs (X off, thin social) let a BLOG'S OWN editorial prose become "reactions" and let a DOMAIN
// ("animatedviews.com") become a "speaker". The rule: a reaction is trustworthy iff it is a real SOCIAL
// POST (the whole text IS the person's words) OR a NAMED, real-person, on-record voice quoted in an
// article. An article's unattributed editorial prose, or the outlet/domain as a "person", is never a
// reaction. "We want PEOPLE, not media" — enforced deterministically.
const SOCIAL_OWNERS = new Set(["x", "social", "reddit", "bluesky"]);
export const isSocialSrc = (src) => !!src && (src.tier === "social" || SOCIAL_OWNERS.has(src.owner));

// A "speaker" string that is really a website / outlet / brand rather than a human being — the
// animatedviews.com failure: the article-extraction path let a DOMAIN become a "viewer".
const DOMAINISH = /\S*\.(com|net|org|tv|io|co|news|film|movie|blog|info|uk|me)\b/i;
export function isOutletSpeaker(speaker, srcDomain) {
  const v = String(speaker || "").toLowerCase().trim();
  if (!v) return false;                                           // anonymous (a reproduced fan post) is NOT an outlet
  if (DOMAINISH.test(v)) return true;                             // "animatedviews.com", "the-wrap.com"
  if (isMediaHandle(v.replace(/[^a-z0-9]/g, ""))) return true;    // "Collider", "Variety" used as a name
  const brand = String(srcDomain || "").toLowerCase().replace(/\.(com|net|org|tv|io|co).*$/, "").replace(/[^a-z0-9]/g, "");
  if (brand.length >= 4 && v.replace(/[^a-z0-9]/g, "").includes(brand)) return true; // matches the source's own brand
  return false;
}
// A reaction is trusted iff it is a real SOCIAL post (its whole text is the person's own words), OR it
// is NOT the outlet/site/domain masquerading as a person. This is the one deterministic wall the
// article-extraction path lacked: a website is never a "viewer". Anonymous posts a roundup REPRODUCES
// ("one fan wrote: …") stay — the verbatim wall + headline guard + the extractor's people-only,
// skip-the-blog's-own-editorial prompt gate those. The owner's failure was the DOMAIN-as-speaker and
// the blog's own opinion voice; this kills the former outright and the prompt starves the latter.
export function reliableProvenance(r, src) {
  if (isSocialSrc(src)) return true;
  return !isOutletSpeaker(r.speaker, src?.domain);
}

// FREE-MODE MEDIA FILTER (owner review of the Toy Story 5 run, 2026-07-11: "the quotes taken from X and
// media are the issue — we want PEOPLE, not media"). In free mode the article's spine is ordinary people
// plus the work's OWN creators (a director/actor/musician who made it). A professional CRITIC / reviewer /
// journalist / outlet editor is MEDIA — kept out of the named pool here. The extractor's isMedia flag is
// the primary signal; speakerType "critic"/"journalist" (the tweet/bsky classify path) is the backstop.
// Independent creators (castmate/filmmaker/musician) and celebrities reacting are NOT media → kept.
export const isMediaVoice = (r) =>
  !!(r && (r.isMedia === true || r.speakerType === "critic" || r.speakerType === "journalist"));

// Outlet/article sentences frame a person's words in quotation marks with prose around them
// (The fifth "Toy Story" film "ranks right alongside…"). For a NAMED voice pulled from an article,
// snap to the longest quoted span (≥6 words) so the card shows the PERSON'S words, not the outlet's
// framing — still a verbatim substring of the source, so the wall passes. No inner span → unchanged.
export function unwrapQuote(text) {
  const s = String(text || "").trim();
  const spans = [...s.matchAll(/[“"«]([^“”"«»]{16,})[”"»]/g)]
    .map((m) => m[1].trim())
    .filter((x) => x.split(/\s+/).filter(Boolean).length >= 6);
  if (!spans.length) return s;
  const best = spans.sort((a, b) => b.length - a.length)[0];
  return best.length < s.length - 4 ? best : s;                   // only unwrap when real framing sits outside
}

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
  // Free mode drops MEDIA voices (critics/editors/journalists) from the named pool so the article is
  // built on real people + the work's own creators — read at call time so a run's env decides it.
  const dropMedia = process.env.INSIDE_NO_X === "1";
  const split = (list) => ({
    named: list.filter((r) => r.speaker && r.speakerType !== "fan" && !(dropMedia && isMediaVoice(r))),
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
  // PROVENANCE first (people, not the outlet's own voice), heal truncation scars, THEN the verbatim
  // wall, THEN dedupe/split.
  const recompute = () => {
    const trusted = raw
      .filter((r) => reliableProvenance(r, withText[r.sourceIdx]))
      .map((r) => ({ ...r, quote: trimScar(r.quote, withText[r.sourceIdx]?.text) }));
    passed = dedupe(wall(trusted, withText));
    ({ named, fans } = split(passed));
  };
  recompute();

  // 3. Remaining queries only while the floor is unmet — a met floor stops the spend immediately;
  //    the soft deadline stops new queries when time is nearly up.
  for (let qi = 1; qi < queries.length && !meetsFloor(angle.form, statsOf()).ok; qi++) {
    if (Date.now() - t0 > softDeadlineMs) break;
    if (await runQuery(queries[qi], [])) recompute();
  }

  // (No early bail on empty contentFinder — Bluesky below is an independent anchor source that works
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
      if (norm(quote).length < 8 || hasHandle(quote)) continue;
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
    // BOTH SIDES, HONESTLY (owner): run the plain search PLUS skeptic/praise sentiment queries for the
    // divided forms, so a "divided" framing is anchored by REAL posts from each camp — never padded with
    // a blog's opinion. Merge + dedupe by text; the relevance/stance classify still gates every post.
    // Widened for reaction SUPPLY (owner 2026-07-12): more angles + the work title + a higher per-query
    // limit → more real fan posts clear the floor. Deduped by text below; the relevance classify still gates.
    const workQ = trigger.work?.title && trigger.work.title !== who ? [trigger.work.title] : [];
    const bqueries = [...new Set(["audience-reaction", "the-debate"].includes(angle.form)
      ? [who, `${who} reactions`, `${who} fans`, `${who} disappointed`, `${who} amazing`, ...workQ]
      : [who, `${who} reactions`, ...workQ])];
    const bResults = await Promise.all(bqueries.map((q) =>
      bskyImpl(q, { nowMs: t0, limit: 30 }).catch((e) => { diag(`bsky q="${q}" → ERR ${String(e?.message || e).slice(0, 60)}`); return []; })));
    const seenB = new Set();
    const found = bResults.flat().filter((p) => {
      const k = norm(p.text || "").slice(0, 80);
      return p.text && k.length >= 8 && !seenB.has(k) && (seenB.add(k), true);
    });
    diag(`bsky → found ${found.length} (queries ${bqueries.length})`);
    if (found.length) {
      const asPosts = found.slice(0, 32).map((p) => ({ text: p.text, user: { name: p.displayName, screen_name: p.handle }, created_at: p.createdAt }));
      const classified = await classifyTweets(asPosts, trigger, angle, { model, chatImpl, subject });
      for (const c of classified) {
        const p = asPosts[c.i];
        const text = (p.text || "").trim();
        if (!text || looksLikeSpam(text)) continue;
        const quote = cleanQuote(text);
        if (norm(quote).length < 8 || hasHandle(quote)) continue;
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

  // (Reddit as an anchor source was REMOVED 2026-07-12 — permanently 403-blocked from datacenter
  //  runners. Bluesky (3b2) + the X-syndication page-scan + outlet extraction carry the reaction supply.)

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
