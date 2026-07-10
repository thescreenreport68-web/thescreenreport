// INSIDE lane — shared OFFLINE test fixtures (multi-agent lane, audience-reaction & discourse).
// Zero network, zero keys: every quote below is a REAL substring of the fake source texts (the
// verbatim wall must pass them); every story/angle/factBlock/job mirrors the exact shapes the
// agent team produces/consumes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FORMS } from "../config.inside.mjs";
import { factBlockText } from "../reactionFinder.mjs";

export const NOW = Date.parse("2026-07-04T12:00:00Z");

export const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name + "-"));
export const writeJson = (file, data) => (fs.writeFileSync(file, JSON.stringify(data, null, 1)), file);

// ── The quotes (each a verbatim substring of SRC_A / SRC_B below) ────────────────────────────────
export const Q = {
  // named creator quotes
  director: "I always intended the ending to be ambiguous, and I stand by that choice completely",
  lead: "The people arguing about the final scene are exactly the audience I hoped to reach",
  critic: "This is the boldest studio ending in years and the backlash proves it landed",
  // audience posts (fans, never named)
  fanLove: "The Sable Coast is the best thing I have seen all year and I am still thinking about it",
  fanHate: "That ending completely ruined the movie for me and I want my two hours back",
  fanSplit: "Half my group loved the ending and the other half walked out furious, wild movie",
  fanBuzz: "Nora Idris just became my favorite actor working, she carried the entire third act",
  fanNeg: "Honestly the pacing dragged and the ending felt like a cop out to me",
};

export const TWEET_ID_A = "1809881234567890123";
export const TWEET_ID_B = "1809899876543210987";

// SRC_A = the trade coverage carrying the creators' on-record replies to the discourse.
export const SRC_A =
  `The debate over the final scene of The Sable Coast has consumed film social media all week. ` +
  `Director Priya Anand addressed the reaction directly in an interview, saying, "${Q.director}." ` +
  `Lead actor Nora Idris was similarly unbothered, telling reporters, "${Q.lead}." ` +
  `Critic Dominic Ray, writing for a major outlet, argued that "${Q.critic}." ` +
  `More responses are expected as the film widens its release this weekend. ` +
  `See the reaction thread at https://x.com/screenchatter/status/${TWEET_ID_A} for the full back-and-forth.`;

// SRC_B = the reaction-roundup page carrying the audience posts (fans, unnamed).
export const SRC_B =
  `Audiences could not stop arguing about The Sable Coast this week. One viewer wrote, "${Q.fanLove}." ` +
  `Not everyone agreed. "${Q.fanHate}," one moviegoer posted. Another summed up the split: "${Q.fanSplit}." ` +
  `The film's breakout has a name attached: "${Q.fanBuzz}," a fan on Reddit said. ` +
  `A more measured take pushed back on the hype: "${Q.fanNeg}," another user added. ` +
  `Coverage of the reactions is collected at https://twitter.com/filmpulse/status/${TWEET_ID_B} and elsewhere.`;

export const SOURCES = [
  { url: "https://variety.example/sable-coast-ending-debate", domain: "variety.com", owner: "Variety", tier: 1, title: "The Sable Coast ending debate", text: SRC_A, quotes: [Q.director, Q.lead, Q.critic] },
  { url: "https://ew.example/sable-coast-fans-react", domain: "ew.com", owner: "EW", tier: 2, title: "Fans react to The Sable Coast", text: SRC_B, quotes: [Q.fanLove, Q.fanHate, Q.fanSplit, Q.fanBuzz, Q.fanNeg] },
];

// ── Fake reddit posts (the discourse anchors carried on the trigger) ──────────────────────────────
export function fakeRedditPost(o = {}) {
  return {
    id: "post1",
    subreddit: "movies",
    title: "The Sable Coast ending has people completely divided",
    selftext: "Just got back and the theater was split down the middle. What did everyone think?",
    permalink: "https://www.reddit.com/r/movies/comments/post1/the_sable_coast_ending/",
    url: null,
    score: 4200,
    numComments: 1300,
    createdUtc: Math.round((NOW - 6 * 36e5) / 1000),
    ageMin: 360,
    ...o,
  };
}

export const REDDIT_POSTS = [
  fakeRedditPost(),
  fakeRedditPost({ id: "post2", title: "The Sable Coast is a masterpiece, fight me", permalink: "https://www.reddit.com/r/movies/comments/post2/masterpiece/", numComments: 640, score: 2100 }),
];

