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
const STOP = path.join(ROOT, "data/video/POSTING_OFF"); // touch this file to pause all posting

// ── categories → daily slot (PT wall-clock hour) + per-platform forward stagger (minutes)
const SLOTS = { movies: 10, tv: 14, celebrity: 18 };
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

// base publish instant for a category slot today (bump to tomorrow if already past)
function slotBase(category) {
  const { y, m, d } = laTodayParts();
  let base = laWallToUTC(y, m, d, SLOTS[category], 0);
  if (base.getTime() < Date.now() + 120000) base = new Date(base.getTime() + 864e5);
  return base;
}

const catOf = (slug) => { try { return matter(fs.readFileSync(path.join(ROOT, "content/articles", slug + ".md"), "utf8")).data.category; } catch { return null; } };

// slugs that already had a LIVE (non-draft) successful post — cross-run dedup so we never re-post the same video
function livePostedSlugs() {
  try {
    const log = JSON.parse(fs.readFileSync(LOG, "utf8"));
    return new Set(log.filter((e) => !e.draft && e.results && Object.values(e.results).some((r) => r?.ok)).map((e) => e.slug));
  } catch { return new Set(); }
}

// pick the best recent published article for a category (highest priority, within the window, not already posted)
function pickForCategory(category, postedSlugs) {
  const pub = JSON.parse(fs.readFileSync(path.join(ROOT, "data/find/published.json"), "utf8"));
  const now = Date.now();
  return pub
    .filter((r) => r.slug && r.at && now - Date.parse(r.at) < 14 * 864e5)
    .filter((r) => (r.category || catOf(r.slug)) === category)
    .filter((r) => !postedSlugs.has(r.slug))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0] || null;
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
  results.facebook = await postZernio({ platform: "facebook", videoUrl: host.url, caption: caps.facebook, whenISO: plan.facebook.when, draft });
  results.instagram = await postZernio({ platform: "instagram", videoUrl: host.url, caption: caps.instagram, whenISO: plan.instagram.when, draft });
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
  const forceSlug = (args.find((a) => a.startsWith("--slug=")) || "").split("=")[1];
  const only = (args.find((a) => a.startsWith("--category=")) || "").split("=")[1];
  if (fs.existsSync(STOP)) { console.log("POSTING_OFF present — paused. Remove", STOP, "to resume."); return; }

  const cats = only ? [only] : ["movies", "tv", "celebrity"];
  // seed with already-live-posted slugs (cross-run dedup) so daily runs pick fresh stories; forced --slug bypasses this
  const posted = forceSlug ? new Set() : livePostedSlugs();
  const summary = [];
  for (const category of cats) {
    if (!(category in SLOTS)) { console.log(`skip unknown category ${category}`); continue; }
    const pick = forceSlug ? { slug: forceSlug } : pickForCategory(category, posted);
    if (!pick) { console.log(`[${category}] no candidate article`); continue; }
    posted.add(pick.slug);
    try {
      if (!dry) await ensureVideo(pick.slug);
      const base = immediate ? new Date(Date.now() + 120000) : slotBase(category); // --now = ~2 min out (Zernio scheduler lead)
      const entry = await postOne({ category, slug: pick.slug, base, draft, dry, immediate });
      summary.push(entry);
      // for a live immediate post, poll until each platform actually publishes
      if (immediate && !draft && !dry && entry.results) {
        console.log("  polling publish status (up to ~3 min)…");
        const status = await pollPublish(entry);
        for (const plat of ["facebook", "instagram", "youtube", "pinterest"]) {
          const s = status[plat];
          console.log(`    ${plat.padEnd(10)} ${s ? (s.ok ? "✅ PUBLISHED" : "❌ FAILED: " + (s.error || s.status)) + (s.url ? " " + s.url : "") : "⏳ still queued (check dashboard)"}`);
        }
      }
    } catch (e) {
      console.log(`[${category}] ERROR ${pick.slug}: ${String(e.message).slice(0, 160)}`);
    }
  }
  if (!draft && !dry) { try { const n = await pruneHost(14); if (n) console.log(`pruned ${n} old hosted videos`); } catch {} }
  console.log(`\nDone. ${summary.length} video(s) processed.`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
