// INSIDE lane — MONITOR TESTS (offline: temp content dirs, injected getTweet/harvest/editorial/store).
// Covers: dead-embed drop (incl. the frontmatter-undefined regression), the >=2-new-voices top-up
// rule with the FULL-harvest fingerprint dedup (harvestQuoteKeys), the editorial wall on unattended
// top-ups (fail-closed), parent retract/correct cascade (one-shot), the 72h window, dry-run no-writes.
// Run: node site/pipeline/inside/test/monitor.test.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

import { monitorInside } from "../monitor.mjs";
import { writeInsideArticle } from "../assemble.mjs";
import { loadStore, recordInsidePublished } from "../store.mjs";
import { norm } from "../reactionFinder.mjs";
import { NOW, tmp, fakeTrigger, fakeAngle, fakeFactBlock, fakeArticle, fakeImage, NAMED, TWEET_ID_A, TWEET_ID_B, statsFor } from "./fixtures.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (name, cond, detail = "") => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; fails.push(name); console.log(`  ❌ ${name}  ${detail}`); } };

console.log("\n=== INSIDE MONITOR TESTS (offline) ===\n");

const hoursAgo = (h) => new Date(NOW - h * 36e5).toISOString();
const emptyStore = () => loadStore(path.join(tmp("inside-monstore"), "store.json"));
const harvestNone = async () => ({ ok: false });
const tweetDead = async () => { throw new Error("404"); };
const edOK = async () => ({ ran: true, reject: false });
const qk = (r) => norm(r.quote).slice(0, 90);
const fbOf = (named) => ({ reactions: named, aggregateFans: [], tweetIds: [], sources: [], stats: statsFor(named, []) });

// Publish a real inside article into `dir` and return its slug + file path.
function plant(dir, { form = "peer-tributes", title, parentSlug = null, tweetIds = [], renderTweetIds = [], date = hoursAgo(6) } = {}) {
  const factBlock = fakeFactBlock(form, { tweetIds });
  const article = fakeArticle({ form, factBlock, title });
  renderTweetIds.forEach((id, i) => { if (id) article.reactionsRender[i].tweetId = id; });
  const trigger = fakeTrigger({ parentSlug });
  const out = writeInsideArticle({ article, trigger, angle: fakeAngle(form), factBlock, image: fakeImage(), dateISO: date, dir });
  return { slug: out.slug, fp: out.path, trigger, factBlock };
}