// ── Trigger: a trending WORK with real reddit discourse (the REV 2 canonical shape) ───────────────
export function fakeTrigger(overrides = {}) {
  return {
    parentEventSlug: "the-sable-coast-2026",
    parentSlug: null,
    parentTitle: "The Sable Coast",
    primaryEntity: "The Sable Coast",
    entities: [],
    eventType: "discourse",
    sensitivity: "normal",
    category: "movies",
    priority: 1740,
    signals: { comments: 1940, redditPosts: 2, popularity: 88 },
    outletCount: 2,
    status: "CONFIRMED",
    sources: SOURCES.map(({ url, owner, tier }) => ({ url, outlet: owner, tier })),
    tmdbType: "movie",
    subjectKind: "title",
    via: "tmdb+reddit",
    redditPosts: REDDIT_POSTS,
    work: { title: "The Sable Coast", type: "movie", year: "2026" },
    overview: "A drifter returns to a coastal town and upends its uneasy calm in a story that ends on a deliberately open note.",
    ...overrides,
  };
}

// ── Angles per REV 2 form ─────────────────────────────────────────────────────────────────────────
const ANGLE_DEFS = {
  "audience-reaction": { angle: "How audiences are reacting to The Sable Coast", workingTitle: "The Sable Coast Has Audiences Sharply Divided" },
  "the-debate": { angle: "The Sable Coast ending debate", workingTitle: "The Sable Coast Ending, and Why Nobody Can Agree on It" },
  "creator-answers-critics": { angle: "Priya Anand answers the ending backlash", workingTitle: "The Sable Coast Director Responds to the Ending Backlash" },
  "breakout-buzz": { angle: "Nora Idris is suddenly everywhere", workingTitle: "Who Is Nora Idris? The Sable Coast Breakout Everyone's Talking About" },
};

export function fakeAngle(form = "audience-reaction", overrides = {}) {
  const d = ANGLE_DEFS[form];
  return {
    form,
    angle: d.angle,
    workingTitle: d.workingTitle,
    focusEntity: form === "breakout-buzz" ? "Nora Idris" : "The Sable Coast",
    searchQueries: ["The Sable Coast reactions", "Sable Coast ending debate"],
    note: d.angle,
    key: form,
    ...overrides,
  };
}

export function fakeAngles() {
  return Object.keys(FORMS).map((f) => fakeAngle(f));
}

// ── Named reactions + fan posts (quotes verbatim from SRC_A/SRC_B) ────────────────────────────────
export const NAMED = {
  director: { speaker: "Priya Anand", speakerType: "filmmaker", connection: "director of The Sable Coast", platform: "interview", date: "2026-07-02", quote: Q.director, stance: "positive", sourceIdx: 0 },
  lead: { speaker: "Nora Idris", speakerType: "celebrity", connection: "lead actor in The Sable Coast", platform: "press", date: "2026-07-02", quote: Q.lead, stance: "positive", sourceIdx: 0 },
  critic: { speaker: "Dominic Ray", speakerType: "other", connection: "film critic", platform: "other", date: "2026-07-02", quote: Q.critic, stance: "positive", sourceIdx: 0 },
};

export const FAN_POSTS = [
  { speaker: "", speakerType: "fan", connection: "", platform: "Reddit", date: "", quote: Q.fanLove, stance: "positive", sourceIdx: 1 },
  { speaker: "", speakerType: "fan", connection: "", platform: "X", date: "", quote: Q.fanHate, stance: "negative", sourceIdx: 1 },
  { speaker: "", speakerType: "fan", connection: "", platform: "Reddit", date: "", quote: Q.fanSplit, stance: "mixed", sourceIdx: 1 },
  { speaker: "", speakerType: "fan", connection: "", platform: "Reddit", date: "", quote: Q.fanBuzz, stance: "positive", sourceIdx: 1 },
  { speaker: "", speakerType: "fan", connection: "", platform: "X", date: "", quote: Q.fanNeg, stance: "negative", sourceIdx: 1 },
];

const normQ = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
export function statsFor(named, fans) {
  const all = [...named, ...fans];
  const s = {
    namedVoices: new Set(named.map((r) => normQ(r.speaker))).size,
    companyVoices: named.filter((r) => ["company", "official"].includes(r.speakerType)).length,
    fanPosts: fans.length,
    hasPositive: all.some((r) => r.stance === "positive"),
    hasNegative: all.some((r) => r.stance === "negative"),
    longestQuoteWords: Math.max(0, ...all.map((r) => (r.quote || "").split(/\s+/).length)),
    reactionsTotal: all.length,
  };
  s.divided = s.hasPositive && s.hasNegative;
  return s;
}

