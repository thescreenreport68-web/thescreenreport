// AGENTS 10+11+12 — VISUAL STORY ENGINE (REV 3, plan §11.5).
// The guarantee: whatever the audio is talking about is ON SCREEN — every mention,
// every niche. Beats (Scene Director) drive planning; multi-name beats become split
// frames / grids (owner-approved N-adaptive composer); event beats use event imagery.
// Sourcing = multi-lane with retries and a per-entity REPORT — an imageless prominent
// subject is a loud warning, never a silent gap.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { IG } from "../config.mjs";
import { vision } from "../models.mjs";
import { normWords, fetchWithTimeout, retry, sleep } from "../lib/util.mjs";
import { workDirFor } from "../job.mjs";
import { saveAssetProvenance } from "../lib/ledger.mjs";

const PY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "py");
const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/original";

async function tmdb(pathname, params = {}) {
  const url = new URL(TMDB + pathname);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchWithTimeout(url, {}, 10000);
  if (!res.ok) throw new Error(`tmdb ${pathname} ${res.status}`);
  return res.json();
}

// ── LANES ────────────────────────────────────────────────────────────────────────
async function laneTmdb(entity) {
  const out = [];
  try {
    if (entity.kind === "person") {
      const s = await tmdb("/search/person", { query: entity.name });
      const hit = s.results?.[0];
      if (hit?.profile_path) out.push({ url: IMG + hit.profile_path, prov: "tmdb-profile" });
      if (hit?.id) {
        const imgs = await tmdb(`/person/${hit.id}/images`);
        for (const p of (imgs.profiles || []).slice(0, 3)) out.push({ url: IMG + p.file_path, prov: "tmdb-profile" });
      }
    } else if (entity.kind === "movie" || entity.kind === "tv") {
      const kind = entity.kind === "movie" ? "movie" : "tv";
      const s = await tmdb(`/search/${kind}`, { query: entity.name });
      const hit = s.results?.[0];
      if (hit?.id) {
        const imgs = await tmdb(`/${kind}/${hit.id}/images`, { include_image_language: "en,null" });
        for (const b of (imgs.backdrops || []).slice(0, 3)) out.push({ url: IMG + b.file_path, prov: "tmdb-backdrop" });
        for (const p of (imgs.posters || []).slice(0, 2)) out.push({ url: IMG + p.file_path, prov: "tmdb-poster" });
      }
    }
  } catch {}
  return out;
}

