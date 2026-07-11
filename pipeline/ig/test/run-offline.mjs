#!/usr/bin/env node
// OFFLINE TEST SUITE — zero network, zero spend. Injects fakes via models.setMock().
// Run: node pipeline/ig/test/run-offline.mjs
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// isolate ALL state under a temp dir BEFORE importing modules that read config
process.env.TSR_SITE = fs.mkdtempSync(path.join(os.tmpdir(), "ig-test-"));
const SITE = process.env.TSR_SITE;
fs.mkdirSync(path.join(SITE, "content/articles"), { recursive: true });
fs.mkdirSync(path.join(SITE, "data/ig"), { recursive: true });

const { IG } = await import("../config.mjs");
const { setMock } = await import("../models.mjs");
const { lintScript, lintCaption, lintManifest, estimateSeconds } = await import("../lib/lint.mjs");
const { normWords, tokenDiff, extractJson, parseFrontmatter } = await import("../lib/util.mjs");
const { expandNumbers, numToWords } = await import("../agents/pronounce.mjs");
const { transcriptMatches } = await import("../agents/voice.mjs");
const { verbatimVerdict, sentenceWindows } = await import("../agents/align.mjs");
const { planTimeline } = await import("../agents/shots.mjs");
const { groupPhrases, buildAss } = await import("../agents/subs.mjs");
const { planSlots } = await import("../agents/slots.mjs");
const { isPosted, recordPosted, dayAlreadyScheduled, markDayScheduled } = await import("../lib/ledger.mjs");
const { newJob, saveJob, loadJob, stageDone, holdJob } = await import("../job.mjs");
const { listCandidates, scout } = await import("../agents/scout.mjs");
const { verify } = await import("../agents/verify.mjs");
const { writeScript, mergeMidPhraseBreaks } = await import("../agents/script.mjs");
const { writeCaption } = await import("../agents/caption.mjs");

let passed = 0, failed = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { failed++; console.error(`  ✗ ${name}: ${e.message}`); });
}

const ENTITIES = [{ name: "Superman", kind: "movie" }, { name: "James Gunn", kind: "person" }];

// ── lint: script gates ──────────────────────────────────────────────────────────
const CLEAN_SCRIPT = { sentences: [
  "Superman just smashed a box office record nobody predicted.",
  "The film pulled in a huge $220M during its opening weekend.",
  "James Gunn confirmed those record numbers himself on Friday morning.",
  "And he already has a sequel dated for June 2028.",
  "Warner Bros calls this their biggest studio debut since early 2019.",
  "Because the previous champ was Aquaman back in late December.",
  "Now critics are handing it the whole franchise's best reviews in years.",
  "Fans queued up overnight in forty different cities for the first showings.",
  "Even the studio quietly admits nobody modeled an opening quite like this.",
  "So does the DC rebuild finally have its real proof?",
  "Let us know in the comments below.",
], ending: "question" };
await t("lint: clean 90+ word script passes (30-40s floor)", () => {
  assert.deepEqual(lintScript(CLEAN_SCRIPT, ENTITIES), []);
});
await t("lint: ending gate — fact-then-ask is REJECTED, question-then-ask passes", async () => {
  const { lintEnding } = await import("../agents/engage.mjs");
  assert.deepEqual(lintEnding(CLEAN_SCRIPT.sentences, "comments"), []);
  const factThenAsk = [...CLEAN_SCRIPT.sentences.slice(0, 9), "The daughters were flower girls.", "Send this to a Swiftie."];
  assert.ok(lintEnding(factThenAsk, "comments").length >= 1, "wrong family ask flagged");
  const noQuestion = [...CLEAN_SCRIPT.sentences.slice(0, 9), "The daughters were flower girls.", "Let us know in the comments."];
  assert.ok(lintEnding(noQuestion, "comments").some((v) => v.rule === "ending-question"), "missing question flagged");
  assert.deepEqual(lintEnding([...CLEAN_SCRIPT.sentences.slice(0, 10), "Send this to a Superman fan."], "sends"), []);
});
await t("lint: greeting hook fails", () => {
  const s = { sentences: ["Welcome back, today we talk Superman and its massive opening weekend at the box office."] };
  assert.ok(lintScript(s, ENTITIES).some((v) => v.rule === "hook-greeting"));
});
await t("lint: hook without entity fails", () => {
  const s = { sentences: ["A huge box office record fell this weekend against every prediction out there."] };
  assert.ok(lintScript(s, ENTITIES).some((v) => v.rule === "hook-no-entity"));
});
await t("lint: watchbait fails", () => {
  const s = { sentences: ["Superman broke a record and you won't believe the number it hit."] };
  assert.ok(lintScript(s, ENTITIES).some((v) => v.rule === "bait"));
});
await t("lint: padding rejected (too short is a violation, never padded)", () => {
  const s = { sentences: ["Superman broke a box office record on Friday."] };
  assert.ok(lintScript(s, ENTITIES).some((v) => v.rule === "too-short"));
});

