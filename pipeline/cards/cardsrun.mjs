// CARDS ORCHESTRATOR — one entry point, four modes:
//   node cardsrun.mjs --slate              build today's slot plan (60/40, dupGuarded)
//   node cardsrun.mjs --slot               build+publish the next due slate card (draft unless CARDS_LIVE=1)
//   node cardsrun.mjs --breaking '<json>'  sentinel-dispatched breaking story → publishNow (budgeted)
//   node cardsrun.mjs --comp '<json>'      render-only (Phase-0 comps / debugging) → writes JPEG, no publish
// Fail-closed at every stage: a story that can't be verified, imaged, written, or QC'd is
// DROPPED (logged) — never padded, never clipped, never posted anyway.
import fs from "node:fs";
import path from "node:path";
import { CARDS } from "./config.mjs";
import { costReport } from "../lib/openrouter.mjs";
import { readJson, writeJson, slugify, laParts, sleep } from "./lib/util.mjs";
import { scout } from "./agents/scout.mjs";
import { gather } from "./agents/gather.mjs";
import { classify } from "./agents/classify.mjs";
import { huntImages } from "./agents/imagehunt.mjs";
import { frame } from "./agents/framing.mjs";
import { writeHeadline } from "./agents/headline.mjs";
import { writeCaptions } from "./agents/captions.mjs";
import { factGate } from "./agents/factgate.mjs";
import { visionQC } from "./agents/visionqc.mjs";
import { renderCard } from "./render.mjs";
import { hostFile, publishCard, verifyLive, quotaGate, loadLedger, recordPost, breakingBudget } from "./publish.mjs";

const LIVE = process.env.CARDS_LIVE === "1"; // owner go-live switch (plan §7 phase 4)

// ── dedupe: a story that shares ≥3 significant stems with anything posted in 72h is a dup
const stems = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
function isDup(title, ledger) {
  const w = stems(title);
  const cut = Date.now() - 72 * 3600_000;
  for (const p of ledger.posted || []) {
    if (p.at < cut) continue;
    const shared = [...stems(p.title)].filter((x) => w.has(x));
    if (shared.length >= 3) return p.title;
  }
  return null;
}

// ── slate: plan today's slots (owner 60/40) ─────────────────────────────────────────
async function buildSlate() {
  // idempotent per LA day — a duplicate dispatch (worker retry, manual re-run) must never
  // wipe the day's slot progress. CARDS_SLATE_FORCE=1 rebuilds deliberately.
  const existing = readJson(CARDS.slatePath);
  if (existing?.dateKey === laParts().dateKey && existing?.slots?.length && process.env.CARDS_SLATE_FORCE !== "1") {
    console.log(`slate for ${existing.dateKey} already exists (${existing.slots.length} slots) — skipping`);
    return;
  }
  const ledger = loadLedger();
  const plan = await scout();
  const top = plan.stories.filter((s) => s.isTopTopic && !isDup(s.title, ledger));
  const rest = plan.stories.filter((s) => !s.isTopTopic && !isDup(s.title, ledger)).sort((a, b) => (b.viral || 0) - (a.viral || 0));
  const n = CARDS.slots.perDay;
  const nTop = Math.min(top.length, Math.round(n * CARDS.slots.topTopicShare));
  const picks = [...top.slice(0, nTop), ...rest.slice(0, n - nTop)];
  // BENCH: unused scout stories become substitutes — a dropped slot swaps one in instead of
  // dying, so gate-drops never cost the day its volume (owner mandate 2026-07-17)
  const bench = [...top.slice(nTop), ...rest.slice(n - nTop)].slice(0, 8);
  // slot times: spread across the LA window with jitter (deterministic per date for resume-safety)
  const { dateKey } = laParts();
  const windowMin = (CARDS.slots.windowEndH - CARDS.slots.windowStartH) * 60;
  const step = Math.max(CARDS.slots.minGapMin, Math.floor(windowMin / Math.max(picks.length, 1)));
  let seed = [...dateKey].reduce((a, c) => a + c.charCodeAt(0), 0);
  const slots = picks.map((story, i) => {
    seed = (seed * 9301 + 49297) % 233280; // seeded jitter — same slate on re-run, no Date.now in the math
    const jitter = Math.floor((seed / 233280) * 2 * CARDS.slots.jitterMin) - CARDS.slots.jitterMin;
    const minute = CARDS.slots.windowStartH * 60 + i * step + jitter;
    return { story, slotLA: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, status: "pending" };
  });
  writeJson(CARDS.slatePath, { dateKey, topTopic: plan.topTopic, slots, bench, builtAt: Date.now() });
  console.log(`slate ${dateKey}: ${slots.length} slots + ${bench.length} bench (${nTop} top-topic "${plan.topTopic?.name || "?"}") — ${slots.map((s) => s.slotLA).join(", ")}`);
}