async function laneWikipedia(entity) {
  try {
    const res = await fetchWithTimeout(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entity.name.replace(/ /g, "_"))}`,
      { headers: { "User-Agent": "TSR-IG/1.0" } }, 8000);
    if (res.ok) {
      const j = await res.json();
      const u = j.originalimage?.source || j.thumbnail?.source;
      if (u) return [{ url: u, prov: "wikipedia" }];
    }
  } catch {}
  return [];
}

// images referenced by OUR article (hero + inline markdown/HTML images) — http-only
export function laneArticle(article, articleBodyRaw = "") {
  const out = [];
  const push = (u, prov) => { if (u && /^https?:\/\//.test(u)) out.push({ url: u, prov }); };
  push(article?.heroImage, "article-hero");
  for (const m of articleBodyRaw.matchAll(/!\[[^\]]*\]\((https?:[^)\s]+)\)/g)) push(m[1], "article-inline");
  for (const m of articleBodyRaw.matchAll(/<img[^>]+src=["'](https?:[^"']+)["']/gi)) push(m[1], "article-inline");
  const seen = new Set();
  return out.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true))).slice(0, 6);
}

// images on the SOURCE pages (og/twitter/ld+json/inline) — events live here
export function extractPageImages(html, baseUrl) {
  const out = [];
  const push = (u, prov) => {
    if (!u) return;
    try { out.push({ url: new URL(u, baseUrl).href, prov }); } catch {}
  };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]+content=["']([^"']+)["']/gi)) push(m[1], "source-og");
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/gi)) push(m[1], "source-og");
  for (const m of html.matchAll(/"image"\s*:\s*"(https?:[^"]+)"/g)) push(m[1], "source-ldjson");
  for (const m of html.matchAll(/<img[^>]+src=["'](https?:[^"']+\.(?:jpe?g|png|webp)[^"']*)["']/gi)) push(m[1], "source-inline");
  // dedupe, drop obvious icons/trackers
  const seen = new Set();
  return out
    .filter((c) => !/logo|icon|avatar|sprite|badge|1x1|pixel/i.test(c.url))
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .slice(0, 8);
}

async function laneSources(sourceUrls = []) {
  const out = [];
  for (const url of sourceUrls.slice(0, 3)) {
    try {
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0 (TSR fetch)" } }, 9000);
      if (res.ok) out.push(...extractPageImages(await res.text(), url));
    } catch {}
  }
  return out;
}

// GDELT news-image index (keyless) — recent coverage photos for entities/events.
// PROBED 2026-07-10: quoted phrases underperform (use plain terms + sort=hybridrel),
// responses can be text rate-limit notices (JSON.parse guard), and the API enforces
// ONE request per 5 seconds — a global throttle serializes all lane calls.
let gdeltLast = 0;
async function laneGdelt(query) {
  try {
    const wait = gdeltLast + 5200 - Date.now();
    if (wait > 0) await sleep(wait);
    gdeltLast = Date.now();
    const u = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    u.searchParams.set("query", String(query).replace(/"/g, ""));
    u.searchParams.set("mode", "artlist");
    u.searchParams.set("format", "json");
    u.searchParams.set("maxrecords", "20");
    u.searchParams.set("timespan", "7d");
    u.searchParams.set("sort", "hybridrel");
    const res = await fetchWithTimeout(u, { headers: { "User-Agent": "TSR-IG/1.0" } }, 10000);
    if (!res.ok) return [];
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch { return []; } // rate-limit notices are plain text
    const seen = new Set();
    return (j.articles || [])
      .map((a) => a.socialimage)
      .filter((x) => x && !seen.has(x) && seen.add(x))
      .slice(0, 6)
      .map((url) => ({ url, prov: "gdelt" }));
  } catch {
    return [];
  }
}

// EVENT IMAGE HUNTER (owner 2026-07-10: never stop at one outlet's watermarked photo —
// search the whole internet's coverage). Bing News RSS is keyless and returns publisher
// URLs; we harvest each outlet's page images and let the vision gate pick the CLEAN one.
export async function laneNewsSearch(query, { maxArticles = 8 } = {}) {
  try {
    const u = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
    const res = await fetchWithTimeout(u, { headers: { "User-Agent": "Mozilla/5.0 (TSR fetch)" } }, 10000);
    if (!res.ok) return [];
    const xml = await res.text();
    const links = [...xml.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/g)]
      .map((m) => m[1].trim())
      .map((l) => {
        // bing sometimes wraps links: apiclick.aspx?...&url=<real>
        const m = l.match(/[?&]url=([^&]+)/);
        return m ? decodeURIComponent(m[1]) : l;
      })
      .filter((l) => /^https?:\/\//.test(l) && !/bing\.com|msn\.com/.test(l));
    // one article per OUTLET — breadth beats depth for finding a clean photo
    const perHost = new Map();
    for (const l of links) {
      try {
        const host = new URL(l).hostname.replace(/^www\./, "");
        if (!perHost.has(host)) perHost.set(host, l);
      } catch {}
    }
    const pages = [...perHost.values()].slice(0, maxArticles);
    const out = [];
    for (const page of pages) {
      try {
        const r = await fetchWithTimeout(page, { headers: { "User-Agent": "Mozilla/5.0 (TSR fetch)" } }, 9000);
        if (r.ok) out.push(...extractPageImages(await r.text(), page).slice(0, 2).map((c) => ({ ...c, prov: `news:${new URL(page).hostname.replace(/^www\./, "")}` })));
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

// ── vision gate (identity for people/titles; event-match for events) ────────────
export async function gateImages(entity, candidates, storyContext = "") {
  if (!candidates.length) return [];
  const batch = candidates.slice(0, 6);
  const isEvent = entity.kind === "event";
  try {
    const res = await vision({
      system:
        'You inspect candidate images for a news video. Return STRICT JSON {"images":[{"i":number,"watermark":boolean,"textHeavy":boolean,"sharp":boolean,"match":boolean}]} — one entry per image, in order. watermark=ANY visible logo/watermark/UI from an outlet, agency (Getty/AP/Backgrid), or app (TikTok/YouTube). textHeavy=image is mostly text. ' +
        (isEvent
          ? 'match=the image plausibly shows THIS SPECIFIC event or its venue/moment (crowd shots, ceremony, red carpet of THIS event — not a generic or different event).'
          : "match=the image plausibly shows the named subject (true for posters/stills of the named title)."),
      user: `Subject: ${entity.name} (${entity.kind}).${storyContext ? ` Story: ${storyContext}.` : ""} Judge each image in order.`,
      images: batch.map((c) => c.url),
      maxTokens: 450,
    });
    const verdicts = res.images || (Array.isArray(res) ? res : []);
    return batch.filter((_, i) => {
      const v = verdicts[i] || {};
      return !v.watermark && !v.textHeavy && v.match !== false;
    });
  } catch {
    return batch.slice(0, 2); // vision outage: keep top-of-ladder
  }
}

// ── download + framing (validated, retried) ──────────────────────────────────────
const IMG_MAGIC = [
  [0xff, 0xd8, 0xff],
  [0x89, 0x50, 0x4e, 0x47],
  [0x52, 0x49, 0x46, 0x46],
];
async function download(url, dest) {
  return retry(async () => {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0 (TSR fetch)" } }, 15000);
    if (!res.ok) throw new Error(`img ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "";
    const magicOk = IMG_MAGIC.some((m) => m.every((b, i) => buf[i] === b));
    if (!ct.startsWith("image/") && !magicOk) throw new Error(`not an image (${ct || "no content-type"})`);
    if (buf.length < 8000) throw new Error("image too small to be real");
    fs.writeFileSync(dest, buf);
    return dest;
  }, { tries: 2, delayMs: 800, label: `download ${url.slice(0, 60)}` });
}