// ── lint: caption gates ─────────────────────────────────────────────────────────
const GOOD_CAP = {
  line1: "Superman just broke a box office record.",
  body: "The DC reboot opened to $220 million worldwide, according to Variety. James Gunn confirmed a 2028 sequel.",
  hashtags: ["#MovieNews", "#Superman", "#JamesGunn", "#DC"],
  cta: "Send this to a DC fan.",
  firstComment: "Did the opening surprise you?",
};
await t("lint: clean caption passes", () => assert.deepEqual(lintCaption(GOOD_CAP, ENTITIES), []));
await t("lint: 6 hashtags fails (IG hard-caps at 5)", () => {
  assert.ok(lintCaption({ ...GOOD_CAP, hashtags: [...GOOD_CAP.hashtags, "#Movies", "#Cinema"] }, ENTITIES).some((v) => v.rule === "hashtag-count"));
});
await t("lint: generic tag fails", () => {
  assert.ok(lintCaption({ ...GOOD_CAP, hashtags: ["#fyp", "#Superman", "#DC"] }, ENTITIES).some((v) => v.rule === "generic-tag"));
});
await t("lint: link fails", () => {
  assert.ok(lintCaption({ ...GOOD_CAP, body: GOOD_CAP.body + " https://x.com" }, ENTITIES).some((v) => v.rule === "link"));
});
await t("lint: line1 without entity fails", () => {
  assert.ok(lintCaption({ ...GOOD_CAP, line1: "A huge record fell at theaters." }, ENTITIES).some((v) => v.rule === "line1-no-entity"));
});

