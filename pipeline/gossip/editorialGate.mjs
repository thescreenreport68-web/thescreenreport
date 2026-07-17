// GOSSIP — EDITORIAL GATE (the missing step). Runs AFTER the content is collected (Stage 3.5), BEFORE framing +
// writing. It is the ONE place that reads the ACTUAL collected story text and makes the editorial calls that were
// previously guessed from thin metadata (a discovery blurb, an outlet name, a subjectType). It answers, grounded
// in the content itself:
//   • isStory  — is there a REAL, specific, newsworthy story here, or a bare social post / photo / birthday /
//                score / non-story? (the power to REJECT — the conveyor's missing "no")
//   • category — what the story is ABOUT (a musician's WEDDING is celebrity, not music), not who the subject is
//   • attribution — the outlet that ACTUALLY reports the core claim per the text, never a social aggregator
//                   (Pop Crave) or a republisher (Yahoo/MSN/AOL)
//   • confirmed — whether the CONTENT establishes the claim as fact via a credible source, not "an action happened"
//   • eventSummary — a canonical one-line description of the real-world EVENT (a content-grounded dedup key)
// This REPLACES the scattered metadata heuristics (routeBySubject-only, topOutlet attribution, the over-broad
// categorizer confirmed rule) with a single decision made from ground truth. reviewImpl injectable for offline tests.
import { agentChat } from "./models.mjs";

// Re-route enabled (owner 2026-07-04): the gossip desk may file a genuine film/TV
// PROJECT story under its true category instead of forcing everything to celebrity —
// personal-life stories still go to celebrity (see the category rule). Streaming-service
// series (Netflix/Max/Prime) file under "tv" — the streaming category is guide-only
// (where-to-watch/best-of), which has no "news" subcategory.
const CATS = ["celebrity", "music", "awards", "movies", "tv"];