export function frameBatch(jobs) {
  if (!jobs.length) return [];
  const listFile = jobs[0].dst.replace(/[^/]*$/, "_frame_jobs.json");
  fs.writeFileSync(listFile, JSON.stringify(jobs));
  const out = execFileSync(IG.python, [path.join(PY_DIR, "face_crop.py"), listFile], {
    timeout: 240000,
    maxBuffer: 8 * 1024 * 1024,
  }).toString();
  return JSON.parse(out);
}

// ── composites (the owner-approved N-adaptive composer) ─────────────────────────
export function composeFrame({ dir, mode, cells, hero }) {
  const key = crypto.createHash("md5").update(JSON.stringify({ mode, cells, hero })).digest("hex").slice(0, 10);
  const out = path.join(dir, `composite-${key}.jpg`);
  if (fs.existsSync(out)) return out;
  const args = [
    path.join(PY_DIR, "compose.py"),
    "--out", out,
    "--mode", mode,
    "--cells", cells.map((c) => `${c.file}|${(c.label || "").toUpperCase()}`).join(","),
    "--font", path.join(IG.fontsDir, "Anton-Regular.ttf"),
    "--w", String(IG.upscale[0]),
    "--h", String(IG.upscale[1]),
  ];
  if (hero) args.push("--hero", `${hero.file}|${(hero.label || "").toUpperCase()}`);
  execFileSync(IG.python, args, { timeout: 120000 });
  return out;
}