await t("lint: repeated fact fails (loop = replay flow, not restatement)", () => {
  const s = { sentences: [
    "Adam Sandler officiated Travis Kelce and Taylor Swift's wedding.",
    "Kelce reportedly cried during the vows at Madison Square Garden.",
    "One attendee said Kelce was more emotional than the bride.",
    "Swift sang part of her vows during the ceremony itself.",
    "Stevie Nicks performed at the reception for the couple.",
    "Adam Sandler officiated the ceremony at Madison Square Garden.",
  ] };
  assert.ok(lintScript(s, [{ name: "Adam Sandler" }]).some((v) => v.rule === "repetition"));
});
await t("caption: auto-repair moves body hashtags into the array + trims line1", async () => {
  const { repairCaption } = await import("../agents/caption.mjs");
  const fixed = repairCaption(
    {
      line1: "Travis Kelce reportedly cried during Taylor Swift's wedding vows at MSG this weekend",
      body: "The ceremony stunned fans. #TravisKelce #TaylorSwift",
      hashtags: ["#CelebrityNews"],
      cta: "Send this to a Swiftie.",
      firstComment: "Were you surprised?",
    },
    [{ name: "Travis Kelce" }, { name: "Taylor Swift" }],
  );
  assert.ok(!/#/.test(fixed.body), "hashtags stripped from body");
  assert.ok(fixed.hashtags.length >= 3 && fixed.hashtags.length <= 5, `tags: ${fixed.hashtags}`);
  assert.ok(fixed.line1.length <= 70, `line1 ${fixed.line1.length}: ${fixed.line1}`);
  assert.deepEqual(lintCaption(fixed, [{ name: "Travis Kelce" }, { name: "Taylor Swift" }]), []);
});
await t("pronounce: easy names never trigger the LLM respell", async () => {
  const { pronounce } = await import("../agents/pronounce.mjs");
  let llmCalled = false;
  setMock(({ kind }) => { if (kind === "llm") { llmCalled = true; return { respell: "wrong-guess" }; } });
  const r = await pronounce(["Adam Sandler and Brad Pitt attended."], [{ name: "Adam Sandler", kind: "person" }, { name: "Brad Pitt", kind: "person" }]);
  assert.ok(!llmCalled, "no LLM call for easy names");
  assert.ok(r.speakable[0].includes("Sandler"), "name untouched");
  setMock(null);
});

// ── pronounce ───────────────────────────────────────────────────────────────────
await t("pronounce: $220M expands", () => {
  assert.equal(expandNumbers("It hit $220M fast"), "It hit two hundred twenty million dollars fast");
});
await t("pronounce: 132,500 expands", () => {
  assert.ok(expandNumbers("about 132,500 tickets").includes("one hundred thirty-two thousand five hundred"));
});
await t("pronounce: numToWords 1.2", () => assert.equal(numToWords(1.2), "one point two"));

// ── verbatim wall ───────────────────────────────────────────────────────────────
const SCRIPT_TXT = "Superman just smashed a box office record nobody saw coming. James Gunn confirmed the numbers Friday.";
await t("verbatim: exact passes", () => {
  assert.ok(verbatimVerdict(SCRIPT_TXT, { text: SCRIPT_TXT }).pass);
});
await t("verbatim: whisper-level noise passes", () => {
  assert.ok(verbatimVerdict(SCRIPT_TXT, { text: SCRIPT_TXT.replace("smashed", "smashd").replace("Friday", "friday") }).pass);
});
await t("verbatim: ad-lib paragraph fails", () => {
  const adLib = "This is huge! " + SCRIPT_TXT + " We'll have more updates soon. Stay tuned everyone!";
  assert.ok(!verbatimVerdict(SCRIPT_TXT, { text: adLib }).pass);
});
await t("verbatim: dropped sentence fails", () => {
  assert.ok(!verbatimVerdict(SCRIPT_TXT, { text: "Superman just smashed a box office record nobody saw coming." }).pass);
});
await t("voice precheck: transcriptMatches mirrors the wall", () => {
  assert.ok(transcriptMatches(SCRIPT_TXT, SCRIPT_TXT));
  assert.ok(!transcriptMatches(SCRIPT_TXT, "Hello and welcome to movie news, lots to cover today my friends!"));
});
await t("voice v2: scoring + floor logic (the automation's ear)", async () => {
  const { scoreTake, passesFloor } = await import("../agents/voice.mjs");
  const good = { flow: 9, energy: 8, pauseQuality: 8, soundsRobotic: false };
  const bad = { flow: 7, energy: 6, pauseQuality: 5, soundsRobotic: false }; // the owner-rejected take's real scores
  assert.ok(passesFloor(good, { count: 0, max: 0 }), "engaging take passes");
  assert.ok(!passesFloor(bad, { count: 0, max: 0 }), "the flat take is now rejected");
  assert.ok(scoreTake(good, { count: 3, max: 0.9 }) < scoreTake(good, { count: 0, max: 0 }), "dead-air gaps cost points");
  assert.ok(scoreTake({ ...good, soundsRobotic: true }, { count: 0, max: 0 }) < scoreTake(good, { count: 0, max: 0 }), "robotic penalty");
});

// ── alignment → sentence windows ────────────────────────────────────────────────
const WORDS = SCRIPT_TXT.split(" ").map((w, i) => ({ w, t0: i * 0.3, t1: i * 0.3 + 0.25 }));
await t("align: sentence windows are ordered and cover the words", () => {
  const wins = sentenceWindows(["Superman just smashed a box office record nobody saw coming.", "James Gunn confirmed the numbers Friday."], WORDS);
  assert.equal(wins.length, 2);
  assert.ok(wins[0].t0 < wins[0].t1 && wins[1].t0 >= wins[0].t1 - 0.3);
});

await t("align: display words keep SCRIPT spelling with whisper timing", async () => {
  const { alignDisplayWords } = await import("../agents/align.mjs");
  const whisper = [
    { w: "Travis", t0: 0.0, t1: 0.3 }, { w: "Kelsey", t0: 0.35, t1: 0.7 }, // whisper misheard Kelce
    { w: "cried", t0: 0.75, t1: 1.0 }, { w: "during", t0: 1.05, t1: 1.3 },
    { w: "the", t0: 1.32, t1: 1.4 }, { w: "vows", t0: 1.45, t1: 1.8 },
  ];
  const out = alignDisplayWords(["Travis Kelce cried during the vows"], whisper);
  assert.equal(out.length, 6);
  assert.equal(out[1].w, "Kelce", "script spelling wins");
  assert.equal(out[1].t0, 0.35, "whisper timing kept");
  assert.ok(out.every((w) => w.t0 !== null && w.t1 > w.t0));
});

// ── REV 3: scene director + composites + engagement ─────────────────────────────
await t("scenes: multi-name beat + event beat + carry inheritance", async () => {
  const { buildBeats, subjectsInSentence } = await import("../agents/scenes.mjs");
  const ents = [
    { name: "Travis Kelce", kind: "person" }, { name: "Taylor Swift", kind: "person" },
    { name: "Adam Sandler", kind: "person" }, { name: "the wedding", kind: "event" },
  ];
  const sentences = [
    "Travis Kelce cried during his wedding vows to Taylor Swift.",
    "He was more emotional than anyone expected.",
    "Adam Sandler officiated the ceremony.",
    "Would you have Adam Sandler and Taylor Swift at your party?",
  ];
  const windows = sentences.map((_, i) => ({ t0: i * 3, t1: i * 3 + 2.8 }));
  const beats = buildBeats({ sentences, windows, entities: ents });
  assert.equal(beats[0].kind, "event", "wedding sentence = event beat");
  assert.ok(beats[0].subjects[0] === "the wedding", "event owns the beat");
  assert.deepEqual(beats[1].subjects, [beats[0].subjects[0]].slice(0, 1), "carry inherits");
  assert.equal(beats[3].kind, "duo");
  assert.deepEqual(subjectsInSentence(sentences[3], ents).sort(), ["Adam Sandler", "Taylor Swift"]);
});
await t("planFromBeats: duo beat gets a composite covering both subjects", async () => {
  const { planFromBeats } = await import("../agents/shots.mjs");
  const shotsMod = await import("../agents/shots.mjs");
  // stub composeFrame via images that exist? composeFrame shells out — instead verify the
  // planner falls back to singles when only one subject has imagery, and uses subjects[]
  const beats = [
    { i: 0, t0: 0, t1: 3, subjects: ["A B"], kind: "single", text: "A B did a thing." },
    { i: 1, t0: 3, t1: 6, subjects: ["A B", "C D"], kind: "duo", text: "A B and C D together." },
  ];
  const images = { "A B": ["/tmp/a.jpg"], "C D": [] }; // C D imageless → falls to single
  const shots = planFromBeats({ beats, images, duration: 6, dir: "/tmp", primary: "A B" });
  assert.ok(shots.length >= 2);
  assert.ok(shots.every((s) => Array.isArray(s.subjects) && s.subjects.length >= 1));
  assert.ok(shots.every((s) => s.img), "every shot has an image");
});
await t("lint: composite subjects satisfy entity-sync; imageless = soft unshowable flag", () => {
  const words = [
    { w: "Travis", t0: 0.0, t1: 0.3 }, { w: "and", t0: 0.35, t1: 0.5 },
    { w: "Taylor", t0: 0.55, t1: 0.9 }, { w: "with", t0: 1.0, t1: 1.2 },
    { w: "Sandler", t0: 1.3, t1: 1.7 },
  ];
  const ents = [{ name: "Travis Kelce" }, { name: "Taylor Swift" }, { name: "Adam Sandler" }];
  const shots = [{ t0: 0, t1: 2.0, entity: "Travis Kelce + Taylor Swift", subjects: ["Travis Kelce", "Taylor Swift"], img: "/tmp/x.jpg" }];
  const v = lintManifest(shots, words, 2.0, ents);
  assert.ok(!v.some((x) => x.rule === "entity-sync"), "composite covers both spoken names");
  assert.ok(v.some((x) => x.rule === "unshowable-mention" && /Sandler/.test(x.detail)), "imageless Sandler flagged softly");
});
await t("engage v2: goal fallback + ask families cover all goals", async () => {
  const { pickGoal, ASK_FAMILIES } = await import("../agents/engage.mjs");
  setMock(({ kind }) => (kind === "llm" ? { goal: "saves", why: "release date story", cta: "Save this.", firstComment: "It lands June 2028." } : undefined));
  const g = await pickGoal({ facts: { storyOneLine: "s", mood: "fun", entities: [], facts: [] }, segment: "x" });
  assert.equal(g.goal, "saves");
  assert.ok(g.family.patterns.some((re) => re.test("Save this for release day.")));
  setMock(() => { throw new Error("llm down"); });
  const g2 = await pickGoal({ facts: { storyOneLine: "s", mood: "fun", entities: [], facts: [] }, segment: "x" });
  assert.equal(g2.goal, "comments", "LLM outage → safe default");
  assert.ok(ASK_FAMILIES.sends.patterns.some((re) => re.test("Send this to your group chat.")));
  setMock(null);
});

// ── shot timeline: the entity-timed signature move ──────────────────────────────
await t("shots: entity image lands when the name is spoken", () => {
  const images = { Superman: ["/tmp/sup1.jpg", "/tmp/sup2.jpg"], "James Gunn": ["/tmp/gunn1.jpg"] };
  const duration = WORDS[WORDS.length - 1].t1 + 0.3;
  const shots = planTimeline({ words: WORDS, duration, entities: ENTITIES, images, primary: "Superman" });
  assert.ok(shots.length >= 3, `got ${shots.length} shots`);
  const gunnAt = WORDS.findIndex((w) => w.w === "Gunn") * 0.3;
  const gunnShot = shots.find((s) => s.entity === "James Gunn");
  assert.ok(gunnShot, "James Gunn gets a shot");
  assert.ok(Math.abs(gunnShot.t0 - gunnAt) <= 1.0, `gunn shot at ${gunnShot.t0} vs spoken ${gunnAt}`);
  assert.deepEqual(lintManifest(shots, WORDS, duration, ENTITIES).filter((v) => v.rule === "entity-sync"), []);
});
await t("shots: no shot exceeds max static duration", () => {
  const images = { Superman: ["/tmp/sup1.jpg"] };
  const longWords = Array.from({ length: 40 }, (_, i) => ({ w: i === 0 ? "Superman" : `word${i}`, t0: i * 0.35, t1: i * 0.35 + 0.3 }));
  const shots = planTimeline({ words: longWords, duration: 14, entities: [ENTITIES[0]], images, primary: "Superman" });
  assert.ok(shots.every((s) => s.t1 - s.t0 <= IG.maxShotSec + 0.05), JSON.stringify(shots.map((s) => +(s.t1 - s.t0).toFixed(2))));
});

// ── subtitles ───────────────────────────────────────────────────────────────────
await t("subs: karaoke ASS has \\k timing + emphasis style", () => {
  const emph = [new Set(["superman"]), new Set(["friday"])];
  const wins = sentenceWindows(["Superman just smashed a box office record nobody saw coming.", "James Gunn confirmed the numbers Friday."], WORDS);
  const file = buildAss({ slug: "test-subs", words: WORDS, sentenceWindows: wins, emphasisSets: emph });
  const ass = fs.readFileSync(file, "utf8");
  assert.ok(ass.includes("\\k"), "karaoke tags");
  assert.ok(ass.includes("\\b1"), "emphasis bold");
  assert.ok(ass.includes(`PlayResX: ${IG.width}`));
});
await t("subs: phrase grouping breaks on gaps and length", () => {
  const words = [
    { w: "a", t0: 0, t1: 0.2 }, { w: "b", t0: 0.25, t1: 0.4 }, { w: "c", t0: 0.45, t1: 0.6 },
    { w: "d", t0: 0.65, t1: 0.8 }, { w: "e", t0: 0.85, t1: 1.0 },
    { w: "f", t0: 2.0, t1: 2.2 },
  ];
  const groups = groupPhrases(words);
  assert.equal(groups.length, 3); // 4-word cap then gap-break
});

// ── slots ───────────────────────────────────────────────────────────────────────
await t("slots: breaking goes now, others spaced ≥2h, jitter deterministic", () => {
  const jobs = [
    { id: "breaking-story", scout: { breaking: true } },
    { id: "story-two", scout: { breaking: false } },
    { id: "story-three", scout: { breaking: false } },
  ];
  const now = new Date("2026-07-10T14:00:00Z");
  const a1 = planSlots(jobs, { now });
  const a2 = planSlots(jobs, { now });
  assert.deepEqual(a1, a2, "deterministic");
  assert.equal(a1[0].slot, "breaking");
  assert.ok(new Date(a1[0].whenISO) - now < 10 * 60000);
  assert.ok(new Date(a1[2].whenISO) - new Date(a1[1].whenISO) >= 2 * 3600e3);
});

// ── ledgers ─────────────────────────────────────────────────────────────────────
await t("ledger: dedup across my ledger AND the old lane's", () => {
  assert.ok(!isPosted("fresh-slug"));
  recordPosted({ slug: "fresh-slug", mode: "draft" });
  assert.ok(isPosted("fresh-slug"));
  fs.mkdirSync(path.join(SITE, "data/video"), { recursive: true });
  fs.writeFileSync(path.join(SITE, "data/video/posted.json"), JSON.stringify({ posts: [{ slug: "old-lane-slug" }] }));
  assert.ok(isPosted("old-lane-slug"), "old cross-poster slug blocked");
});
await t("ledger: one-whole-day guard", () => {
  assert.ok(!dayAlreadyScheduled("2026-07-10"));
  markDayScheduled("2026-07-10");
  assert.ok(dayAlreadyScheduled("2026-07-10"));
});

// ── job resume ──────────────────────────────────────────────────────────────────
await t("job: stages persist and resume; hold is sticky", () => {
  let job = saveJob(newJob({ slug: "resume-me", title: "T" }));
  stageDone(job, "gather");
  stageDone(job, "verify");
  const re = loadJob("resume-me");
  assert.deepEqual(re.done, ["gather", "verify"]);
  assert.equal(re.stage, "sensitive");
  holdJob(re, "script", "test hold");
  assert.equal(loadJob("resume-me").hold.reason, "test hold");
});

// ── frontmatter + article scan ─────────────────────────────────────────────────
await t("scout: candidate scan honors category/rumor/freshness/dedup", async () => {
  const body = Array.from({ length: 30 }, (_, i) => `Sentence ${i} of substantial reporting with concrete verified details about the story at hand.`).join(" ");
  const write = (slug, extra) =>
    fs.writeFileSync(path.join(SITE, "content/articles", `${slug}.md`),
      `---\ntitle: "T ${slug}"\ncategory: ${extra.cat}\ndate: "${extra.date}"\n${extra.more || ""}---\n${body}\n`);
  const now = new Date();
  const fresh = now.toISOString();
  write("cand-movie", { cat: "movies", date: fresh });
  write("cand-rumor", { cat: "celebrity", date: fresh, more: "storyStatus: RUMOR\n" });
  write("cand-old", { cat: "movies", date: new Date(now - 10 * 864e5).toISOString() });
  write("cand-music", { cat: "music", date: fresh });
  write("old-lane-slug", { cat: "movies", date: fresh }); // already in old ledger
  const c = listCandidates({ now });
  const slugs = c.map((x) => x.slug);
  assert.ok(slugs.includes("cand-movie"));
  assert.ok(!slugs.includes("cand-rumor"));
  assert.ok(!slugs.includes("cand-old"));
  assert.ok(!slugs.includes("cand-music"));
  assert.ok(!slugs.includes("old-lane-slug"));
});

await t("scout: mocked scoring + variety cap", async () => {
  setMock(({ kind }) => {
    if (kind !== "llm") return undefined;
    return { scores: [
      { slug: "cand-movie", score: 90, sendability: 9, breaking: false, segment: "Box Office in 30" },
    ] };
  });
  const slate = await scout({ limit: 3 });
  assert.equal(slate.length, 1);
  assert.equal(slate[0].slug, "cand-movie");
  setMock(null);
});

// ── verify agent (mocked LLM, real walls) ──────────────────────────────────────
await t("verify: fabricated quote → hold; unsupported → cut; thin → hold", async () => {
  setMock(({ kind }) => (kind === "llm" ? { verdicts: [{ i: 0, verdict: "supported" }, { i: 1, verdict: "supported" }, { i: 2, verdict: "unsupported" }, { i: 3, verdict: "supported" }] } : undefined));
  const facts = {
    articleText: 'Superman opened to $220 million. James Gunn said "the fans made this happen" on Friday. A sequel is dated.',
    facts: [
      { claim: "Superman opened to $220 million.", quote: false, surprise: 9 },
      { claim: 'James Gunn said "the fans made this happen".', quote: true, surprise: 7 },
      { claim: "The film cost $300 million.", quote: false, surprise: 6 },
      { claim: "A sequel is dated.", quote: false, surprise: 5 },
    ],
    numbers: ["$220 million"],
  };
  const r = await verify(facts);
  assert.equal(r.hold, null);
  assert.equal(r.facts.length, 3);
  assert.equal(r.cuts.filter((c) => c.type === "claim").length, 1);
  // fabricated quote
  const bad = { ...facts, facts: [{ claim: 'Gunn said "this movie saved cinema forever".', quote: true, surprise: 8 }, ...facts.facts.slice(1)] };
  const r2 = await verify(bad);
  assert.ok(r2.hold && /quote/.test(r2.hold));
  setMock(null);
});

// ── writer + caption loops honor the linter (mocked) ───────────────────────────
await t("writer: lint violation triggers retry with named violation, then passes (incl. ending gate)", async () => {
  const { ASK_FAMILIES } = await import("../agents/engage.mjs");
  let calls = 0;
  setMock(({ kind, user }) => {
    if (kind !== "llm") return undefined;
    calls++;
    if (calls === 1)
      return { sentences: ["Welcome back everyone, huge Superman news today for all of you watching."], hookStyle: "reveal", ending: "question" };
    assert.ok(/hook-greeting/.test(user), "violation named back to the writer");
    return { sentences: CLEAN_SCRIPT.sentences, hookStyle: "record-number", ending: "question" };
  });
  const r = await writeScript({
    article: { title: "T" },
    facts: { storyOneLine: "s", entities: ENTITIES, facts: [{ claim: "c", surprise: 9 }] },
    segment: "Box Office in 30",
    engage: { goal: "comments", family: ASK_FAMILIES.comments },
  });
  assert.equal(r.attempts, 2);
  assert.ok(r.script);
  assert.ok(/comments/.test(r.script.sentences[r.script.sentences.length - 1]), "ends on the comments ask");
  setMock(null);
});
await t("writer: overlong hook is deterministically split, not held (mechanical repair)", async () => {
  const { ASK_FAMILIES } = await import("../agents/engage.mjs");
  // an 18-word hook that the model refuses to shorten across all 3 attempts — the repair
  // must split it at its comma seam and ship, never hold on a purely mechanical miss.
  const LONG_HOOK = "Superman just smashed a giant box office record this weekend, and James Gunn says nobody on earth predicted it.";
  setMock(({ kind }) => {
    if (kind !== "llm") return undefined;
    return { sentences: [LONG_HOOK, ...CLEAN_SCRIPT.sentences.slice(1)], hookStyle: "record-number", ending: "question" };
  });
  const r = await writeScript({
    article: { title: "Superman box office" },
    facts: { storyOneLine: "Superman broke a box office record", entities: ENTITIES, facts: [{ claim: "c", surprise: 9 }] },
    segment: "Box Office in 30",
    engage: { goal: "comments", family: ASK_FAMILIES.comments },
  });
  assert.ok(r.script, "repaired, not held");
  assert.ok(normWords(r.script.sentences[0]).length <= 14, "hook trimmed to <=14 words");
  assert.deepEqual(lintScript(r.script, ENTITIES, "Superman box office"), [], "repaired script passes all gates");
  setMock(null);
});
await t("writer: mid-phrase break is stitched back, valid endings are left alone", () => {
  // the Brad Pitt bug: writer emitted a spurious period after a possessive → voice paused mid-thought
  assert.deepEqual(
    mergeMidPhraseBreaks(["Brad Pitt and Ines de Ramon just made their.", "public debut at the 2024 F1 Grand Prix."]),
    ["Brad Pitt and Ines de Ramon just made their public debut at the 2024 F1 Grand Prix."],
    "possessive-ended fragment merges into the next sentence",
  );
  // words that legitimately END a sentence must NOT merge (pronoun 'this', a real noun)
  assert.deepEqual(
    mergeMidPhraseBreaks(["I really like this.", "So does he win?"]),
    ["I really like this.", "So does he win?"],
    "valid endings are preserved",
  );
  assert.deepEqual(mergeMidPhraseBreaks(["He confirmed their status.", "Fans reacted."]).length, 2, "'their status' is not a break");
  setMock(null);
});
await t("caption: retry loop then full assembly", async () => {
  let calls = 0;
  setMock(({ kind }) => {
    if (kind !== "llm") return undefined;
    calls++;
    if (calls === 1) return { ...GOOD_CAP, hashtags: ["#fyp", "#Superman", "#DC"] };
    return GOOD_CAP;
  });
  const r = await writeCaption({ facts: { storyOneLine: "s", entities: ENTITIES, facts: [{ claim: "c" }] }, segment: "x" });
  assert.ok(r.caption?.full.includes("#Superman"));
  assert.equal(r.attempts, 2);
  setMock(null);
});

// ── util ────────────────────────────────────────────────────────────────────────
await t("util: extractJson survives fences and prose", () => {
  assert.deepEqual(extractJson('noise ```json\n{"a":1}\n``` more'), { a: 1 });
  assert.deepEqual(extractJson('Sure! {"b":[1,2]}'), { b: [1, 2] });
});
await t("util: frontmatter arrays", () => {
  const { data } = parseFrontmatter('---\ntitle: "X"\nsourceUrls:\n  - https://a.com\n  - https://b.com\n---\nbody');
  assert.deepEqual(data.sourceUrls, ["https://a.com", "https://b.com"]);
});
await t("util: tokenDiff basic", () => {
  assert.equal(tokenDiff(["a", "b", "c"], ["a", "x", "c"]), 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