// Per-form voice mix: enough anchors to clear each form's floor.
const FB_VOICES = {
  // audience-reaction: minAnchors 3 → 4 fan posts (both sides present so "divided" is honest)
  "audience-reaction": { named: [], fans: [FAN_POSTS[0], FAN_POSTS[1], FAN_POSTS[2], FAN_POSTS[4]] },
  // the-debate: minAnchors 3, needsBothSides → 4 fans, divided
  "the-debate": { named: [], fans: [FAN_POSTS[0], FAN_POSTS[1], FAN_POSTS[2], FAN_POSTS[4]] },
  // creator-answers-critics: minCreatorQuotes 1 named + minAnchors 2 → 1 named + 2 fans
  "creator-answers-critics": { named: [NAMED.director], fans: [FAN_POSTS[1], FAN_POSTS[4]] },
  // breakout-buzz: minAnchors 3 → 1 named + 3 fans
  "breakout-buzz": { named: [NAMED.lead], fans: [FAN_POSTS[0], FAN_POSTS[3], FAN_POSTS[2]] },
};

export function fakeFactBlock(form = "audience-reaction", overrides = {}) {
  const { named, fans } = FB_VOICES[form];
  return {
    reactions: named.map((r) => ({ ...r })),
    aggregateFans: fans.map((r) => ({ ...r })),
    tweetIds: [TWEET_ID_A],
    sources: SOURCES,
    stats: statsFor(named, fans),
    ...overrides,
  };
}

// ── Writer-shaped article (body >= floor words, quote-ratio under 35%, no handles, every rendered
//    quote verbatim from the fact block, framing between all quotes) ──────────────────────────────
const TITLES = {
  "audience-reaction": "The Sable Coast Has Audiences Sharply Divided Over Its Ending",
  "the-debate": "The Sable Coast Ending Debate: Why Fans Can't Agree",
  "creator-answers-critics": "The Sable Coast Director Responds to the Ending Backlash",
  "breakout-buzz": "Who Is Nora Idris? The Sable Coast Breakout Everyone's Talking About",
};

const FAN_FRAMES = [
  (r) => `One viewer put the enthusiasm plainly, writing, "${r.quote}." The post drew hundreds of agreeing replies within the hour.`,
  (r) => `On the other side of the argument, one moviegoer was blunt: "${r.quote}." Dozens piled in to agree.`,
  (r) => `The split itself became the story. As one fan on Reddit summed it up, "${r.quote}." That single post captured the mood better than any review.`,
  (r) => `A more measured note cut through the noise. "${r.quote}," another user wrote, and the thread beneath it turned into a real conversation.`,
  (r) => `Enthusiasm centered on one name. "${r.quote}," a fan on Reddit said, and the sentiment kept repeating across every thread.`,
];
const NAMED_FRAMES = [
  (r) => `${r.speaker}, ${r.connection}, met the reaction head-on. In an interview, ${r.speaker.split(" ")[0]} said, "${r.quote}." The comment only poured fuel on the debate.`,
  (r) => `${r.speaker}, ${r.connection}, seemed to relish the argument. "${r.quote}," ${r.speaker.split(" ")[0]} told reporters, framing the divide as the point.`,
];

const FILLER = [
  `The film opened to a curious kind of success: not a consensus, but a fight. Within a day, the conversation had organized itself into two camps that barely acknowledged the other existed.`,
  `What makes the reaction unusual is how evenly it splits. For every thread declaring the movie a triumph, another calls it a betrayal, and the two rarely meet in the middle.`,
  `The argument is not really about whether the movie is good. It is about what the ending means, and whether the filmmakers earned the right to leave it open.`,
  `That tension is exactly what has kept the film at the top of every feed this week, long after the opening-weekend numbers stopped being the headline.`,
  `Whatever side you land on, the movie has done the one thing a divisive film sets out to do: it refuses to be ignored, and the conversation shows no sign of cooling.`,
  `Threads dissecting the final ten minutes have racked up thousands of comments, with viewers trading frame-by-frame readings and rival theories that grow more elaborate by the hour.`,
  `The pattern repeats across platforms — the loudest voices are the ones who felt something, in either direction, and the indifferent middle has almost nothing to say about any of it.`,
  `Part of what fuels the argument is how confidently each side reads the same handful of images, arriving at opposite conclusions and refusing to grant the other any ground at all.`,
  `Trade reporters who have covered a decade of opening weekends note that few recent releases have generated this volume of genuine, sustained back-and-forth rather than the usual burst that fades by Monday morning.`,
  `Even viewers who disliked the film concede that it is impossible to shrug off, which may be the surest sign that the filmmakers accomplished exactly what they set out to do with that closing sequence.`,
];