// ── BEAT-DRIVEN PLANNER (the placement guarantee, by construction) ───────────────
// beats: from the Scene Director. images: {entityName: [files]}. Returns shots with
// subjects[] so the sync gate credits composites for every face in them.
export function planFromBeats({ beats, images, rawImages = {}, duration, dir, primary }) {
  const PACE = 2.6, MIN_SHOT = 1.1;
  const used = {};
  const pick = (name) => {
    const list = images[name] || [];
    if (!list.length) return null;
    const idx = (used[name] = (used[name] ?? -1) + 1);
    return list[idx % list.length];
  };
  // composite cells crop per-cell, so raw originals beat pre-framed 9:16 crops there
  const pickCell = (name) => rawImages[name]?.[0] || pick(name);
  const hasAny = (name) => Boolean(images[name]?.length || rawImages[name]?.length);
  const motions = ["in", "out", "panl", "panr"];
  const shots = [];
  const pushShot = (t0, t1, img, label, subjects, anchored) => {
    if (t1 - t0 < 0.35 || !img) return;
    shots.push({
      t0: +t0.toFixed(2), t1: +t1.toFixed(2), entity: label, img,
      motion: motions[shots.length % motions.length],
      subjects, anchored: anchored || undefined,
    });
  };
  const surname = (n) => n.split(" ").slice(-1)[0];

  for (let b = 0; b < beats.length; b++) {
    const beat = beats[b];
    const t0 = b === 0 ? 0 : Math.max(beats[b].t0, shots.length ? shots[shots.length - 1].t1 : 0);
    const t1 = b + 1 < beats.length ? beats[b + 1].t0 : duration;
    if (t1 - t0 < 0.35) continue;
    const withImg = beat.subjects.filter(hasAny);

    let visual = null; // { img, label, subjects }
    if (beat.kind === "event" && withImg.length) {
      const eventName = beat.subjects[0];
      const faces = withImg.filter((s) => s !== eventName).slice(0, 3);
      if (hasAny(eventName) && faces.length) {
        const img = composeFrame({
          dir, mode: "hero",
          hero: { file: pickCell(eventName), label: "" },
          cells: faces.map((f) => ({ file: pickCell(f), label: surname(f) })),
        });
        visual = { img, label: eventName, subjects: [eventName, ...faces] };
      } else if (images[eventName]?.length) {
        visual = { img: pick(eventName), label: eventName, subjects: [eventName] };
      }
    }
    // duo/group beats — AND event beats whose event has no imagery degrade to the
    // people grid (the faces of the moment still fill the frame)
    if (!visual && ["duo", "group", "event"].includes(beat.kind)) {
      const pool = beat.kind === "event" ? withImg.filter((s) => s !== beat.subjects[0]) : withImg;
      const chosen = pool.slice(0, 4);
      if (chosen.length >= 2) {
        const img = composeFrame({ dir, mode: "grid", cells: chosen.map((s) => ({ file: pickCell(s), label: surname(s) })) });
        visual = { img, label: chosen.join(" + "), subjects: chosen };
      }
    }
    if (!visual) {
      const solo = withImg.find((s) => images[s]?.length) || (images[primary]?.length ? primary : Object.keys(images).find((k) => images[k].length));
      if (!solo) continue;
      visual = { img: pick(solo), label: solo, subjects: [solo] };
    }

    // pace the beat window: composites hold up to maxStatic, singles rotate at PACE
    let cursor = t0;
    let first = true;
    while (t1 - cursor > 0.35) {
      const isComposite = visual.subjects.length > 1;
      const span = Math.min(t1 - cursor, isComposite ? IG.maxStaticSec : PACE);
      const remainder = t1 - (cursor + span);
      const finalSpan = remainder > 0 && remainder < MIN_SHOT ? t1 - cursor : span;
      pushShot(cursor, cursor + finalSpan, first ? visual.img : pick(visual.subjects.length > 1 ? visual.subjects[0] : visual.label) || visual.img, visual.label, visual.subjects, first);
      cursor += finalSpan;
      if (isComposite && t1 - cursor > 0.35) {
        // after the composite's hold, continue the beat on the lead subject's singles
        const lead = visual.subjects.find((s) => images[s]?.length && s !== visual.subjects[0]) || visual.subjects[0];
        visual = { img: pick(lead) || visual.img, label: lead, subjects: [lead] };
      }
      first = false;
    }
  }
  // guarantee full coverage 0 → duration
  if (shots.length) {
    shots[0].t0 = 0;
    shots[shots.length - 1].t1 = Math.max(shots[shots.length - 1].t1, duration);
  }
  return shots;
}

// legacy pacer kept for tests / fallback when no beats exist
export function planTimeline({ words, duration, entities, images, primary }) {
  const mentions = [];
  for (const e of entities) {
    const tokens = normWords(e.name).filter((t) => t.length > 2);
    if (!tokens.length || !images[e.name]?.length) continue;
    for (let i = 0; i < words.length; i++) {
      if (tokens.includes(normWords(words[i].w)[0])) {
        mentions.push({ entity: e.name, t: Math.max(0, words[i].t0 - 0.25) });
        i += tokens.length - 1;
      }
    }
  }
  mentions.sort((a, b) => a.t - b.t);
  const PACE = 2.6, MIN_SHOT = 1.2;
  const cuts = [0];
  for (const m of mentions) if (m.t - cuts[cuts.length - 1] > 0.8) cuts.push(m.t);
  let i = 0;
  while (i < cuts.length) {
    const next = cuts[i + 1] ?? duration;
    const span = next - cuts[i];
    if (span > PACE && span / 2 >= MIN_SHOT) { cuts.splice(i + 1, 0, cuts[i] + span / 2); continue; }
    i++;
  }
  const shots = [];
  const used = {};
  const pick = (name) => {
    const list = images[name] || [];
    if (!list.length) return null;
    const idx = (used[name] = (used[name] ?? -1) + 1);
    return list[idx % list.length];
  };
  const motions = ["in", "out", "panl", "panr"];
  for (let c = 0; c < cuts.length; c++) {
    const t0 = cuts[c];
    const t1 = c + 1 < cuts.length ? cuts[c + 1] : duration;
    if (t1 - t0 < 0.4) continue;
    const m = mentions.find((x) => Math.abs(x.t - t0) <= 0.35);
    const recentMention = [...mentions].reverse().find((x) => x.t <= t0 + 0.3);
    const entity = m?.entity || recentMention?.entity || primary;
    const img = pick(entity) || pick(primary);
    if (!img) continue;
    shots.push({ t0: +t0.toFixed(2), t1: +t1.toFixed(2), entity, img, motion: motions[shots.length % motions.length], subjects: [entity], anchored: Boolean(m) || undefined });
  }
  return shots;
}