// ── build one card end-to-end (shared by slot + breaking + comp) ────────────────────
async function buildCard(story, { breaking = false } = {}) {
  const pack = await gather(story);
  if (!pack) return { drop: "gather: <2 independent sources and no own article" };
  const cls = await classify(story, pack);
  if (breaking) cls.breaking = true;
  const candidates = await huntImages(story, pack);
  if (!candidates.length) return { drop: "imagehunt: no Tier-A image on whitelisted carriers" };
  const card = await writeHeadline(story, pack, cls); // retries internally with feedback
  if (!card) return { drop: "headline: could not write a faithful hook within the word cap" };
  const captions = await writeCaptions(story, pack, cls, card);
  if (!captions) return { drop: "captions: two attempts broke the platform rules" };
  const gate = await factGate({ card, captions, cls, pack });
  if (gate.verdict !== "pass") return { drop: `factgate: ${gate.problems.join("; ")}` };
  // image placement loop (owner 2026-07-17): frame each candidate (composites rejected,
  // faces centered, wide shots untouched), render, then the QC hard-fails any cut face —
  // a bad photo moves to the NEXT candidate instead of shipping or killing the story
  const failures = [];
  for (const img of candidates) {
    const fr = await frame(img.buf, story);
    if (fr.type === "composite") { failures.push(`composite rejected (${img.provenance.carrier})`); continue; }
    const { jpeg, meta } = await renderCard({
      category: cls.category, breaking,
      headline: card.headline, redSpan: card.redSpan, sub: card.sub,
      photo: img.buf, // NO creditLine — provenance is ledger-only (owner rule 2026-07-17)
      focus: { x: fr.focusX, y: fr.focusY },
    });
    const qc = await visionQC({ jpeg, card, story });
    if (qc.pass) return { jpeg, meta, card, captions, cls, pack, provenance: { ...img.provenance, framing: fr }, qc };
    failures.push(`qc ${qc.score}${qc.faceCut ? " FACE-CUT" : ""} (${img.provenance.carrier}): ${qc.problems.join("; ")}`);
  }
  return { drop: `image placement: all ${candidates.length} candidates rejected — ${failures.join(" | ")}` };
}

// last publish across ALL entries — the 10-min feed-spacing floor is global, not per-mode (review #20)
const lastPublishAt = (ledger) => Math.max(0, ...(ledger.posted || []).filter((p) => p.mode !== "draft").map((p) => p.at));