// ── 1) One combined real run over dirA: dead embeds + top-up + fingerprint dedup + editorial
//       fail-closed + 1-straggler + healthy parent + window ─────────────────────────────────────
{
  console.log("— dead embeds, top-up, fingerprint, editorial wall, window (one live monitor pass) —");
  const dir = tmp("inside-monA");
  const store = emptyStore();

  // healthy parent stub (news lane, not watched by the inside monitor)
  fs.writeFileSync(path.join(dir, "rex-harmon-dead-at-70.md"),
    matter.stringify("\nparent body\n", { title: "Rex Harmon Dead at 70", slug: "rex-harmon-dead-at-70", formatTag: "news", date: hoursAgo(12) }));

  const embeds = plant(dir, { form: "peer-tributes", title: "Embeds Article: Stars React to Rex Harmon", tweetIds: [TWEET_ID_A, TWEET_ID_B], renderTweetIds: [TWEET_ID_A, TWEET_ID_B] });
  const topup = plant(dir, { form: "cast-crew-voices", title: "Topup Article: Midnight Circuit Crew Speaks" });
  const straggler = plant(dir, { form: "single-voice", title: "Straggler Article: Mira Vale Responds" });
  const fingerprint = plant(dir, { form: "cast-crew-voices", title: "Fingerprint Article: Crew Reactions Continue" });
  const edfail = plant(dir, { form: "cast-crew-voices", title: "Edfail Article: More Voices Arrive" });
  const healthy = plant(dir, { form: "ripple-effects", title: "Healthy Parent Article: What Happens Now", parentSlug: "rex-harmon-dead-at-70" });
  const old = plant(dir, { form: "breakout-spotlight", title: "Old Article: Who Is Tomas Reyes", date: hoursAgo(80) });

  recordInsidePublished(store, { parentEventSlug: "rex-harmon-dies", form: "cast-crew-voices", slug: topup.slug, title: "t", angle: fakeAngle("cast-crew-voices"), trigger: topup.trigger }, { now: new Date(NOW) });
  recordInsidePublished(store, { parentEventSlug: "rex-harmon-dies", form: "single-voice", slug: straggler.slug, title: "t", angle: fakeAngle("single-voice"), trigger: straggler.trigger }, { now: new Date(NOW) });
  // fingerprint rec: the ORIGINAL harvest also saw okafor+studio (they just weren't carded) —
  // harvestQuoteKeys carries them, so they must never re-append as "new".
  recordInsidePublished(store, {
    parentEventSlug: "rex-harmon-fp", form: "cast-crew-voices", slug: fingerprint.slug, title: "t",
    harvestQuoteKeys: [NAMED.mira, NAMED.onder, NAMED.okafor, NAMED.studio].map(qk),
    angle: fakeAngle("cast-crew-voices", { key: "fp" }), trigger: fingerprint.trigger,
  }, { now: new Date(NOW) });
  recordInsidePublished(store, { parentEventSlug: "rex-harmon-edfail", form: "cast-crew-voices", slug: edfail.slug, title: "t", angle: fakeAngle("cast-crew-voices", { key: "edfail" }), trigger: edfail.trigger }, { now: new Date(NOW) });

  const harvestImpl = async (trigger, angle) => {
    if (angle.key === "fp" || angle.key === "edfail") return { ok: true, factBlock: fbOf([NAMED.okafor, NAMED.studio]) }; // 2 voices "new" vs the cards
    if (angle.form === "cast-crew-voices") return { ok: true, factBlock: fbOf([NAMED.mira, NAMED.okafor, NAMED.studio]) }; // dup + TWO genuinely new
    if (angle.form === "single-voice") return { ok: true, factBlock: fbOf([NAMED.mira, NAMED.tomas]) }; // dup + only ONE new → not an update
    return { ok: false };
  };
  const editorialImpl = async ({ angle }) => (angle?.key === "edfail" ? { ran: false, reject: false, reason: "editorial error: 529" } : { ran: true, reject: false });
  const getTweetImpl = async (id) => { if (id === TWEET_ID_A) return { text: "still up" }; throw new Error("deleted"); };

  const r = await monitorInside({ dir, harvestImpl, editorialImpl, getTweetImpl, storeImpl: store, dryRun: false, nowMs: NOW });
  const by = Object.fromEntries(r.results.map((x) => [x.slug, x]));

  check("only fresh inside articles are watched (not the parent, not the 80h-old one)",
    r.watched === 6 && !by[old.slug] && !by["rex-harmon-dead-at-70"], JSON.stringify(r));

  // dead embeds — this is the path that used to throw on gray-matter undefined
  check("dead embed run is an UPDATE, not an ERROR", by[embeds.slug]?.action === "UPDATED" && /embeds 2→1/.test(by[embeds.slug]?.reason), JSON.stringify(by[embeds.slug]));
  const emFM = matter.read(embeds.fp).data;
  check("dead tweetId dropped from frontmatter tweetIds", JSON.stringify(emFM.tweetIds) === JSON.stringify([TWEET_ID_A]));
  check("alive reaction keeps its tweetId", emFM.reactions[0].tweetId === TWEET_ID_A);
  check("dead reaction's tweetId key removed entirely (no undefined poisoning)",
    !("tweetId" in emFM.reactions[1]) && !matter.read(embeds.fp).content.includes("undefined"));
  check("native quote text stays canonical after the embed drop", emFM.reactions[1].quote === fakeFactBlock("peer-tributes").reactions[1].quote);

  // top-up (editor approved, 2 genuinely new voices)
  check("top-up appended exactly the 2 genuinely-new voices", by[topup.slug]?.action === "UPDATED" && /\+2 new voices/.test(by[topup.slug]?.reason), JSON.stringify(by[topup.slug]));
  const tuFM = matter.read(topup.fp).data;
  check("new voices landed in frontmatter reactions (2 → 4)", tuFM.reactions.length === 4 && tuFM.reactions.some((x) => x.speaker === "Lena Okafor") && tuFM.reactions.some((x) => x.speaker === "Meridian Pictures"));
  check("duplicate quote was NOT re-appended", tuFM.reactions.filter((x) => x.speaker === "Mira Vale").length === 1);
  check("updatedCount bumped 0 → 1", tuFM.updatedCount === 1);
  check("dateModified bumped to now", tuFM.dateModified === new Date(NOW).toISOString());
  check("store update counter bumped too", store.published.find((x) => x.slug === topup.slug)?.updatedCount === 1);
  const tuRec = store.published.find((x) => x.slug === topup.slug);
  check("appended voices extend the stored harvest fingerprint",
    Array.isArray(tuRec?.harvestQuoteKeys) && tuRec.harvestQuoteKeys.includes(qk(NAMED.okafor)) && tuRec.harvestQuoteKeys.includes(qk(NAMED.studio)));

  // fingerprint dedup: original-harvest voices that never made the cards are NOT "new"
  check("voices from the ORIGINAL harvest (uncarded) never re-append as new", by[fingerprint.slug]?.action === "UNCHANGED", JSON.stringify(by[fingerprint.slug]));
  check("fingerprint article untouched on disk",
    matter.read(fingerprint.fp).data.reactions.length === 2 && matter.read(fingerprint.fp).data.updatedCount === 0);

  // editorial wall: no editor verdict → no append (fail-closed on the unattended path)
  check("editor did-not-run → top-up NOT applied (fail-closed)", by[edfail.slug]?.action === "UNCHANGED", JSON.stringify(by[edfail.slug]));
  check("edfail article untouched on disk",
    matter.read(edfail.fp).data.reactions.length === 2 && matter.read(edfail.fp).data.updatedCount === 0);

  // one straggler is not an update
  check("a single new voice is NOT an update (wave rule: >=2)", by[straggler.slug]?.action === "UNCHANGED");
  check("straggler article untouched on disk", matter.read(straggler.fp).data.updatedCount === 0 && matter.read(straggler.fp).data.reactions.length === 1);

  // healthy parent → no cascade
  check("healthy (uncorrected) parent → no cascade on the child",
    by[healthy.slug]?.action === "UNCHANGED" && !matter.read(healthy.fp).data.correction && !matter.read(healthy.fp).data.robots);
}