// ── the full stage ────────────────────────────────────────────────────────────────
export async function buildShots({ job, words, duration, beats, articleBodyRaw = "" }) {
  const dir = workDirFor(job.id);
  const entities = job.facts.entities;
  const story = job.facts.storyOneLine || job.article.title;
  const images = {};
  const rawImages = {}; // ungated originals — composite cells only
  const provenance = [];
  const sourcing = {}; // the per-entity REPORT — no more silent failures

  // shared page/gdelt pools fetched ONCE
  const articlePool = laneArticle(job.article, articleBodyRaw);
  const sourcePool = await laneSources(job.article.sourceUrls);

  for (const e of entities) {
    const report = { lanes: {}, gated: 0, downloaded: 0, framed: 0, final: 0, reasons: [] };
    sourcing[e.name] = report;
    let candidates = [];
    if (e.kind === "event") {
      // the multi-platform hunt: our article + its sources + Bing News (one photo per
      // outlet, watermark-free wins) + GDELT's news-image index
      const q = e.searchTerms || `${e.name} ${job.article.title}`.slice(0, 60);
      const news = await laneNewsSearch(q);
      const gd = await laneGdelt(q);
      candidates = [...sourcePool, ...articlePool, ...news, ...gd];
      report.lanes = { source: sourcePool.length, article: articlePool.length, news: news.length, gdelt: gd.length };
    } else {
      const [t, w] = [await laneTmdb(e), await laneWikipedia(e)];
      const gd = t.length + w.length >= 3 ? [] : await laneGdelt(e.searchTerms || e.name);
      candidates = [...t, ...w, ...articlePool, ...sourcePool, ...gd];
      report.lanes = { tmdb: t.length, wiki: w.length, article: articlePool.length, source: sourcePool.length, gdelt: gd.length };
    }
    // dedupe by URL — TMDB returns the main profile AND the same file again in the
    // image list, which burned both trusted-fallback slots on one photo
    const seenUrl = new Set();
    candidates = candidates.filter((c) => (seenUrl.has(c.url) ? false : (seenUrl.add(c.url), true)));
    if (!candidates.length) { report.reasons.push("no candidates in any lane"); continue; }

    let passed = await gateImages(e, candidates, story);
    // events with a big candidate pool: gate a second batch if the first all failed
    // (the whole point of the multi-platform hunt is picking the clean one from MANY)
    if (!passed.length && e.kind === "event" && candidates.length > 6) {
      passed = await gateImages(e, candidates.slice(6, 12), story);
    }
    // the vision gate is flaky run-to-run — a 0-pass on curated sources is far more
    // likely a judge miss than 4 bad images. TMDB/Wikipedia are watermark-free by
    // construction; trust their top candidates rather than blank a prominent subject.
    if (!passed.length && e.kind !== "event") {
      const trusted = candidates.filter((c) => /^(tmdb|wikipedia)/.test(c.prov)).slice(0, 2);
      if (trusted.length) { passed = trusted; report.reasons.push("vision gate 0-pass → trusted-provenance fallback"); }
    }
    report.gated = passed.length;
    if (!passed.length) { report.reasons.push("all candidates failed the vision gate"); continue; }

    const locals = [];
    for (let i = 0; i < Math.min(passed.length, 4); i++) {
      const raw = path.join(dir, `raw-${normWords(e.name).join("_")}-${i}.img`);
      try {
        await download(passed[i].url, raw);
        locals.push({ raw, prov: passed[i].prov, url: passed[i].url });
      } catch (err) {
        report.reasons.push(`download: ${String(err.message).slice(0, 60)}`);
      }
    }
    report.downloaded = locals.length;
    if (!locals.length) continue;

    const dsts = locals.map((_, i) => path.join(dir, `shot-${normWords(e.name).join("_")}-${i}.jpg`));
    const frames = frameBatch(locals.map((l, i) => ({ src: l.raw, dst: dsts[i], w: IG.upscale[0], h: IG.upscale[1] })));
    images[e.name] = frames.map((f, i) => (f?.ok ? dsts[i] : null)).filter(Boolean);
    // RAW survivors feed COMPOSITES (cells crop per-cell, so landscape event photos —
    // useless full-frame — still make great hero panels / grid cells).
    // FACE-VERIFIED raws come first: composite cells must show the person's FACE, and
    // the framing pass already told us which sources have a detectable one.
    const withFace = locals.filter((_, i) => frames[i]?.face).map((l) => l.raw);
    const withoutFace = locals.filter((_, i) => !frames[i]?.face).map((l) => l.raw);
    rawImages[e.name] = [...withFace, ...withoutFace];
    frames.forEach((f, i) => { if (!f?.ok) report.reasons.push(`framing: ${f?.reason || "?"}`); });

    // SECOND CHANCE: a person/title whose primary lanes only produced unframeable images
    // gets one GDELT pass (recent news photos are usually large enough)
    if (!images[e.name].length && e.kind !== "event" && !report.lanes.gdelt) {
      const gd2 = await laneGdelt(e.searchTerms || e.name);
      report.lanes.gdelt = gd2.length;
      const passed2 = await gateImages(e, gd2, story);
      for (let i = 0; i < Math.min(passed2.length, 2); i++) {
        const raw2 = path.join(dir, `raw2-${normWords(e.name).join("_")}-${i}.img`);
        try {
          await download(passed2[i].url, raw2);
          const dst2 = path.join(dir, `shot2-${normWords(e.name).join("_")}-${i}.jpg`);
          const fr2 = frameBatch([{ src: raw2, dst: dst2, w: IG.upscale[0], h: IG.upscale[1] }]);
          if (fr2[0]?.ok) {
            images[e.name].push(dst2);
            provenance.push({ entity: e.name, url: passed2[i].url, prov: "gdelt-2nd" });
          }
          rawImages[e.name].push(raw2);
        } catch {}
      }
      if (images[e.name].length) report.reasons.push("recovered via gdelt second chance");
    }
    report.framed = images[e.name].length;
    report.final = images[e.name].length;
    locals.forEach((l, i) => provenance.push({ entity: e.name, url: l.url, prov: l.prov }));
  }

  const withImages = Object.keys(images).filter((k) => images[k].length);
  if (!withImages.length) return { shots: null, hold: "no usable imagery for any entity", sourcing };

  // prominence warnings: an entity spoken ≥2× (or in the hook) with zero images is LOUD
  const warnings = [];
  const sentenceText = beats?.map((b) => b.text).join(" ") || "";
  for (const e of entities) {
    if (images[e.name]?.length || rawImages[e.name]?.length) continue;
    const tokens = normWords(e.name).filter((t) => t.length > 2);
    const mentions = normWords(sentenceText).filter((w) => tokens.includes(w)).length;
    const inHook = beats?.[0] && tokens.some((t) => normWords(beats[0].text).includes(t));
    if (mentions >= 2 || inHook)
      warnings.push(`PROMINENT SUBJECT IMAGELESS: "${e.name}" (${mentions} mentions${inHook ? ", in hook" : ""}) — ${sourcing[e.name]?.reasons.join("; ") || "no lanes produced images"}`);
  }

  const mentionCount = (name) => {
    const tokens = normWords(name).filter((t) => t.length > 2);
    return words.filter((w) => tokens.includes(normWords(w.w)[0] ?? "")).length;
  };
  const primary = withImages.sort((a, b) => mentionCount(b) - mentionCount(a))[0];

  const shots = beats?.length
    ? planFromBeats({ beats, images, rawImages, duration, dir, primary })
    : planTimeline({ words, duration, entities, images, primary });
  if (shots.length < 3) return { shots: null, hold: `only ${shots.length} shots plannable — too visually thin`, sourcing };
  saveAssetProvenance(job.id, provenance);
  return { shots, primary, imageCount: Object.values(images).flat().length, sourcing, warnings };
}
