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
const { listCandidates, scout, isReactionArticle } = await import("../agents/scout.mjs");
const { verify } = await import("../agents/verify.mjs");
const { writeScript, mergeMidPhraseBreaks } = await import("../agents/script.mjs");
const { writeCaption } = await import("../agents/caption.mjs");
const { __test: PM } = await import("../agents/platformMeta.mjs");

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
    "Travis Kelce cried during his wedding vows to Taylor Swift.", // names the couple → show the COUPLE, not an event image
    "The wedding was the event of the year.", // names NO person → event image legitimately owns it
    "Adam Sandler officiated it.", // one person → single
    "Would you have Adam Sandler and Taylor Swift at your party?", // two people → duo
  ];
  const windows = sentences.map((_, i) => ({ t0: i * 3, t1: i * 3 + 2.8 }));
  const beats = buildBeats({ sentences, windows, entities: ents });
  // PEOPLE FIRST: a wedding sentence that names the couple shows the couple, never a reporter-ish event image
  assert.equal(beats[0].kind, "duo", "wedding sentence naming the couple = show the couple");
  assert.deepEqual([...beats[0].subjects].sort(), ["Taylor Swift", "Travis Kelce"], "the couple owns the beat");
  // only a sentence naming NO person may fall to the event image
  assert.equal(beats[1].kind, "event", "wedding sentence naming nobody = event beat");
  assert.equal(beats[1].subjects[0], "the wedding", "event owns the person-less beat");
  assert.equal(beats[2].kind, "single", "one person named = single");
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
await t("ledger: dedup on OUR ledger only — fully independent of the old lane", () => {
  assert.ok(!isPosted("fresh-slug"));
  recordPosted({ slug: "fresh-slug", mode: "draft" });
  assert.ok(isPosted("fresh-slug"), "our own posts dedup");
  // the old video automation owns Pinterest only (different platforms) — a slug it posted must NOT
  // be blocked here, and we must not even read its ledger. (independence, owner 2026-07-13)
  fs.mkdirSync(path.join(SITE, "data/video"), { recursive: true });
  fs.writeFileSync(path.join(SITE, "data/video/posted.json"), JSON.stringify({ posts: [{ slug: "old-lane-slug" }] }));
  assert.ok(!isPosted("old-lane-slug"), "old lane's slug is NOT blocked here (no cross-automation dedup)");
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
  write("cand-movie", { cat: "movies", date: fresh }); // untagged legacy → allowed as news
  write("cand-gossip", { cat: "celebrity", date: fresh, more: "formatTag: gossip\n" });
  write("cand-boxoffice", { cat: "movies", date: fresh, more: "formatTag: box-office\n" }); // OTHER automation
  write("cand-streaming", { cat: "tv", date: fresh, more: "formatTag: streaming\n" }); // OTHER automation
  write("cand-rumor", { cat: "celebrity", date: fresh, more: "storyStatus: RUMOR\n" });
  write("cand-old", { cat: "movies", date: new Date(now - 20 * 864e5).toISOString() }); // well past freshDays=10
  write("cand-music", { cat: "music", date: fresh });
  write("old-lane-slug", { cat: "movies", date: fresh, more: "formatTag: news\n" }); // also in the old ledger
  const c = listCandidates({ now });
  const slugs = c.map((x) => x.slug);
  assert.ok(slugs.includes("cand-movie"), "untagged legacy kept as news");
  assert.ok(slugs.includes("cand-gossip"), "gossip kept");
  assert.ok(!slugs.includes("cand-boxoffice"), "box-office EXCLUDED (belongs to the box-office automation)");
  assert.ok(!slugs.includes("cand-streaming"), "streaming EXCLUDED (belongs to the box-office automation)");
  assert.ok(!slugs.includes("cand-rumor"));
  assert.ok(!slugs.includes("cand-old"));
  assert.ok(!slugs.includes("cand-music"));
  assert.ok(slugs.includes("old-lane-slug"), "independent of the old lane now — no cross-lane dedup");
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

await t("scout: per-category cap scales with limit so a run can reach 7 (7/day structural fix)", async () => {
  // 14 celebrity/gossip candidates all scored high. The OLD flat cap of 2 returned just 2 (→ max 6/run
  // across 3 categories, so a run could NEVER build 7). The scaled cap (max(2, limit-2)) must let the
  // slate reach the target so one run can attempt enough to ship 7 after holds.
  const cands = Array.from({ length: 14 }, (_, i) => ({
    slug: `cel-${i}`, title: `Celebrity story number ${i} breaks today`, dek: "detail", category: "celebrity",
    date: "2026-07-15", formatTag: "gossip", body: "body", sourceUrls: [], heroImage: null,
  }));
  setMock(({ kind }) => {
    if (kind !== "llm") return undefined;
    return { scores: cands.map((c) => ({ slug: c.slug, score: 80, sendability: 8, breaking: false, segment: "Celebrity Wire" })) };
  });
  const slate15 = await scout({ limit: 15, candidates: cands });
  assert.ok(slate15.length >= 7, `single-category slate reached ${slate15.length} (need ≥7), old cap gave 2`);
  // a tiny manual run still keeps a tight variety cap
  const slate3 = await scout({ limit: 3, candidates: cands });
  assert.ok(slate3.length <= 2, `small run keeps tight cap, got ${slate3.length}`);
  setMock(null);
});

// ── verify agent (mocked LLM, real walls) ──────────────────────────────────────
await t("verify: source trusted — unverified quote/contradiction never HOLD (cut, not block)", async () => {
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
  // an unverified/altered quote no longer HOLDS — source is trusted + writer paraphrases, so it
  // drops to a normal claim and is kept
  const bad = { ...facts, facts: [{ claim: 'Gunn said "this movie saved cinema forever".', quote: true, surprise: 8 }, ...facts.facts.slice(1)] };
  const r2 = await verify(bad);
  assert.ok(!r2.hold || !/quote/.test(r2.hold), "no fabricated-quote hold");
  // a "contradicted" verdict is CUT, never a hold
  setMock(({ kind }) => (kind === "llm" ? { verdicts: [{ i: 0, verdict: "contradicted" }, { i: 1, verdict: "supported" }, { i: 2, verdict: "supported" }, { i: 3, verdict: "supported" }] } : undefined));
  const r3 = await verify(facts);
  assert.ok(!r3.hold || !/contradict/.test(r3.hold), "no contradicted hold");
  assert.ok(r3.cuts.some((c) => c.reason === "contradicted"), "contradicted claim is cut, not held");
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
await t("writer: ending-only failure is REPAIRED into a valid question+ask, never held (7/day fix)", async () => {
  const { ASK_FAMILIES, lintEnding } = await import("../agents/engage.mjs");
  // a script that clears every CONTENT gate but ends on two plain STATEMENTS (no question, no ask) —
  // the model refuses to fix it across all 3 attempts. The old repair swapped in the ask but left the
  // missing question → the story HELD. It must now ship with a guaranteed question + ask.
  const BAD_ENDING = { sentences: [
    ...CLEAN_SCRIPT.sentences.slice(0, 9),
    "The studio expects strong holds through the coming weekend.",
    "Analysts believe this rebuild is only just getting started.",
  ], ending: "question" };
  setMock(({ kind }) => { if (kind !== "llm") return undefined; return BAD_ENDING; });
  const r = await writeScript({
    article: { title: "Superman box office" },
    facts: { storyOneLine: "Superman broke a box office record", entities: ENTITIES, facts: [{ claim: "c", surprise: 9 }] },
    segment: "Box Office in 30",
    engage: { goal: "comments", family: ASK_FAMILIES.comments },
  });
  assert.ok(r.script, "repaired and shipped, NOT held");
  assert.ok(r.repairedEnding, "flagged as an ending repair");
  const sents = r.script.sentences;
  assert.ok(/\?\s*$/.test(sents[sents.length - 2].trim()), "second-to-last sentence is an audience question");
  assert.ok(/comments/i.test(sents[sents.length - 1]), "last sentence is the comments ask");
  assert.deepEqual(lintEnding(r.script.sentences, "comments"), [], "ending gate passes after repair");
  assert.deepEqual(lintScript(r.script, ENTITIES, "Superman box office"), [], "content gates still pass after repair");
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
await t("scout: reaction/social-media articles are excluded, real news is not", () => {
  // the reaction lane is a separate automation; the video lane must skip these
  assert.ok(isReactionArticle({ title: "'House of David' Season 3 Renewal Has Fans Celebrating — and Already Asking for More", tags: ["Fan Reactions", "TV Renewal"] }), "has-fans-celebrating reaction excluded");
  assert.ok(isReactionArticle({ title: "Toy Story 5 Has the Internet Divided: Pure Perfection or Milking the Franchise" }), "has-the-internet-divided excluded");
  assert.ok(isReactionArticle({ title: "Fans react to the new Superman trailer" }), "fans-react excluded");
  assert.ok(isReactionArticle({ title: "Marvel news", tags: ["Social Media Reactions"] }), "reaction tag excluded");
  // genuine news that merely names a star/event is NOT a reaction piece
  assert.ok(!isReactionArticle({ title: "Superman Smashes the July Box Office Record", tags: ["Box Office", "DC"] }), "real box-office news kept");
  assert.ok(!isReactionArticle({ title: "Timothée Chalamet Joins the Next Denis Villeneuve Film", tags: ["Casting"] }), "real casting news kept");
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

await t("platformMeta YouTube SEO: guards catch the two real failing videos, spare good ones", () => {
  const { pickPrimaryEntity, ytIssues, normTags, finalTitle } = PM;

  // Video 2 (Elliot Page) — the subject must come from the SLUG (leads with the subject), NOT prose
  // order (the one-line opens on the sender, Julia Shiplett — the exact bug the review caught).
  const elliotFacts = {
    storyOneLine: "Julia Shiplett shared a birthday tribute to Elliot Page.",
    entities: [{ name: "Julia Shiplett", kind: "person" }, { name: "Elliot Page", kind: "person" }],
    facts: [{ claim: "Julia Shiplett paid tribute to Elliot Page." }],
  };
  const elliotUrl = "https://thescreenreport.com/celebrity/elliot-page-girlfriend-julia-shiplett-give-rare-glimpse-into-romance/";
  const primary = pickPrimaryEntity(elliotFacts, elliotUrl);
  assert.equal(primary, "Elliot Page", "primary = slug subject, not the prose sender");

  // the ACTUAL shipped-bad title + description must be flagged (length + generic tail + buried subject)
  const badKinds = ytIssues({
    title: "Elliot Page's Girlfriend Julia Shiplett's Sweet Birthday Message",
    description: "Julia Shiplett shared a loving birthday tribute to Elliot Page, calling him her boo thang.",
    hashtags: ["#BirthdayTribute", "#ElliotPage"],
  }, primary, elliotFacts.entities).map((i) => i.kind);
  assert.ok(badKinds.includes("length"), "over-60 title flagged");
  assert.ok(badKinds.includes("tail"), "generic 'Sweet Birthday Message' tail flagged");
  assert.ok(badKinds.includes("lead"), "description burying Elliot Page flagged");

  // a well-formed pair passes clean (no false re-prompts) — title inside the 40-55 landing zone
  assert.equal(ytIssues({
    title: "Elliot Page Called 'Boo Thang' by Girlfriend",
    description: "Elliot Page got a sweet birthday tribute from girlfriend Julia Shiplett.",
    hashtags: ["#ElliotPage", "#JuliaShiplett"],
  }, primary, elliotFacts.entities).length, 0, "clean title+desc passes");
  // the tightened threshold (owner audit 2026-07-16): 54-60-char titles cluster past the ~40-char
  // mobile truncation — >55 now re-prompts
  assert.ok(ytIssues({
    title: "Elliot Page: 'Boo Thang' Birthday Tribute From Girlfriend", // 58 chars — old threshold let it ship
    description: "Elliot Page got a sweet birthday tribute from girlfriend Julia Shiplett.",
    hashtags: [],
  }, primary, elliotFacts.entities).some((i) => i.kind === "length"), "56-60 char title now flagged");

  // Video 1 (Bam Margera) — 67-char title flagged to shorten
  const bamFacts = {
    storyOneLine: "Bam Margera said he will never reunite with Jackass co-stars.",
    entities: [{ name: "Bam Margera", kind: "person" }, { name: "Jackass", kind: "movie" }],
    facts: [{ claim: "Bam Margera won't reunite with Jackass." }],
  };
  const bamUrl = "https://thescreenreport.com/celebrity/bam-margera-won-t-reunite-with-jackass-crew-for-final-film/";
  assert.equal(pickPrimaryEntity(bamFacts, bamUrl), "Bam Margera");
  assert.ok(ytIssues({ title: "Bam Margera: No Reunion with Johnny Knoxville 'in 10 Million Years'", description: "Bam Margera says no reunion happening.", hashtags: [] }, "Bam Margera", bamFacts.entities)
    .some((i) => i.kind === "length"), "67-char title flagged to shorten");

  // deterministic guarantees: title hard-capped at 70; hashtag gate ranks entities first, drops vague
  assert.ok(finalTitle("A".repeat(40) + " " + "B".repeat(40)).length <= 70, "title hard-capped at 70");
  const tags = normTags(["#BirthdayTribute", "#Legend"], [{ name: "Elliot Page", kind: "person" }, { name: "Legend", kind: "movie" }]);
  assert.equal(tags[0], "#ElliotPage", "entity tag ranked first");
  assert.ok(tags.includes("#Legend"), "a film literally named Legend survives the vague filter");
  assert.ok(!tags.map((x) => x.toLowerCase()).includes("#birthdaytribute"), "vague model tag dropped");
});

await t("writer: over-length script is TRIMMED to fit, never held (duration-aware mechanical repair)", async () => {
  const { ASK_FAMILIES } = await import("../agents/engage.mjs");
  // a content-clean but LONG script (over both the word cap and the ~47s render ceiling). The repair must
  // converge on BOTH words AND duration and SHIP — the review caught that the old loop trimmed only on
  // words, so a word-trimmed-but-still-long script fell through to a HOLD. (regression lock 2026-07-16)
  const LONG = [
    CLEAN_SCRIPT.sentences[0], // valid entity hook
    "The blockbuster pulled in a staggering two hundred twenty million dollars during its packed opening weekend.",
    "James Gunn personally confirmed those historic record numbers himself on Friday during an early press briefing.",
    "He also revealed a hotly anticipated sequel already has a firm release date set for June 2028.",
    "Warner Brothers proudly calls this their single biggest studio debut since the early months of 2019.",
    "Critics everywhere are now handing the ambitious picture the franchise best glowing reviews in many years.",
    "Devoted fans queued up overnight in roughly forty different major cities for the very first showings.",
    "Even the cautious studio quietly admits nobody internally modeled a massive opening weekend quite like this.",
    ...CLEAN_SCRIPT.sentences.slice(-2), // valid audience-question + comments-ask ending pair
  ];
  setMock(({ kind }) => {
    if (kind !== "llm") return undefined;
    return { sentences: LONG, hookStyle: "record-number", ending: "question" };
  });
  const r = await writeScript({
    article: { title: "Superman box office" },
    facts: { storyOneLine: "Superman broke a box office record", entities: ENTITIES, facts: [{ claim: "c", surprise: 9 }] },
    segment: "Box Office in 30",
    engage: { goal: "comments", family: ASK_FAMILIES.comments },
  });
  setMock(null);
  assert.ok(r.script && !r.hold, "over-length script trims + ships (not held)");
  assert.deepEqual(lintScript(r.script, ENTITIES), [], "trimmed script clears every lint gate incl. duration");
  const words = normWords(r.script.sentences.join(" ")).length;
  assert.ok(words >= IG.script.minWords, `trim stayed above minWords (${words} ≥ ${IG.script.minWords})`);
});

// ───────────────────────────── owner-audit root-cause locks (2026-07-16) ─────────────────────────────
await t("flywheel: learner produces real hookStyle/segment/goal weights from ≥5 scored reels (platform-merged)", async () => {
  const { appendInsight, readInsights, loadWeights } = await import("../lib/ledger.mjs");
  const { learn } = await import("../agents/learner.mjs");
  // 6 stories × (IG + YT rows) at the 24h mark — the exact shape analytics now writes (postId schema)
  const mk = (slug, hookStyle, goal, igViews, ytViews, shares, reach) => {
    appendInsight({ slug, platform: "instagram", postId: `z${slug}`, mark: 24, views: igViews, reach, shares, likes: 40, comments: 6, hookStyle, segment: "Celebrity Wire", slot: "12:00", goal, sendsPerReach: +(shares / reach).toFixed(4) });
    appendInsight({ slug, platform: "youtube", postId: `b${slug}`, mark: 24, views: ytViews, likes: 20, comments: 2, engagementRate: 1.7, hookStyle, segment: "Celebrity Wire", slot: "12:00", goal });
  };
  mk("s1", "record-number", "sends", 9000, 1200, 90, 6000);
  mk("s2", "record-number", "sends", 8000, 1500, 80, 5500);
  mk("s3", "reveal", "comments", 2000, 400, 10, 1800);
  mk("s4", "reveal", "comments", 1800, 300, 8, 1500);
  mk("s5", "reveal", "comments", 2200, 500, 12, 2000);
  mk("s6", "record-number", "sends", 7000, 1000, 70, 5000);
  const res = learn({ minSamples: 5 });
  assert.ok(res.updated, `learner updated (got: ${res.reason || "ok"})`);
  assert.ok(res.weights.hookStyles["record-number"] > res.weights.hookStyles["reveal"], "record-number outperforms reveal in weights");
  assert.ok(res.weights.goals["sends"] > res.weights.goals["comments"], "sends goal outperforms in weights");
  assert.ok(res.weights.accountMedians.samples >= 5, "≥5 platform-merged scored reels");
  const w = loadWeights();
  assert.ok(Object.keys(w.hookStyles).length >= 2, "weights persisted for the scout/writer");
});

await t("CTA rotation: different slugs see different vetted asks, all matching the lint pattern", async () => {
  const { rotatedExamples, ASK_FAMILIES } = await import("../agents/engage.mjs");
  const seen = new Set();
  for (const slug of ["kai-cenat-returns", "sofia-richie-collection", "bam-margera-reunion", "elliot-page-tribute", "lil-wayne-late"]) {
    const [ex] = rotatedExamples("comments", slug);
    seen.add(ex);
    assert.ok(ASK_FAMILIES.comments.patterns.some((re) => re.test(ex.replace(/^"|"$/g, ""))), `variant matches lint: ${ex}`);
  }
  assert.ok(seen.size >= 3, `rotation varies across slugs (saw ${seen.size} distinct)`);
});

await t("sends: signal detector + quota override flips a comments default on send-trigger stories", async () => {
  const { sendsSignal, pickGoal } = await import("../agents/engage.mjs");
  const recordFacts = { storyOneLine: "Superman just smashed the biggest box office record in a decade.", facts: [{ claim: "It set a record." }], entities: [{ name: "Superman", kind: "movie" }], mood: "epic" };
  const quietFacts = { storyOneLine: "An actor had a quiet dinner with friends.", facts: [{ claim: "They ate dinner." }], entities: [{ name: "Some Actor", kind: "person" }], mood: "neutral" };
  assert.ok(sendsSignal(recordFacts), "record story carries a sends signal");
  assert.ok(!sendsSignal(quietFacts), "quiet story does not");
  setMock(({ kind }) => (kind === "llm" ? { goal: "comments", why: "default", cta: "", firstComment: "" } : undefined));
  const forced = await pickGoal({ facts: recordFacts, segment: "Celebrity Wire", preferSends: true });
  assert.equal(forced.goal, "sends", "quota + signal overrides comments → sends");
  const notForced = await pickGoal({ facts: quietFacts, segment: "Celebrity Wire", preferSends: true });
  assert.equal(notForced.goal, "comments", "no signal → never forced");
  setMock(null);
});

await t("outlets: attribution stripped, outlet entities dropped, outlet hashtags never ship", async () => {
  const { stripOutletAttribution, isOutletTag, OUTLET_RE } = await import("../lib/util.mjs");
  assert.equal(stripOutletAttribution("Described by E! News as a whirlwind romance, they went public."), "Described as a whirlwind romance, they went public.");
  assert.equal(stripOutletAttribution("She told People the wedding was intimate."), "She said the wedding was intimate.");
  assert.ok(!/variety/i.test(stripOutletAttribution("Variety reports that the sequel is greenlit.")));
  assert.ok(isOutletTag("#ENews") && isOutletTag("#WallStreetJournal") && isOutletTag("#TIME") && !isOutletTag("#ElliotPage"));
  assert.ok(OUTLET_RE.test("E! News") && !OUTLET_RE.test("Elliot Page"), "entity filter regex");
  const tags = PM.normTags(["#ENews", "#TIME", "#WestVillagecondominium"], [{ name: "Elliot Page", kind: "person" }]);
  assert.ok(!tags.some((x) => isOutletTag(x)), "no outlet tag survives normTags");
  assert.ok(!tags.some((x) => x.length > 21), "no mashed junk tag survives normTags");
  assert.equal(tags[0], "#ElliotPage", "entity tag leads");
});

await t("stale-date: past date framed as upcoming is rejected at scout + flagged in platformMeta copy", async () => {
  const now = new Date("2026-07-15T20:00:00Z");
  const { pastDateAsUpcoming } = await import("../lib/util.mjs");
  assert.ok(pastDateAsUpcoming("Kai Cenat Announces Return to Streaming July 6th", now), "the shipped failure is caught");
  assert.ok(!pastDateAsUpcoming("Superman premieres July 18 in theaters", now), "future date passes");
  assert.ok(!pastDateAsUpcoming("Inside the party at the July 4 weekend bash", now), "past-tense past date passes");
  // scout-level: a fresh-dated article whose TITLE frames a past date as upcoming never enters the slate
  fs.writeFileSync(path.join(SITE, "content/articles/stale-date-test.md"), `---\ntitle: "Star Returns to Streaming July 6th After Break"\ncategory: celebrity\ndate: "2026-07-14"\nformatTag: news\n---\n${"A real body paragraph. ".repeat(80)}`);
  const cands = listCandidates({ now });
  assert.ok(!cands.some((c) => c.slug === "stale-date-test"), "scout rejects the stale-dated candidate");
});

await t("FB slot shift: +3h from the IG slot, 22:00-LA clamps to 23:30 same day", async () => {
  const { shiftFbSlot } = await import("../agents/publish.mjs");
  const la = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour12: false });
  const noonLA = "2026-07-15T19:00:00.000Z"; // 12:00 LA (PDT)
  assert.ok(la(shiftFbSlot(noonLA)).includes("15:00"), "12:00 LA → 15:00 LA");
  const tenPmLA = "2026-07-16T05:00:00.000Z"; // 22:00 LA
  const shifted = shiftFbSlot(tenPmLA);
  assert.ok(la(shifted).includes("23:30"), `22:00 LA clamps to 23:30 LA (got ${la(shifted)})`);
  assert.equal(new Date(shifted).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }), new Date(tenPmLA).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }), "same LA day");
});

await t("render: template rotation carries endings (≥1 loopback) and endTail ≤1s", async () => {
  const { TEMPLATES, templateFor } = await import("../agents/render.mjs");
  assert.ok(TEMPLATES.every((tp) => ["brand", "loopback"].includes(tp.ending)), "every template declares an ending");
  assert.ok(TEMPLATES.some((tp) => tp.ending === "loopback"), "loop-back ending is in rotation");
  assert.ok(IG.endTailSec <= 1.0, `endTailSec ≤ 1s (got ${IG.endTailSec})`);
  assert.ok(templateFor("any-slug"), "template picker works");
});

await t("music: cache hit costs ZERO llm calls (deterministic key, beds committed)", async () => {
  const { pickMusic, musicCacheKey } = await import("../agents/music.mjs");
  const key = musicCacheKey("Celebrity Wire", "fun");
  assert.equal(key, "gossip-glossy-fun", "deterministic key from segment+mood");
  fs.mkdirSync(IG.musicDir, { recursive: true });
  fs.writeFileSync(path.join(IG.musicDir, `${key}-1.mp3`), "x");
  fs.writeFileSync(path.join(IG.musicDir, `${key}-2.mp3`), "x");
  setMock(() => { throw new Error("llm must NOT be called on a music cache hit"); });
  const m = await pickMusic({ facts: { storyOneLine: "s", entities: [] }, mood: "fun", segment: "Celebrity Wire" });
  setMock(null);
  assert.equal(m.engine, "lyria-cache", "cache hit");
  assert.equal(m.cost, 0);
});

await t("platformMeta: agent failure falls back to deterministic FB/YT copy — never IG-only", async () => {
  const { fallbackPlatformMeta } = await import("../agents/platformMeta.mjs");
  const meta = fallbackPlatformMeta({
    caption: { line1: "Superman smashes a $220M opening record", body: "James Gunn confirmed the numbers on Friday. A sequel is dated for 2028.", hashtags: ["#Superman", "#JamesGunn", "#MovieNews"] },
    article: { title: "Superman smashes box office record" },
    facts: { entities: ENTITIES },
    articleUrl: "https://thescreenreport.com/movies/superman-record/",
  });
  assert.ok(meta, "fallback produced");
  assert.ok(meta.facebook.full.includes("AI-assisted recap"), "FB carries the AI note");
  assert.ok(meta.facebook.hashtags.length <= 2, "FB ships ≤2 hashtags");
  assert.ok(meta.youtube.title.length > 0 && meta.youtube.title.length <= 70, "YT title within hard cap");
  assert.ok(meta.youtube.description.includes("#Shorts"), "YT description carries the tag line");
  assert.ok(meta.youtube.fallback, "marked as fallback for the ledger");
});

await t("discovery: story-first rules — unknown+hot qualifies, famous+personal qualifies, famous+routine doesn't", async () => {
  const { fameFromBaseline, heatFromSpike, eventPrior, storyHeat, qualifies, starPower, scorePool } = await import("../agents/discovery.mjs");
  // fame calibration on the real validated anchors
  assert.ok(Math.abs(fameFromBaseline(84) - 18) < 4, `Wai Ching Ho baseline 84/day → ~18 fame (got ${fameFromBaseline(84).toFixed(0)})`);
  assert.ok(Math.abs(fameFromBaseline(7575) - 80) < 4, `J-Law 7.5k/day → ~80 fame (got ${fameFromBaseline(7575).toFixed(0)})`);
  // spike calibration: 254× at 21k views = max heat; 1.3× = noise; big ratio on a tiny page = 0
  assert.equal(Math.round(heatFromSpike(254, 21435, 2000)), 100, "Wai Ching Ho death spike → 100");
  assert.ok(heatFromSpike(1.3, 9000, 2000) < 15, "quiet week → noise");
  assert.equal(heatFromSpike(50, 300, 2000), 0, "spike on a tiny page (under raw-view floor) → 0");
  // the owner's case 1: unknown actress dies in a crash — heat qualifies ALONE
  const death = eventPrior({ title: "Daredevil actress dead at 82 after car crash" });
  const h1 = storyHeat({ trendScore: null, spikeHeat: heatFromSpike(254, 21435, 2000), prior: death.prior, inTrends: false });
  assert.equal(qualifies({ heat: h1, fame: fameFromBaseline(84), surprise: death.surprise }, { qualifyHeat: 60, qualifyFame: 70 }), "heat", "unknown + hot story qualifies on heat");
  // day-0 death (no wiki data yet): the event prior alone still qualifies it
  const h1b = storyHeat({ trendScore: null, spikeHeat: 0, prior: death.prior, inTrends: false });
  assert.equal(qualifies({ heat: h1b, fame: null, surprise: true }, { qualifyHeat: 60, qualifyFame: 70 }), "heat", "day-0 death qualifies on the prior");
  // the owner's case 2: J-Law dyes her hair — fame + personal-surprise beat, no spike needed
  const hair = eventPrior({ title: "Jennifer Lawrence debuts shocking new hair transformation" });
  const h2 = storyHeat({ trendScore: null, spikeHeat: 0, prior: hair.prior, inTrends: false });
  assert.equal(qualifies({ heat: h2, fame: fameFromBaseline(7575), surprise: hair.surprise }, { qualifyHeat: 70, qualifyFame: 70 }), "fame", "megastar + personal beat qualifies on fame");
  // famous + routine announcement: no auto-qualification
  const routine = eventPrior({ title: "Jennifer Lawrence attends charity gala event" });
  const h3 = storyHeat({ trendScore: null, spikeHeat: 0, prior: routine.prior, inTrends: false });
  assert.equal(qualifies({ heat: h3, fame: fameFromBaseline(7575), surprise: routine.surprise }, { qualifyHeat: 60, qualifyFame: 70 }), null, "famous + routine does NOT auto-qualify");
  // ranking: the hot unknown-death story must outrank the routine megastar story
  assert.ok(starPower({ heat: h1, fame: 18 }) > starPower({ heat: h3, fame: 80 }), "story heat outranks bare fame");
  // scorePool end-to-end with INJECTED deps (zero network): pre-scored news + spiking gossip + routine
  const deps = {
    fetchJson: async (url) => {
      if (url.includes("search/title")) return { pages: [{ key: "Test_Person" }] };
      if (url.includes("pageviews")) return { items: Array.from({ length: 16 }, (_, i) => ({ views: i >= 14 ? 25000 : 100 })) };
      return null;
    },
    fetchText: async () => "<rss><title>trends</title></rss>",
  };
  const ranked = await scorePool([
    { slug: "routine-famous", title: "Star attends gala", date: "2026-07-16", formatTag: "gossip", primaryEntity: null },
    { slug: "hot-unknown-death", title: "Actress dead at 82 in crash", date: "2026-07-15", formatTag: "gossip", primaryEntity: "Test Person" },
    { slug: "pre-scored-news", title: "Movie smashes record", date: "2026-07-16", formatTag: "news", trendScore: 88, primaryEntity: null },
  ], deps);
  assert.equal(ranked[0].slug, "hot-unknown-death", "spiking death story ranks first");
  assert.ok(ranked.find((c) => c.slug === "pre-scored-news").qualified, "trendScore 88 news qualifies");
  assert.ok(!ranked.find((c) => c.slug === "routine-famous").qualified, "routine story does not qualify");
  // fail-open: every API dead → engine still returns a full ranking (priors only), never throws
  const dead = { fetchJson: async () => null, fetchText: async () => null };
  const safe = await scorePool([{ slug: "a", title: "Star dies at 90", date: "2026-07-16", primaryEntity: "Someone" }], dead);
  assert.equal(safe.length, 1, "fail-open keeps the pool intact");
  assert.ok(safe[0].heat >= 60, "prior still scores with all APIs down");
  // entity derivation (live-run finding: most articles carry NO primaryEntity — derive from imageAlt/title)
  const { entityFromCandidate } = await import("../agents/discovery.mjs");
  assert.equal(entityFromCandidate({ primaryEntity: "Jennifer Lawrence" }), "Jennifer Lawrence", "explicit wins");
  assert.equal(entityFromCandidate({ title: "Sam Neill, Beloved 'Jurassic Park' Star, Dies at 78", imageAlt: "Sam Neill" }), "Sam Neill", "imageAlt bare name");
  assert.equal(entityFromCandidate({ title: "Sam Neill, Beloved 'Jurassic Park' Star, Dies at 78" }), "Sam Neill", "title leading name, stops at comma");
  assert.equal(entityFromCandidate({ title: "Elle Fanning and Julianne Moore to Star in New Film" }), "Elle Fanning", "title name stops at lowercase");
  assert.equal(entityFromCandidate({ title: "Danny McBride to Direct New G.I. Joe Movie" }), "Danny McBride", "two-token name");
  assert.equal(entityFromCandidate({ title: "Lost star quietly divorced husband last year" }), null, "single cap token = a show title, not a name");
  assert.equal(entityFromCandidate({ title: "", imageAlt: "Pictured: someone at the premiere event yesterday" }), null, "descriptive imageAlt rejected");
});

await t("ledger merge: rebase conflicts resolve as a UNION — posted rows can never be lost again", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-test-"));
  const script = path.resolve("pipeline/ig/scripts/merge-ledgers.mjs");
  // posted.json: the run's rows AND the remote's rows both survive (this exact conflict lost 5 stories on 07-17)
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ posts: [{ slug: "sam-neill", platform: "youtube", postId: "B", whenISO: "17:00" }] }));
  fs.writeFileSync(path.join(dir, "remote.json"), JSON.stringify({ posts: [{ slug: "wai-ching-ho", platform: "youtube", postId: "A", whenISO: "16:00" }] }));
  execFileSync("node", [script, path.join(dir, "out.json"), path.join(dir, "run.json"), path.join(dir, "remote.json")]);
  const merged = JSON.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"));
  assert.equal(merged.posts.length, 2, "both sides' posted rows kept");
  // identical rows dedupe; generic ledgers key-merge with the run winning per key
  fs.writeFileSync(path.join(dir, "run2.json"), JSON.stringify({ "slug-a": { at: "new" }, "slug-b": { at: "x" } }));
  fs.writeFileSync(path.join(dir, "remote2.json"), JSON.stringify({ "slug-a": { at: "old" }, "slug-c": { at: "y" } }));
  execFileSync("node", [script, path.join(dir, "out2.json"), path.join(dir, "run2.json"), path.join(dir, "remote2.json")]);
  const m2 = JSON.parse(fs.readFileSync(path.join(dir, "out2.json"), "utf8"));
  assert.equal(Object.keys(m2).length, 3, "key union");
  assert.equal(m2["slug-a"].at, "new", "the run's value wins per key");
  // corrupt side → the run's data survives
  fs.writeFileSync(path.join(dir, "bad.json"), "{{{");
  execFileSync("node", [script, path.join(dir, "out3.json"), path.join(dir, "run.json"), path.join(dir, "bad.json")]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "out3.json"), "utf8")).posts.length, 1, "corrupt remote → run rows kept");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
