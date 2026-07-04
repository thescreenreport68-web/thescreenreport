// INSIDE lane — shared OFFLINE test fixtures. Zero network, zero keys: every quote below is a
// REAL substring of the fake source texts (the verbatim wall must be able to pass them), every
// trigger/angle/factBlock mirrors the exact shapes the lane stages produce and consume.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TRIGGERS } from "../config.inside.mjs";

export const NOW = Date.parse("2026-07-03T12:00:00Z");

export const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name + "-"));
export const writeJson = (file, data) => (fs.writeFileSync(file, JSON.stringify(data, null, 1)), file);

// ── The quotes (each a verbatim substring of SRC_A / SRC_B below) ────────────────────────────
export const Q = {
  mira: "Rex taught me everything about grace on a film set, and I will carry his kindness with me always",
  onder: "He was the steadiest hand I ever pointed a camera at, and the funniest man in every room",
  tomas: "Working beside him on three films was the great education of my career",
  guild: "Our union has lost one of its most generous mentors, and our thoughts are with his family",
  studio: "Production on Midnight Circuit: Legacy is paused this week so the cast and crew can grieve together",
  fan1: "Midnight Circuit got me through the hardest year of my life and Rex was the reason",
  fan2: "I cannot believe Rex Harmon is gone, his films raised me",
  fan3: "Stop turning grief into content, let his family breathe",
  fan4: "His marathon rewatch nights were a tradition in our house, rest easy legend",
};

export const TWEET_ID_A = "1808881234567890123";
export const TWEET_ID_B = "1808899876543210987";

export const SRC_A =
  `Hollywood spent Tuesday mourning Rex Harmon, who died at 70 after a brief illness, his family confirmed. ` +
  `Tributes began within the hour. His co-star of two decades, Mira Vale, wrote on Instagram, "${Q.mira}." ` +
  `Director Paul Onder told Variety, "${Q.onder}." Stunt double Tomas Reyes posted on X ` +
  `(https://x.com/tomasreyes/status/${TWEET_ID_A}), "${Q.tomas}." More tributes are expected as the week goes on.`;

export const SRC_B =
  `Fans flooded social media within minutes of the announcement. One fan wrote, "${Q.fan1}." ` +
  `Another posted, "${Q.fan2}." Not everyone approved of the coverage: "${Q.fan3}," one user said. ` +
  `A fourth added, "${Q.fan4}." Meridian Pictures said in a statement, "${Q.studio}." ` +
  `Guild president Lena Okafor added, "${Q.guild}." ` +
  `See the thread at https://twitter.com/filmupdates/status/${TWEET_ID_B} for more coverage of the reactions.`;

export const SOURCES = [
  { url: "https://variety.example/rex-harmon-tributes", domain: "variety.com", owner: "Variety", tier: 1, title: "Rex Harmon tributes", text: SRC_A },
  { url: "https://ew.example/rex-harmon-fans-react", domain: "ew.com", owner: "EW", tier: 2, title: "Fans react to Rex Harmon", text: SRC_B },
];

// ── Trigger: a CONFIRMED death of a famous actor (the lane's canonical Tier-S event) ─────────
export function fakeTrigger(overrides = {}) {
  return {
    parentEventSlug: "rex-harmon-dies",
    parentSlug: "rex-harmon-dead-at-70",
    parentTitle: "Rex Harmon, Beloved Star of Midnight Circuit, Dies at 70",
    primaryEntity: "Rex Harmon",
    entities: ["Rex Harmon", "Midnight Circuit"],
    eventType: "death",
    sensitivity: "high",
    category: "celebrity",
    priority: 82,
    signals: { rss: 6, gdelt: 12 },
    outletCount: 6,
    status: "CONFIRMED",
    publishable: true,
    sources: SOURCES.map(({ url, owner, tier }) => ({ url, outlet: owner, tier })),
    tmdbType: "movie",
    subjectKind: "person",
    via: "ledger",
    allowedForms: TRIGGERS.death.forms,
    ...overrides,
  };
}

