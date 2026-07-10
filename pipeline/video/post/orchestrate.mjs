// DAILY AUTO-POSTER — 3 videos/day (movies · tv · celebrity) → Facebook, Instagram, YouTube, Pinterest.
// Slots (America/Los_Angeles): movies 10:00, tv 14:00, celebrity 18:00. Per-platform forward stagger.
// Publishing is SERVER-SIDE: we hand Buffer/Zernio a future scheduledFor and THEY fire it — so this job
// runs ONCE per day, schedules all posts, and exits (no need to stay alive; works with the laptop off).
// Does NOT touch the video pipeline (script/voice/image/render). Only reads finished videos + captions.
//
// Flags:  --live             ACTUALLY schedule real posts (fire at the slot times). Without this the job
//                            is DRAFT-SAFE: it creates drafts that never publish (safe default).
//         --now              publish immediately (shareNow) instead of at the slot time — for a live test
//         --slug=<slug>      force a specific article instead of auto-picking the top of a category
//         --category=movies  run a single category
//         --dry              plan only: print what WOULD post, call no APIs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { VIDEO } from "../config.mjs";
import { makeVideo } from "../makevideo.mjs";
import { makeCaptions } from "./captions.mjs";
import { hostVideo, hostThumb, pruneHost } from "./host.mjs";
import { postYouTube, postPinterest, bufferStatus } from "./buffer.mjs";
import { postZernio, zernioStatus } from "./zernio.mjs";
import { boardFor } from "./accounts.mjs";

const ROOT = process.env.TSR_SITE || "/Users/sivajithcu/Movie News site/site";
const OUT = VIDEO.outDir;
const LOG = path.join(ROOT, "data/video/posted.json");
const STATEF = path.join(ROOT, "data/video/daily-state.json"); // idempotency: which slot-date we already scheduled a set for
const STOP = path.join(ROOT, "data/video/POSTING_OFF"); // touch this file to pause all posting

// ── the 3 daily slots (PT wall-clock hours) + per-platform forward stagger (minutes).
// Slots are filled by RECENCY (newest story → 10am, next → 2pm, next → 6pm), not fixed to a category.
const SLOT_HOURS = [10, 14, 18];
const VIDEO_CATEGORIES = new Set(["movies", "tv", "celebrity"]);
const MAX_PER_CATEGORY = 2; // owner rule 2026-07-08: newest stories, at most 2 of the same category
const FRESH_DAYS = 7; // outer bound; newest-first sort means we almost always pick today's/yesterday's
const STAGGER = { facebook: 0, instagram: 4, youtube: 8, pinterest: 12 };

// ── America/Los_Angeles wall-clock → exact UTC Date (handles PST/PDT automatically)
function laOffsetMin(dateUTC) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(dateUTC).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - dateUTC.getTime()) / 60000; // minutes LA is ahead of UTC (e.g. -420 in PDT)
}
function laWallToUTC(y, m, d, H, M = 0) {
  const naive = Date.UTC(y, m - 1, d, H, M);
  const off = laOffsetMin(new Date(naive));
  return new Date(naive - off * 60000);
}
function laTodayParts() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}