export function fakeArticle({ form = "audience-reaction", factBlock = null, trigger = null, title = null, ...overrides } = {}) {
  factBlock = factBlock || fakeFactBlock(form);
  trigger = trigger || fakeTrigger();
  const named = factBlock.reactions;
  const fans = factBlock.aggregateFans;

  const paras = [
    `${trigger.parentTitle} did not just open this week — it detonated an argument. ${FILLER[0]}`,
    FILLER[1], FILLER[7],
    `## How are audiences reacting?`,
    FILLER[2], FILLER[8],
    ...fans.map((r, i) => FAN_FRAMES[i % FAN_FRAMES.length](r)),
    FILLER[5],
    ...named.map((r, i) => NAMED_FRAMES[i % NAMED_FRAMES.length](r)),
    FILLER[3], FILLER[6], FILLER[9],
    `## Where does the debate go from here?`,
    FILLER[4], FILLER[10],
    `The conversation is still building, and this piece will be updated as more voices weigh in on where it all lands.`,
  ];
  const body = paras.join("\n\n");

  const render = [
    ...named.map((r) => ({ speaker: r.speaker, connection: r.connection || "", platform: r.platform || "", date: r.date || "", quote: r.quote, tweetId: "" })),
    ...fans.map((r) => ({ speaker: "", connection: "", platform: r.platform || "", date: r.date || "", quote: r.quote, tweetId: "" })),
  ];

  const anchorStatement = form === "creator-answers-critics" && named[0]
    ? { speaker: named[0].speaker, connection: named[0].connection, quote: named[0].quote, platform: named[0].platform }
    : null;

  return {
    title: title || TITLES[form],
    metaTitle: (title || TITLES[form]).slice(0, 60),
    dek: "Audiences can't stop arguing about The Sable Coast, and the split is the whole story.",
    metaDescription: "How viewers, fans and the filmmakers are reacting to the divisive ending of The Sable Coast, in their own words.",
    keyTakeaways: [
      "The Sable Coast has split audiences over its deliberately open ending.",
      "Fans on Reddit and X are trading rival readings of the final scene.",
      "The reaction has kept the film at the top of the conversation all week.",
    ],
    body,
    faq: [
      { q: "Why is The Sable Coast so divisive?", a: "The film ends on a deliberately ambiguous note, and audiences are split between those who read it as a bold, earned choice and those who feel the movie refused to resolve its own story." },
      { q: "What are audiences saying about the ending?", a: "Reactions range from calling it the best film of the year to feeling cheated by the final scene, with many viewers describing screenings where the room itself was divided." },
    ],
    about: [{ name: "The Sable Coast", type: "Movie" }, { name: "Nora Idris", type: "Person" }],
    tags: ["The Sable Coast", "audience reaction", "movie discourse", "Nora Idris"],
    imageQuery: "The Sable Coast movie",
    reactionsRender: render,
    anchorStatement,
    fanConsensus: "Audiences are genuinely divided: the ending has as many passionate defenders as it has furious detractors.",
    claims: [],
    ...overrides,
  };
}

export const fakeImage = () => ({ image: "https://cdn.example/sable-coast-hero.jpg", imageWidth: 1600, imageHeight: 900, credit: "Photo via source" });

// ── Fake TMDB / Reddit discovery responses (for discover.mjs injected impls) ──────────────────────
export function fakeTMDBItems() {
  return [
    { source: "tmdb:trending-movie", kind: "trending-movie", mediaType: "movie", tmdbId: 101, title: "The Sable Coast", year: "2026", releaseDate: "2026-06-20", released: true, popularity: 88, voteAverage: 7.4, overview: "A drifter returns to a coastal town.", nicheHint: "" },
    { source: "tmdb:trending-tv", kind: "trending-tv", mediaType: "tv", tmdbId: 202, title: "Harbor Lights", year: "2026", releaseDate: "2026-05-01", released: true, popularity: 55, overview: "An anthology set on the docks." },
    { source: "tmdb:trending-person", kind: "trending-person", mediaType: "person", tmdbId: 303, title: "Nora Idris", year: "", releaseDate: "", released: false, popularity: 42, overview: "" },
    { source: "tmdb:upcoming", kind: "upcoming", mediaType: "movie", tmdbId: 404, title: "Quiet Nobody Cares", year: "2027", releaseDate: "2027-01-01", released: false, popularity: 5, overview: "" }, // low pop + no discourse → dropped
  ];
}