const SYSTEM = `You are the EDITOR-IN-CHIEF of a celebrity news desk. You are handed the RAW COLLECTED TEXT of one candidate story (what our crawler actually pulled from the source). Decide, using ONLY that text, whether and how to run it. Be strict — a news brand's credibility depends on NOT publishing filler, and on filing/attributing every story correctly. Output strict JSON only.

inScope — OUR NICHE (check this FIRST; it overrides EVERYTHING). The test: does the story genuinely FEATURE, as a real subject, a HOLLYWOOD / Western ENTERTAINMENT celebrity?
OUR NICHE = film/TV actors & actresses; Western/English-language musicians/singers/rappers/bands; reality-TV / streaming-show stars INCLUDING the KARDASHIAN–JENNER family; supermodels / models who are media or reality-TV personalities (e.g. the Kardashians, Jenners, Hadids); comedians, film/TV directors, TV hosts, and major ENTERTAINMENT influencers.
- inScope=TRUE whenever an in-niche entertainment celebrity (as above) is a MEANINGFUL SUBJECT of the story — whether the lead OR a key named figure the story is genuinely about. Their involvement makes the story ours, EVEN IF they are paired with a non-niche person. (So "Lewis Hamilton on his girlfriend KIM KARDASHIAN" is IN, because Kim Kardashian — a reality-TV star — is a key subject; "Taylor Swift's wedding" is IN even with NFL's Travis Kelce as co-subject.)
- inScope=FALSE ONLY when the story is a STANDALONE item about a NON-ENTERTAINMENT figure with NO in-niche entertainment celebrity meaningfully involved: an ATHLETE of any sport (incl. a Formula 1 / race-car driver) in a sport/personal story with no celebrity (e.g. "Lewis Hamilton wins the British GP"), a POLITICIAN (a senator's health), a ROYAL (a prince's appearance), a BUSINESS figure (a CEO's deal), or a non-niche person with only an UNNAMED companion (e.g. "Alex Rodriguez kisses a mystery woman at a party" — a retired baseball player + an unidentified woman, no named in-niche celebrity → OUT).
- When no in-niche entertainment celebrity is genuinely a subject, set inScope=FALSE.

isStory (the REJECT power — this is the most important call):
- FALSE for: a bare social-media post or photo caption with no reporting ("X stuns by a waterfall", "happy birthday to…", "N years ago today…"), a sports score, a food/product blurb, an anniversary, a "reacts to"/"wears"/"spotted" item with NO concrete newsworthy development, or anything where the collected text has no specific who/what/when substance.
- TRUE only if there is a SPECIFIC, substantive development a reader learns something from (an event that happened, an announcement, a legal/health/relationship development, real quotes, concrete facts).
- When the text is thin or is just a caption around a photo, isStory MUST be false. Do not be generous.

category — file by what the STORY IS ABOUT, NOT by who the subject is (MOVIES-FIRST: when a real screen PROJECT is the core, file it there — do NOT dump project news into celebrity):
- "movies" if the core of the story is a FILM PROJECT — a movie's casting, greenlight, deal, production, release, or box office (e.g. "Actor to star in a new feature film" is MOVIES).
- "tv" if the core is a TV or STREAMING SERIES (broadcast, cable, Netflix/Max/Prime/etc.) — a show's greenlight, casting, renewal, cancellation, premiere, or episodes (e.g. "Ashley Tisdale to star in a new Netflix comedy series" is TV, not celebrity).
- "music" ONLY if the story itself is about MUSIC: a song/album release, chart result, tour, performance, music award, or lyric analysis.
- "celebrity" for a PERSONAL-LIFE story — relationship, wedding, family, appearance, feud, legal, health, net worth, paparazzi sighting — EVEN IF the subject is a musician or an actor (Taylor Swift's wedding is CELEBRITY, not music; an actor spotted at a party is CELEBRITY, not movies).
- "awards" only for an awards-race story.
secondaryCategory: if the primary is a screen/music PROJECT but a celebrity is the hook, you may set "celebrity" as secondary; if the subject is a musician but the story is personal-life, set "music" as secondary; else null.

attribution — the outlet that ORIGINALLY reports the core claim, as evidenced by the text (who broke it / whom it cites):
- NEVER a social aggregator (Pop Crave, PopBase, DeuxMoi) and NEVER a pure republisher/aggregator (Yahoo, MSN, AOL, Google News, MSN). Name the real reporting outlet the text points to.
- If the ONLY source is a social post with no outlet, set attribution to that social account AND confirmed=false.

confirmed — TRUE only if the collected text shows the core claim is ESTABLISHED AS FACT by a credible outlet or an official/on-record source (announced, reported as done by a named outlet, court/police record). FALSE for a rumor, a "source says", speculation, or merely that "an action happened" per a social post.

eventSummary: one plain sentence naming the specific real-world EVENT (who + what + when/where), so two write-ups of the SAME event can be recognized as the same. Example: "Blake Lively attends a Lake Placid horse show while skipping Taylor Swift's wedding festivities."

primaryEntity — the ONE person the story is really MOST about. CORRECT the discovery guess if it is wrong: a story about what Abigail Anderson wore is about ABIGAIL ANDERSON, not Taylor Swift, even if Taylor's name is in the headline. This name drives the lead image + caption, so it must be the right person.
coSubjects — other named people CENTRAL to THIS story (e.g. for "X was spotted with Y", include Y). Used so the lead image shows the right people. Empty array if none.
angle — one neutral sentence stating the core VERIFIED development from the text (this becomes the writer's factual basis instead of the possibly-clickbait headline). State only what the text supports; do NOT inflate a "expected to" into "confirmed to".`;

function buildPrompt(topic, bundle) {
  const primary = (bundle.sources || []).filter((s) => !s.corroborating);
  const seed = primary[0] || (bundle.sources || [])[0] || {};
  const others = new Set((bundle.sources || []).map((s) => s.outlet).concat((bundle.corroboratingOutlets || []).map((o) => o.outlet)));
  const text = (seed.text || "").slice(0, 3200);
  return `SUBJECT (from discovery, may be wrong): ${topic.primaryEntity} — subjectType "${topic.subjectType}"
DISCOVERY HEADLINE: ${topic.title || ""}
SOURCE OUTLET (where we found it): ${seed.outlet || "unknown"}
OTHER OUTLETS ALSO CARRYING SOMETHING ON THIS SUBJECT: ${[...others].filter(Boolean).join(", ") || "none"}

COLLECTED ARTICLE TEXT (all we actually have — judge substance from THIS, not the headline):
"""
${text || "(no article body was extractable — only the short discovery blurb above)"}
"""

Return JSON:
{"inScope":<bool>,"outOfNicheReason":"<if inScope=false, WHY — e.g. 'politician' / 'royal' / 'business figure'>","isStory":<bool>,"substanceScore":<0-10>,"rejectReason":"<if not a story, why>","category":"celebrity|music|awards","secondaryCategory":"music|null","attribution":"<real reporting outlet>","confirmed":<bool>,"official":<bool>,"denied":<bool>,"eventSummary":"<one sentence naming the specific event>","primaryEntity":"<the person the story is really about>","coSubjects":["<other central people>"],"angle":"<one neutral sentence of the verified development>"}`;
}