// The ONE LA calendar day we schedule a full 10am/2pm/6pm set for: TODAY if we're still before today's
// first slot, otherwise TOMORROW. Keeping all 3 slots on a SINGLE day (never splitting a run across two
// days) is what lets the guard work: a late/duplicate run for the same day gets a matching target and is
// skipped, instead of half-filling today's remaining slots (the 2026-07-09 double-post bug).
function targetParts() {
  const { y, m, d } = laTodayParts();
  const firstSlot = laWallToUTC(y, m, d, SLOT_HOURS[0], 0);
  if (Date.now() < firstSlot.getTime() - 120000) return { y, m, d }; // still before today's 10am → today
  const p = Object.fromEntries( // else the whole set goes to tomorrow
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(firstSlot.getTime() + 864e5)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}
// publish instant for a slot hour on the target day (all slots share ONE day, so never split across days)
function slotBaseFor(hour) {
  const { y, m, d } = targetParts();
  return laWallToUTC(y, m, d, hour, 0);
}
// idempotency key: the target day. A second run for the same day is skipped (no double-post).
function targetSlotDate() {
  const { y, m, d } = targetParts();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// slugs that already had a LIVE (non-draft) successful post — cross-run dedup so we never re-post the same video
function livePostedSlugs() {
  try {
    const log = JSON.parse(fs.readFileSync(LOG, "utf8"));
    return new Set(log.filter((e) => !e.draft && e.results && Object.values(e.results).some((r) => r?.ok)).map((e) => e.slug));
  } catch { return new Set(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const categoryOfSlug = (slug) => { try { return String(matter(fs.readFileSync(path.join(ROOT, "content/articles", slug + ".md"), "utf8")).data.category || "").toLowerCase(); } catch { return null; } };

// Zernio's own docs cite a ~10% IG failure rate → one transient-error retry on the create call
async function postZernioRetry(opts) {
  let r = await postZernio(opts);
  if (!r.ok) { await sleep(4000); const r2 = await postZernio(opts); if (r2.ok) return r2; }
  return r;
}

// THE LATEST published articles from BOTH automations (news + gossip both write to content/articles/),
// newest first, video-eligible categories only, not a rumor, not already posted. Owner rule (2026-07-08):
// only the latest stories become videos — never old/repeated content.
function latestArticles(postedSlugs) {
  const dir = path.join(ROOT, "content/articles");
  const now = Date.now();
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const slug = f.slice(0, -3);
    if (postedSlugs.has(slug)) continue; // strict no-repeat
    let fm;
    try { fm = matter(fs.readFileSync(path.join(dir, f), "utf8")).data; } catch { continue; }
    const category = String(fm.category || "").toLowerCase();
    if (!VIDEO_CATEGORIES.has(category)) continue;
    if (String(fm.storyStatus).toUpperCase() === "RUMOR") continue;
    const date = Date.parse(fm.date || fm.publishedAt || 0);
    if (!date || now - date > FRESH_DAYS * 864e5) continue; // freshness floor
    out.push({ slug, category, date, title: fm.title });
  }
  return out.sort((a, b) => b.date - a.date); // newest first
}

// ensure a finished video + sidecar exist for a slug (generate if missing)
async function ensureVideo(slug) {
  const mp4 = path.join(OUT, slug + ".mp4");
  const side = path.join(OUT, slug + ".json");
  if (fs.existsSync(mp4) && fs.existsSync(side)) return { mp4, side, made: false };
  await makeVideo({ slug });
  if (!fs.existsSync(mp4)) throw new Error("video not produced");
  return { mp4, side, made: true };
}

// strip markdown (no literal *asterisks*) + dead "link in bio"/"full story at…" CTAs (they read wrong off-site)
const noMd = (s) => String(s || "")
  .replace(/[*_`~]+/g, "")
  .replace(/[\s,.—-]*\b(link in bio|full story (at|on)[^.\n]*)\.?/gi, "")
  .replace(/\s{2,}/g, " ")
  .trim();
const cleanCaps = (c) => ({
  facebook: noMd(c.facebook), instagram: noMd(c.instagram), x: noMd(c.x),
  youtube: { title: noMd(c.youtube?.title), description: noMd(c.youtube?.description) },
  pinterest: { title: noMd(c.pinterest?.title), description: noMd(c.pinterest?.description) },
});

// captions: prefer the sidecar's per-platform set; regenerate only if incomplete. Cleaned + real link appended.
async function captionsFor(sidecar, articleUrl) {
  const c = sidecar.captions || {};
  const complete = c.facebook && c.instagram && c.youtube?.title && c.youtube?.description && c.pinterest?.title && c.pinterest?.description;
  const caps = cleanCaps(complete ? c : await makeCaptions({ title: sidecar.title, hook: sidecar.onScreenTitle || sidecar.title, lines: [], category: sidecar.genre || "" }));
  // append the REAL article link where a link works (YouTube desc + Facebook; IG can't link; Pinterest uses the pin's destination URL)
  if (articleUrl) {
    caps.youtube.description = `${caps.youtube.description}\n\nFull story: ${articleUrl}`;
    caps.facebook = `${caps.facebook}\n\nFull story: ${articleUrl}`;
  }
  return caps;
}

function logPost(entry) {
  let log = [];
  try { log = JSON.parse(fs.readFileSync(LOG, "utf8")); } catch {}
  log.push(entry);
  fs.writeFileSync(LOG, JSON.stringify(log, null, 2));
}

// post ONE finished video across all 4 platforms at staggered times off `base`
async function postOne({ category, slug, base, draft, dry, immediate }) {
  const side = JSON.parse(fs.readFileSync(path.join(OUT, slug + ".json"), "utf8"));
  const articleUrl = side.articleUrl || `https://thescreenreport.com/${category}/${slug}/`;
  const caps = await captionsFor(side, articleUrl);
  // immediate: all fire now (Zernio gets a near-now time; Buffer uses shareNow). else: slot + stagger.
  const at = (plat) => new Date(base.getTime() + (immediate ? 0 : STAGGER[plat] * 60000)).toISOString();
  const plan = {
    facebook: { when: at("facebook"), caption: caps.facebook },
    instagram: { when: at("instagram"), caption: caps.instagram },
    youtube: { when: at("youtube"), title: caps.youtube.title },
    pinterest: { when: at("pinterest"), title: caps.pinterest.title, board: boardFor(category) },
  };
  if (dry) { console.log(`\n[${category}] ${slug}\n  base ${base.toISOString()}`); for (const [k, v] of Object.entries(plan)) console.log(`   ${k.padEnd(10)} ${v.when}  ${(v.title || v.caption).slice(0, 70)}`); return { slug, category, dry: true, plan }; }

  const mp4 = path.join(OUT, slug + ".mp4");
  const host = await hostVideo(mp4, slug);
  const thumb = await hostThumb(mp4, slug); // cover image (Pinterest requires it; nicer everywhere)
  const results = {};
  // sequential so the media URL is warm and we never burst
  results.facebook = await postZernioRetry({ platform: "facebook", videoUrl: host.url, caption: caps.facebook, whenISO: plan.facebook.when, draft });
  results.instagram = await postZernioRetry({ platform: "instagram", videoUrl: host.url, caption: caps.instagram, whenISO: plan.instagram.when, draft });
  results.youtube = await postYouTube({ videoUrl: host.url, thumbnailUrl: thumb.url, caps: caps.youtube, whenISO: plan.youtube.when, draft, immediate });
  results.pinterest = await postPinterest({ videoUrl: host.url, thumbnailUrl: thumb.url, caps: caps.pinterest, articleUrl, boardServiceId: plan.pinterest.board, whenISO: plan.pinterest.when, draft, immediate });

  const entry = { slug, category, hostUrl: host.url, thumbUrl: thumb.url, base: base.toISOString(), draft: !!draft, immediate: !!immediate, at: new Date().toISOString(), results };
  logPost(entry);
  const line = Object.entries(results).map(([k, r]) => `${k}:${r.ok ? "ok(" + (r.id || "") + ")" : "FAIL"}`).join("  ");
  console.log(`[${category}] ${slug}\n  ${draft ? "DRAFT " : immediate ? "LIVE-NOW " : "SCHEDULED "}${line}`);
  for (const [k, r] of Object.entries(results)) if (!r.ok) console.log(`    ✗ ${k}: ${r.error}`);
  return entry;
}

// poll each platform until it publishes (or errors / times out) — reports real outcome, not just "queued"
async function pollPublish(entry, tries = 10, gapMs = 20000) {
  const ids = { facebook: entry.results.facebook, instagram: entry.results.instagram, youtube: entry.results.youtube, pinterest: entry.results.pinterest };
  const done = {};
  for (let t = 0; t < tries; t++) {
    for (const plat of ["facebook", "instagram", "youtube", "pinterest"]) {
      if (done[plat] || !ids[plat]?.ok) continue;
      const s = plat === "youtube" || plat === "pinterest" ? await bufferStatus(ids[plat].id) : await zernioStatus(ids[plat].id);
      const st = (s.status || "").toLowerCase();
      const pst = (s.platformStatus || "").toLowerCase();
      if (["sent", "published", "success", "complete"].includes(st) || ["published", "success"].includes(pst)) done[plat] = { ok: true, ...s };
      else if (["error", "failed", "failure"].includes(st) || ["failed", "error"].includes(pst)) done[plat] = { ok: false, ...s };
    }
    if (["facebook", "instagram", "youtube", "pinterest"].every((p) => !ids[p]?.ok || done[p])) break;
    if (t < tries - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  return done;
}

async function main() {
  const args = process.argv.slice(2);
  const draft = !args.includes("--live"); // DRAFT-SAFE by default; real posts require explicit --live
  const dry = args.includes("--dry");
  const immediate = args.includes("--now");
  const onceDaily = args.includes("--once-daily"); // idempotent daily set: skip if this slot-date is already scheduled
  const forceSlug = (args.find((a) => a.startsWith("--slug=")) || "").split("=")[1];
  const only = (args.find((a) => a.startsWith("--category=")) || "").split("=")[1];
  if (fs.existsSync(STOP)) { console.log("POSTING_OFF present — paused. Remove", STOP, "to resume."); return; }

  // guard: one daily set per slot-date. Blocks a double-post when a run fires twice for the same day.
  const guarded = onceDaily && !draft && !dry && !immediate && !forceSlug;
  if (guarded) {
    const target = targetSlotDate();
    let state = {};
    try { state = JSON.parse(fs.readFileSync(STATEF, "utf8")); } catch {}
    if (state.date === target) { console.log(`daily set for ${target} already scheduled (${state.count || "?"} videos) — skipping to avoid a double-post.`); return; }
  }

  // seed with already-live-posted slugs (cross-run dedup) so daily runs pick fresh stories; forced --slug bypasses this
  const posted = forceSlug ? new Set() : livePostedSlugs();

  // CANDIDATE POOL: forced slug, or the LATEST articles from BOTH automations (newest first)
  let pool;
  if (forceSlug) pool = [{ slug: forceSlug, category: only || categoryOfSlug(forceSlug) || "celebrity", date: Date.now() }];
  else { pool = latestArticles(posted); if (only) pool = pool.filter((c) => c.category === only); }

  // SELECT up to 3 newest, at most MAX_PER_CATEGORY of any category, each must actually render (fallback to next)
  const want = only || forceSlug ? 1 : 3;
  const selected = [];
  const catCount = {};
  for (const cand of pool) {
    if (selected.length >= want) break;
    if (posted.has(cand.slug)) continue;
    if (!forceSlug && (catCount[cand.category] || 0) >= MAX_PER_CATEGORY) continue;
    posted.add(cand.slug);
    if (dry) { selected.push(cand); catCount[cand.category] = (catCount[cand.category] || 0) + 1; continue; }
    try {
      await ensureVideo(cand.slug); // may throw: sensitive/thin/gen-failure → fall through to the next-newest story
      selected.push(cand); catCount[cand.category] = (catCount[cand.category] || 0) + 1;
    } catch (e) {
      console.log(`  skip ${cand.slug} [${cand.category}]: ${String(e.message).slice(0, 100)} — trying next-newest`);
    }
  }
  if (dry) {
    console.log(`\nWould post ${selected.length} (newest-first, max ${MAX_PER_CATEGORY}/category, from news+gossip):`);
    selected.forEach((c, i) => console.log(`  ${String(SLOT_HOURS[i] ?? 18).padStart(2)}:00 PT  [${c.category}]  ${new Date(c.date).toISOString().slice(0, 10)}  ${c.slug}`));
    return;
  }
  if (!selected.length) console.log("⚠ no fresh, postable story found in the window");

  // POST each selected video into a slot by recency order (newest → 10am, next → 2pm, next → 6pm)
  const summary = [];
  for (let i = 0; i < selected.length; i++) {
    const cand = selected[i];
    const base = immediate ? new Date(Date.now() + 120000) : slotBaseFor(SLOT_HOURS[i] ?? SLOT_HOURS[SLOT_HOURS.length - 1]);
    try {
      const entry = await postOne({ category: cand.category, slug: cand.slug, base, draft, dry, immediate });
      summary.push(entry);
      if (immediate && !draft && entry.results) {
        console.log("  polling publish status (up to ~3 min)…");
        const status = await pollPublish(entry);
        for (const plat of ["facebook", "instagram", "youtube", "pinterest"]) {
          const s = status[plat];
          console.log(`    ${plat.padEnd(10)} ${s ? (s.ok ? "✅ PUBLISHED" : "❌ FAILED: " + (s.error || s.status)) + (s.url ? " " + s.url : "") : "⏳ still queued (check dashboard)"}`);
        }
      }
    } catch (e) {
      console.log(`  post error ${cand.slug}: ${String(e.message).slice(0, 120)}`);
    }
  }
  // record the daily set so a second same-day run (cron double-fire / manual + cron) won't double-post
  if (guarded && summary.length) {
    try { fs.writeFileSync(STATEF, JSON.stringify({ date: targetSlotDate(), count: summary.length, at: new Date().toISOString() }, null, 2)); } catch {}
  }
  if (!draft && !dry) { try { const n = await pruneHost(14); if (n) console.log(`pruned ${n} old hosted videos`); } catch {} }
  console.log(`\nDone. ${summary.length} video(s) processed.`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