// ── 2) Parent cascade: retracted parent (file gone) — and it is ONE-SHOT ─────────────────────
{
  console.log("\n— parent cascade: retracted parent (one-shot) —");
  const dir = tmp("inside-monB");
  const child = plant(dir, { form: "peer-tributes", title: "Orphan Article: Stars React", parentSlug: "gone-parent" });
  const r = await monitorInside({ dir, harvestImpl: harvestNone, editorialImpl: edOK, getTweetImpl: tweetDead, storeImpl: emptyStore(), dryRun: false, nowMs: NOW });
  check("missing parent → PARENT-CASCADE (parent retracted)", r.results[0]?.action === "PARENT-CASCADE" && /parent retracted/.test(r.results[0]?.reason), JSON.stringify(r.results));
  const { data, content } = matter.read(child.fp);
  check("child noindexed", data.robots === "noindex");
  check("child carries the retraction correction note", /retracted/.test(data.correction || ""));
  check("Editor's note prepended to the body", content.trim().startsWith("> **Editor's note"));
  check("dateModified bumped by the cascade", data.dateModified === new Date(NOW).toISOString());

  // second pass: already-cascaded child is left alone — no stacked banners
  const r2 = await monitorInside({ dir, harvestImpl: harvestNone, editorialImpl: edOK, getTweetImpl: tweetDead, storeImpl: emptyStore(), dryRun: false, nowMs: NOW + 36e5 });
  check("second run → UNCHANGED (cascade already applied)", r2.results[0]?.action === "UNCHANGED" && /cascade already applied/.test(r2.results[0]?.reason), JSON.stringify(r2.results));
  const after2 = matter.read(child.fp);
  check("exactly ONE Editor's note banner after two runs", (after2.content.match(/\*\*Editor's note/g) || []).length === 1);
  check("dateModified NOT re-bumped by the no-op pass", after2.data.dateModified === new Date(NOW).toISOString());
}

// ── 3) Parent cascade: corrected parent ───────────────────────────────────────────────────────
{
  console.log("\n— parent cascade: corrected parent —");
  const dir = tmp("inside-monC");
  fs.writeFileSync(path.join(dir, "corrected-parent.md"),
    matter.stringify("\nparent body\n", { title: "Parent", slug: "corrected-parent", formatTag: "news", date: hoursAgo(12), correction: "We corrected this story." }));
  const child = plant(dir, { form: "peer-tributes", title: "Corrected Parent Child: Stars React", parentSlug: "corrected-parent" });
  const r = await monitorInside({ dir, harvestImpl: harvestNone, editorialImpl: edOK, getTweetImpl: tweetDead, storeImpl: emptyStore(), dryRun: false, nowMs: NOW });
  const mine = r.results.find((x) => x.slug === child.slug);
  check("corrected parent → PARENT-CASCADE (parent corrected)", mine?.action === "PARENT-CASCADE" && /parent corrected/.test(mine?.reason), JSON.stringify(r.results));
  const { data, content } = matter.read(child.fp);
  check("corrected-cascade child noindexed + noted", data.robots === "noindex" && /corrected/.test(data.correction || "") && content.trim().startsWith("> **Editor's note"));
}

// ── 4) Dry-run writes nothing ─────────────────────────────────────────────────────────────────
{
  console.log("\n— dry-run writes nothing —");
  const dir = tmp("inside-monD");
  const child = plant(dir, { form: "peer-tributes", title: "Dryrun Article: Stars React", parentSlug: "gone-parent", tweetIds: [TWEET_ID_B], renderTweetIds: [TWEET_ID_B] });
  const before = fs.readFileSync(child.fp, "utf8");
  const store = emptyStore();
  const r = await monitorInside({ dir, harvestImpl: harvestNone, editorialImpl: edOK, getTweetImpl: tweetDead, storeImpl: store, dryRun: true, nowMs: NOW });
  check("dry-run still REPORTS the cascade action", r.results[0]?.action === "PARENT-CASCADE");
  check("dry-run leaves the file byte-identical", fs.readFileSync(child.fp, "utf8") === before);
  check("dry-run leaves the store untouched", !fs.existsSync(store.file));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Inside monitor suite green. ✅\n");