async function defaultReview({ topic, bundle }) {
  const { data } = await agentChat("editor", {
    system: SYSTEM,
    user: buildPrompt(topic, bundle),
    json: true, maxTokens: 500, temperature: 0.1,
  });
  return data || null;
}

// Normalize + sanity-clamp the model output so downstream code is never handed a bad shape.
function normalize(raw, topic) {
  if (!raw || typeof raw !== "object") return null;
  const category = CATS.includes((raw.category || "").toLowerCase()) ? raw.category.toLowerCase() : null;
  const sec = (raw.secondaryCategory && CATS.includes(String(raw.secondaryCategory).toLowerCase())) ? raw.secondaryCategory.toLowerCase() : null;
  return {
    inScope: raw.inScope !== false, // only reject when the model EXPLICITLY says out-of-niche
    outOfNicheReason: String(raw.outOfNicheReason || "").slice(0, 120),
    isStory: raw.isStory !== false, // default to letting it through only if the model didn't explicitly reject
    substanceScore: Number.isFinite(raw.substanceScore) ? raw.substanceScore : (raw.isStory === false ? 2 : 6),
    rejectReason: String(raw.rejectReason || "").slice(0, 200),
    category,
    secondaryCategory: sec && sec !== category ? sec : null,
    attribution: (raw.attribution && String(raw.attribution).trim()) || null,
    confirmed: !!raw.confirmed,
    official: !!raw.official,
    denied: !!raw.denied,
    eventSummary: String(raw.eventSummary || topic.title || "").slice(0, 240),
    // Content-grounded WHO the story is about (fixes the wrong-entity image/caption); falls back to the discovery guess.
    primaryEntity: (raw.primaryEntity && String(raw.primaryEntity).trim()) || topic.primaryEntity || null,
    coSubjects: Array.isArray(raw.coSubjects) ? raw.coSubjects.map((s) => String(s).trim()).filter(Boolean).slice(0, 4) : [],
    angle: (raw.angle && String(raw.angle).trim().slice(0, 240)) || "",
  };
}

// SUBSTANCE FLOOR: even if the model calls it a story, a bare blurb with almost no collected text is a non-story
// (the crawler got nothing but a caption). This deterministic backstop catches the "photo post" case if the LLM
// is too generous. Returns the editorial verdict, or null on error (caller decides fail-open vs fail-closed).
export async function editorialReview({ topic, bundle, reviewImpl = defaultReview, minSubstance = 4, minTextForStory = 220 } = {}) {
  let raw;
  try { raw = await reviewImpl({ topic, bundle }); } catch { return null; }
  const v = normalize(raw, topic);
  if (!v) return null;
  // NICHE GATE (owner's hard rule): a subject outside our Hollywood/Western-entertainment niche — a politician, a
  // royal, a business figure, a pure athlete — is REJECTED here, before we ever write it. Reuses the reject path.
  if (!v.inScope) {
    v.isStory = false;
    v.rejectReason = `outside our entertainment niche${v.outOfNicheReason ? ` (${v.outOfNicheReason})` : " (a politician / royal / business / non-entertainment figure)"}`;
    return v;
  }
  const seedText = (bundle.sources || []).filter((s) => !s.corroborating).map((s) => s.text || "").join(" ").trim();
  // Hard non-story backstop: only a thin blurb was collected AND the model wasn't confident it's substantive.
  if (v.isStory && (v.substanceScore < minSubstance || seedText.length < minTextForStory)) {
    v.isStory = false;
    v.rejectReason = v.rejectReason || `thin source — only ${seedText.length} chars of real content collected (substance ${v.substanceScore}/10); no substantive story to tell`;
  }
  return v;
}