// ── Angles per form ───────────────────────────────────────────────────────────────────────────
const ANGLE_DEFS = {
  "peer-tributes": { angle: "Stars pay tribute to Rex Harmon", workingTitle: "Stars React to Rex Harmon's Death" },
  "fan-pulse": { angle: "Fans mourn Rex Harmon online", workingTitle: "Fans React to Rex Harmon's Death" },
  "cast-crew-voices": { angle: "Midnight Circuit cast and crew speak out", workingTitle: "Midnight Circuit Cast Speaks Out" },
  "breakout-spotlight": { angle: "Who is Tomas Reyes, the stuntman everyone is quoting", workingTitle: "Who Is Tomas Reyes?" },
  "single-voice": { angle: "Mira Vale's tribute to Rex Harmon", workingTitle: "Mira Vale Responds to Rex Harmon's Death" },
  "ripple-effects": { angle: "What happens to Midnight Circuit: Legacy now", workingTitle: "After Rex Harmon: What Happens to Midnight Circuit Now" },
};

export function fakeAngle(form = "peer-tributes", overrides = {}) {
  const d = ANGLE_DEFS[form];
  return {
    form,
    angle: d.angle,
    workingTitle: d.workingTitle,
    focusEntity: form === "breakout-spotlight" ? "Tomas Reyes" : "Rex Harmon",
    searchQueries: [`"Rex Harmon" tributes reaction`],
    voiceHints: ["Mira Vale", "Paul Onder"],
    note: d.angle,
    key: `${form}|rex-harmon`,
    ...overrides,
  };
}

// ── Fact blocks per form (quotes verbatim from SRC_A/SRC_B) ───────────────────────────────────
export const NAMED = {
  mira: { speaker: "Mira Vale", speakerType: "castmate", connection: "his co-star of two decades", platform: "Instagram", date: "2026-07-01", quote: Q.mira, stance: "positive", sourceIdx: 0 },
  onder: { speaker: "Paul Onder", speakerType: "filmmaker", connection: "director of Midnight Circuit", platform: "interview", date: "2026-07-01", quote: Q.onder, stance: "positive", sourceIdx: 0 },
  tomas: { speaker: "Tomas Reyes", speakerType: "crew", connection: "his longtime stunt double", platform: "X", date: "2026-07-01", quote: Q.tomas, stance: "positive", sourceIdx: 0 },
  okafor: { speaker: "Lena Okafor", speakerType: "official", connection: "president of the actors guild", platform: "statement", date: "2026-07-02", quote: Q.guild, stance: "neutral", sourceIdx: 1 },
  studio: { speaker: "Meridian Pictures", speakerType: "company", connection: "the studio behind Midnight Circuit", platform: "statement", date: "2026-07-02", quote: Q.studio, stance: "neutral", sourceIdx: 1 },
};