// ── slot mode ───────────────────────────────────────────────────────────────────────
async function runSlot() {
  const slate = readJson(CARDS.slatePath);
  const { dateKey, hour, minute } = laParts();
  if (!slate || slate.dateKey !== dateKey) { console.log("no slate for today — run --slate first"); return; }
  const nowMin = hour * 60 + minute;
  const due = slate.slots.find((s) => (s.status === "pending" || (s.status === "failed" && (s.attempts || 0) < 2)) && (Number(s.slotLA.slice(0, 2)) * 60 + Number(s.slotLA.slice(3))) <= nowMin);
  if (!due) { console.log("no slot due"); return; }
  const ledger = loadLedger();
  const quota = await quotaGate(ledger);
  if (!quota.ok) { console.log(`quota gate (${quota.source}): ${quota.left} left — leaving slot queued`); return; }
  if (LIVE && Date.now() - lastPublishAt(ledger) < CARDS.slots.minPublishGapMin * 60_000) {
    console.log("publish-gap floor not met — leaving slot queued for the next dispatch");
    return;
  }

  const key = slugify(due.story.title);
  try {
    const built = await buildCard(due.story);
    if (built.drop) {
      // a gate-drop swaps in a bench story instead of killing the slot (max 2 swaps) —
      // the next tick retries this slot with fresh content; volume self-heals
      if (slate.bench?.length && (due.swaps || 0) < 2) {
        const nxt = slate.bench.shift();
        console.log(`DROP [${due.story.title.slice(0, 60)}]: ${built.drop} → bench swap: "${nxt.title.slice(0, 60)}"`);
        due.swaps = (due.swaps || 0) + 1;
        due.story = nxt;
      } else {
        due.status = "dropped"; due.reason = built.drop;
        console.log(`DROP [${due.story.title.slice(0, 60)}]: ${built.drop} (bench empty — slot lost)`);
      }
      writeJson(CARDS.slatePath, slate);
      return;
    }
    fs.mkdirSync(CARDS.workDir, { recursive: true });
    const jpegPath = path.join(CARDS.workDir, `${key}.jpg`);
    fs.writeFileSync(jpegPath, built.jpeg);
    const imageUrl = await hostFile(jpegPath, `${dateKey}-${key}.jpg`);
    fs.rmSync(jpegPath, { force: true }); // hosted — keep the committed data/cards state lean
    const res = await publishCard({ imageUrl, captions: built.captions, live: LIVE }); // due slot → publishNow when live; Zernio drafts when !LIVE
    if (!res.results.length || res.results.every((r) => !r.ok)) throw new Error(`all platforms failed: ${res.results.map((r) => r.error).join(" / ") || "none attempted"}`);
    recordPost(ledger, {
      title: due.story.title, key, category: built.cls.category, breaking: false,
      imageUrl, platforms: res.results, mode: res.mode, provenance: built.provenance, qc: built.qc.score,
    });
    due.status = "posted"; due.key = key;
    writeJson(CARDS.slatePath, slate);
    console.log(`POSTED (${res.mode}) [${built.cls.category}] ${built.card.headline} — ${res.results.map((r) => `${r.platform}:${r.ok ? r.id : "FAIL " + r.error}`).join(" / ")}`);
    if (LIVE) for (const r of res.results) if (r.ok) console.log(`  verify ${r.platform}:`, JSON.stringify(await verifyLive(r.id)));
  } catch (e) {
    // a THROW (render fail-closed, hosting outage, total publish failure) must persist a status —
    // otherwise the slot rebuilds forever on every 30-min dispatch (review #9/#13/#14)
    due.attempts = (due.attempts || 0) + 1;
    due.status = due.attempts >= 2 ? "dropped" : "failed";
    due.reason = String(e.message || e).slice(0, 200);
    writeJson(CARDS.slatePath, slate);
    console.error(`SLOT FAILED (attempt ${due.attempts}) [${due.story.title.slice(0, 60)}]: ${due.reason}`);
    process.exitCode = 1;
  }
}