export function fakeRedditDiscover() {
  return [
    // matches The Sable Coast (work story)
    fakeRedditPost({ id: "d1", title: "The Sable Coast ending has people completely divided", numComments: 1300, score: 4200, url: null }),
    fakeRedditPost({ id: "d2", subreddit: "movies", title: "The Sable Coast is a masterpiece", permalink: "https://www.reddit.com/r/movies/comments/d2/masterpiece/", numComments: 640, score: 2100, url: null }),
    // mentions Nora Idris (person story)
    fakeRedditPost({ id: "d3", subreddit: "movies", title: "Nora Idris carried The Sable Coast, incredible performance", permalink: "https://www.reddit.com/r/movies/comments/d3/nora/", numComments: 210, score: 900, url: null }),
    // a big orphan argument about an unrelated title
    fakeRedditPost({ id: "d4", subreddit: "television", title: "Why does everyone hate the Harbor Watch finale so much", permalink: "https://www.reddit.com/r/television/comments/d4/harbor/", numComments: 340, score: 1500, url: null }),
    // low-comment noise (dropped by discovery, but injected impl already filters; kept small for match tests)
  ];
}

// Canned Reddit JSON listings (for reddit.mjs getJson via injected fetchImpl).
export function redditListing(posts) {
  return { data: { children: posts.map((d) => ({ data: d })) } };
}
export function redditCommentsListing(comments) {
  // reddit comments endpoint returns [postListing, commentListing]
  return [{ data: { children: [] } }, { data: { children: comments.map((d) => ({ data: d })) } }];
}

// ── Multi-agent layer fixtures ────────────────────────────────────────────────────────────────────

// A synthesizer-shaped brief (already clamped).
export function fakeBrief(form = "audience-reaction") {
  return {
    hook: "The Sable Coast did not just open — it split its audience straight down the middle.",
    mood: "genuinely divided: passionate defenders vs furious detractors",
    sides: [
      { stance: "for", summary: "Viewers who loved it call the open ending earned and bold.", anchorRefs: ["A1"] },
      { stance: "against", summary: "Detractors feel the film refused to resolve its own story.", anchorRefs: ["A2"] },
    ],
    standoutRefs: ["A1", "A2", "A3"],
    mustInclude: ["the ending is deliberately ambiguous", "the split itself is the story"],
    suggestedTitle: "The Sable Coast Has Audiences Sharply Divided Over Its Ending",
    seoKeyword: "The Sable Coast reactions",
  };
}

// A complete work-file job, ready for any downstream agent.
export function fakeJob(form = "audience-reaction", over = {}) {
  const story = fakeTrigger();
  const angle = fakeAngle(form);
  const factBlock = fakeFactBlock(form);
  return {
    story,
    angle,
    factBlock,
    factText: factBlockText(factBlock, story),
    bundle: { sources: SOURCES.map((s) => ({ ...s })) },
    gatherStats: factBlock.stats,
    embeds: { tweetIds: [TWEET_ID_A], instagramUrls: [] },
    brief: fakeBrief(form),
    ...over,
  };
}

// ── Instagram embed-scan fixtures (raw HTML the embed agent scans) ────────────────────────────────
export const IG_CODE_A = "ABCdef1234";
export const IG_CODE_B = "XYZghi5678";
export const IG_HTML =
  `<html><body><p>Reactions poured in.</p>` +
  `<blockquote class="instagram-media"><a href="https://www.instagram.com/p/${IG_CODE_A}/">Nora Idris celebrating The Sable Coast opening weekend</a></blockquote>` +
  `<p>Another post made the rounds:</p>` +
  `<blockquote><a href="https://instagram.com/reel/${IG_CODE_B}/">unrelated sneaker ad from a brand account</a></blockquote>` +
  `<a href="https://www.instagram.com/p/${IG_CODE_A}/">duplicate of the first</a>` +
  `</body></html>`;