export const FAN_POSTS = [
  { speaker: "", speakerType: "fan", platform: "X", date: "", quote: Q.fan1, stance: "positive", sourceIdx: 1 },
  { speaker: "", speakerType: "fan", platform: "X", date: "", quote: Q.fan2, stance: "positive", sourceIdx: 1 },
  { speaker: "", speakerType: "fan", platform: "X", date: "", quote: Q.fan3, stance: "negative", sourceIdx: 1 },
  { speaker: "", speakerType: "fan", platform: "X", date: "", quote: Q.fan4, stance: "positive", sourceIdx: 1 },
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

const FB_VOICES = {
  "peer-tributes": { named: [NAMED.mira, NAMED.onder, NAMED.tomas, NAMED.okafor], fans: [] },
  "fan-pulse": { named: [], fans: FAN_POSTS },
  "cast-crew-voices": { named: [NAMED.mira, NAMED.onder], fans: [] },
  "breakout-spotlight": { named: [NAMED.mira, NAMED.onder, NAMED.tomas], fans: [] },
  "single-voice": { named: [NAMED.mira], fans: [] },
  "ripple-effects": { named: [NAMED.studio, NAMED.okafor], fans: [] },
};

export function fakeFactBlock(form = "peer-tributes", overrides = {}) {
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

// ── Writer-shaped article (body ≥300 words, quote-ratio well under 25%, no handles,
//    every rendered quote verbatim from the fact block, framing between all quotes) ───────────
const TITLES = {
  "peer-tributes": "Rex Harmon Dead at 70: Mira Vale and Paul Onder Lead Tributes",
  "fan-pulse": "Rex Harmon Fans Flood X With Tributes — and One Pointed Complaint",
  "cast-crew-voices": "Midnight Circuit Cast and Crew Speak Out on Rex Harmon's Death",
  "breakout-spotlight": "Who Is Tomas Reyes? The Voice Everyone Is Quoting After Rex Harmon's Death",
  "single-voice": 'Mira Vale Responds to Rex Harmon\'s Death: "Grace on a Film Set"',
  "ripple-effects": "After Rex Harmon: What Happens to Midnight Circuit Now",
};

const OPENERS = [
  (r) => `${r.speaker}, ${r.connection}, was among the first voices to surface, posting a message that read, "${r.quote}." Followers shared the tribute thousands of times within the hour.`,
  (r) => `A different register came from ${r.speaker}, ${r.connection}, who reached instead for the work itself: "${r.quote}." Collaborators echoed that memory throughout the afternoon.`,
  (r) => `${r.speaker} kept things plainer. In a short post, ${r.connection} wrote, "${r.quote}." It became the line mourners repeated to one another all evening.`,
  (r) => `Institutional voices arrived by nightfall. ${r.speaker}, ${r.connection}, said in a statement, "${r.quote}." A fuller tribute is planned for the next ceremony, the organization noted.`,
];
const FAN_FRAMES = [
  (r) => `One fan wrote, "${r.quote}." The post traveled far beyond the usual film circles.`,
  (r) => `Another fan posted simply, "${r.quote}." Replies underneath turned into a thread of favorite scenes.`,
  (r) => `A more skeptical corner of the fandom pushed back on the coverage itself: "${r.quote}," one fan argued.`,
  (r) => `A fourth fan remembered the ritual of it all, writing, "${r.quote}." Dozens answered with photographs of worn DVD boxes.`,
];

const FILLER = [
  `The confirmation came from the family early on Tuesday, and by lunchtime the industry's response had organized itself into something between a wake and a retrospective.`,
  `Studios paused announcements, trade reporters cleared their schedules, and the usual churn of casting news gave way for a day to memory.`,
  `Harmon's four decades of work touched an unusual number of departments, which is why the grief arrived from every corner of the crew list rather than only from the marquee names.`,
  `Colleagues describe a performer who learned every crew member's name by the second day of a shoot and kept handwritten notes about their families.`,
  `The pattern across the messages was consistent: less about the awards, more about the daily decency, a theme that repeated from soundstage veterans and newcomers alike.`,
  `What follows is the record of who said what, in their own words, gathered from public posts and official statements as the day unfolded.`,
  `Their history together stretched back to a low-budget thriller in the early nineties, a shoot both later described as the hardest and happiest job either had taken.`,
  `Industry observers noted how quickly the message spread beyond entertainment media, landing in sports broadcasts and morning shows before the afternoon was out.`,
];

export function fakeArticle({ form = "peer-tributes", factBlock = null, trigger = null, title = null, ...overrides } = {}) {
  factBlock = factBlock || fakeFactBlock(form);
  trigger = trigger || fakeTrigger();
  const named = factBlock.reactions;
  const fans = factBlock.aggregateFans;

  const paras = [
    `${trigger.parentTitle}. The news was confirmed by his family on Tuesday morning, and within hours the people who worked beside him began to speak, publicly and on the record.`,
    FILLER[0], FILLER[1],
    `## How did Hollywood react?`,
    FILLER[5],
    ...named.map((r, i) => OPENERS[i % OPENERS.length](r)),
    ...fans.map((r, i) => FAN_FRAMES[i % FAN_FRAMES.length](r)),
    FILLER[2], FILLER[3],
    ...(named.length + fans.length < 3 ? [FILLER[6], FILLER[7]] : []),
    `## What happens next?`,
    FILLER[4],
    `Reactions are still arriving, and this coverage will be updated as more of the people who knew him best find their words.`,
  ];
  const body = paras.join("\n\n");

  const render = [
    ...named.map((r) => ({ speaker: r.speaker, connection: r.connection || "", platform: r.platform || "", date: r.date || "", quote: r.quote, tweetId: "" })),
    ...fans.map((r) => ({ speaker: "", connection: "", platform: r.platform || "", date: r.date || "", quote: r.quote, tweetId: "" })),
  ];

  return {
    title: title || TITLES[form],
    metaTitle: (title || TITLES[form]).slice(0, 60),
    dek: "The people who knew Rex Harmon best responded in their own words within hours of the news.",
    metaDescription: "How co-stars, collaborators and fans reacted to the death of Rex Harmon, in their own on-the-record words.",
    keyTakeaways: [
      "Rex Harmon's death at 70 was confirmed by his family on Tuesday.",
      "Co-stars and collaborators shared on-the-record tributes within hours.",
      "The studio paused production on Midnight Circuit: Legacy for the week.",
    ],
    body,
    faq: [
      { q: "How did Mira Vale react to Rex Harmon's death?", a: "Mira Vale, his co-star of two decades, posted a tribute on Instagram crediting Harmon with teaching her grace on a film set and promising to carry his kindness with her always." },
      { q: "Is Midnight Circuit: Legacy still filming?", a: "Meridian Pictures said in a statement that production on Midnight Circuit: Legacy is paused this week so the cast and crew can grieve together." },
    ],
    about: [{ name: "Rex Harmon", type: "Person" }, { name: "Midnight Circuit", type: "Movie" }],
    tags: ["Rex Harmon", "Midnight Circuit", "tributes", "celebrity deaths"],
    imageQuery: "Rex Harmon actor",
    reactionsRender: render,
    anchorStatement: null,
    fanConsensus: form === "fan-pulse"
      ? "Fans are divided: gratitude for the films dominates, but a vocal minority is pushing back on the tone of the coverage itself."
      : "",
    claims: [],
    ...overrides,
  };
}

export const fakeImage = () => ({ image: "https://cdn.example/rex-harmon-hero.jpg", imageWidth: 1600, imageHeight: 900, credit: "Photo: Meridian Pictures" });

// ── FIND-side fixtures: queue.json topics + published.json ledger entries ────────────────────
export function queueTopic(o = {}) {
  return {
    title: "Rex Harmon, Beloved Star of Midnight Circuit, Dies at 70",
    eventSlug: "rex-harmon-dies",
    primaryEntity: "Rex Harmon",
    entities: ["Rex Harmon"],
    eventType: "death",
    category: "celebrity",
    priority: 82,
    signals: { rss: 6 },
    sources: [{ url: "https://variety.example/rex", outlet: "Variety", tier: 1 }],
    tmdbType: "movie",
    verification: { status: "CONFIRMED", outletCount: 6, publishable: true, sensitivity: "high" },
    ...o,
  };
}

export function ledgerEntry(o = {}) {
  return {
    eventSlug: "vera-lin-dies",
    slug: "vera-lin-dead-at-64",
    title: "Vera Lin, Oscar-Winning Composer, Dies at 64",
    entityKey: "vera-lin:death",
    eventType: "death",
    verifyStatus: "CONFIRMED", // the persisted verify status is honored, never assumed — absent = DEVELOPING (fail-closed)
    category: "music",
    priority: 77,
    signals: { rss: 4 },
    sourceUrls: ["https://a.example/1", "https://b.example/2", "https://c.example/3"],
    at: new Date(NOW - 12 * 36e5).toISOString(),
    ...o,
  };
}

// Write fake queue.json / published.json into a temp dir; returns { dir, queuePath, ledgerPath }.
export function fakeFindFiles({ topics = [queueTopic()], entries = [ledgerEntry()] } = {}) {
  const dir = tmp("inside-find");
  return {
    dir,
    queuePath: writeJson(path.join(dir, "queue.json"), { topics }),
    ledgerPath: writeJson(path.join(dir, "published.json"), entries),
  };
}