// ── breaking mode (sentinel dispatch) ───────────────────────────────────────────────
async function runBreaking(payloadJson) {
  const payload = JSON.parse(payloadJson);
  const story = { title: payload.title, angle: payload.angle || "", entities: payload.entities || [], sourceLinks: payload.links || [], hint: payload.hint || "news" };
  const ledger = loadLedger();
  if (isDup(story.title, ledger)) { console.log("breaking: dup of a recent post — skipping"); return; }
  const budget = breakingBudget(ledger);
  if (budget.breakingLeft <= 0) { console.log("breaking: daily BREAKING budget spent — routing to next slate instead"); return; }
  // burst accounting (plan §4, review #19): a burst = breaking posts within a 15-min window.
  const now = Date.now();
  const inBurst = (ledger.posted || []).filter((p) => p.breaking && p.at > now - 15 * 60_000).length;
  if (inBurst >= CARDS.breaking.maxBurst) { console.log(`breaking: burst full (${inBurst} in 15 min) — skipping`); return; }
  const newBurst = inBurst === 0;
  if (newBurst && budget.burstsLeft <= 0) { console.log("breaking: daily burst budget spent — skipping"); return; }
  const quota = await quotaGate(ledger);
  if (!quota.ok) { console.log(`breaking: quota gate (${quota.left} left) — refusing to burst`); return; }
  // spacing: ≥3 min after the last breaking publish AND respect the global feed floor via bounded wait
  const waitFor = Math.max(
    lastPublishAt(ledger) ? lastPublishAt(ledger) + CARDS.breaking.minPublishGapSec * 1000 - Date.now() : 0,
    0,
  );
  if (waitFor > 0) await sleep(Math.min(waitFor, 5 * 60_000));

  try {
    const built = await buildCard(story, { breaking: true });
    if (built.drop) { console.log(`breaking DROP: ${built.drop}`); return; }
    const key = slugify(story.title);
    fs.mkdirSync(CARDS.workDir, { recursive: true });
    const jpegPath = path.join(CARDS.workDir, `${key}.jpg`);
    fs.writeFileSync(jpegPath, built.jpeg);
    const imageUrl = await hostFile(jpegPath, `brk-${key}.jpg`);
    fs.rmSync(jpegPath, { force: true }); // hosted — keep the committed data/cards state lean
    const res = await publishCard({ imageUrl, captions: built.captions, live: LIVE, breaking: true });
    if (!res.results.length || res.results.every((r) => !r.ok)) throw new Error(`all platforms failed: ${res.results.map((r) => r.error).join(" / ") || "none attempted"}`);
    if (newBurst) ledger.bursts.push(Date.now()); // one entry per BURST, not per card (review #19)
    recordPost(ledger, {
      title: story.title, key, category: "breaking", breaking: true,
      imageUrl, platforms: res.results, mode: res.mode, provenance: built.provenance, qc: built.qc.score,
    });
    console.log(`BREAKING POSTED (${res.mode}) ${built.card.headline} — ${res.results.map((r) => `${r.platform}:${r.ok ? r.id : "FAIL"}`).join(" / ")}`);
    if (LIVE) for (const r of res.results) if (r.ok) console.log(`  verify ${r.platform}:`, JSON.stringify(await verifyLive(r.id)));
  } catch (e) {
    // no state to persist — the sentinel's alerted-map suppresses re-dispatch for 24h only on
    // SUCCESSFUL dispatch, and a build/publish throw here surfaces as a failed workflow run
    console.error(`BREAKING FAILED: ${String(e.message || e).slice(0, 200)}`);
    process.exitCode = 1;
  }
}

// ── comp mode (Phase-0 / debugging): full build, render to disk, never publish ──────
async function runComp(payloadJson) {
  const story = JSON.parse(payloadJson);
  const built = await buildCard(story, { breaking: Boolean(story.breaking) });
  if (built.drop) { console.log(`comp DROP: ${built.drop}`); process.exitCode = 1; return; }
  fs.mkdirSync(CARDS.workDir, { recursive: true });
  const out = path.join(CARDS.workDir, `comp-${slugify(story.title)}.jpg`);
  fs.writeFileSync(out, built.jpeg);
  console.log(JSON.stringify({ out, headline: built.card.headline, redSpan: built.card.redSpan, sub: built.card.sub, category: built.cls.category, ig: built.captions.ig, fb: built.captions.fb, qc: built.qc.score }, null, 1));
}

// ── main ────────────────────────────────────────────────────────────────────────────
const [, , mode, arg] = process.argv;
const run = { "--slate": () => buildSlate(), "--slot": () => runSlot(), "--breaking": () => runBreaking(arg), "--comp": () => runComp(arg) }[mode];
if (!run) { console.error("usage: cardsrun.mjs --slate | --slot | --breaking '<json>' | --comp '<json>'"); process.exit(2); }
run()
  .then(() => { const c = costReport(); console.log(`cost: $${c.total.toFixed(4)} across ${c.calls} calls`); })
  .catch((e) => { console.error("RUN FAILED:", e.stack || e.message); process.exit(1); });
