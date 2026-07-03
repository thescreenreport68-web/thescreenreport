// THE VISUAL BRAIN — Layers 2+4 (owner-approved plan 2026-07-03): entity RESOLUTION + shot PLANNING.
// Layer 2: every entity a line mentions resolves to the RIGHT verified imagery (person→identity-gated
//   portraits; title→that title's art variants; character→the production's art, actor portrait fallback).
// Layer 4: the PACING LAW — no frame lives longer than MAX_SHOT; long lines cut through DIFFERENT
//   verified images of the same subject; multi-entity lines open on an N-adaptive composite
//   (compose_grid.py: grid for "group", hero+strip for "primary"). No image repeats back-to-back.
// Fallback ladder per shot: requested → story title art → article hero (all gated) → extend previous.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getPersonImages, getTitleImages } from "../lib/tmdb.mjs";
import { chat } from "../lib/openrouter.mjs";
import { VIDEO } from "./config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const MAX_SHOT = 3.75, MAX_SHOTS = 12; // owner 2026-07-03: each image holds 3.5-4s

const probe = (f) =>
  new Promise((res) =>
    execFile("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", f], (e, out) => {
      if (e) return res(null);
      try { const s = JSON.parse(out).streams?.find((x) => x.width); res(s ? { w: s.width, h: s.height } : null); } catch { res(null); }
    })
  );
const runPy = (args) =>
  new Promise((res, rej) => execFile(VIDEO.python, args, { timeout: 120000 }, (e, so, se) => (e ? rej(new Error(String(se).slice(-400))) : res(so))));

async function download(url, dest, minW = VIDEO.minImageWidth) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 15000) return null;
    fs.writeFileSync(dest, buf);
    const dims = await probe(dest);
    if (!dims || dims.w < minW) { fs.unlinkSync(dest); return null; }
    return { file: dest, ...dims };
  } catch { return null; }
}

// ── vision gates (identity + strict relevance) — a wrong or unidentifiable face never ships
async function isPerson(url, name, storyTitle) {
  try {
    const { data } = await chat({
      model: VIDEO.visionModel,
      system: "You verify photo identity for an entertainment newsroom. Answer STRICT JSON only.",
      user: `Is this a photo of ${name} — the person referred to in this entertainment news story: "${storyTitle}"? If you are not confident it is that specific, publicly-known person, answer false. {"match": true|false}`,
      images: [url], json: true, maxTokens: 60, temperature: 0,
    });
    return data?.match === true;
  } catch (e) { console.log("  (vision identity gate error → REJECT: " + String(e.message).slice(0, 60) + ")"); return false; } // Phase 2: fail CLOSED
}
async function isRelevant(url, storyTitle, people, titles) {
  try {
    const { data } = await chat({
      model: VIDEO.visionModel,
      system: "You verify that an image belongs with a news story for an entertainment newsroom. Answer STRICT JSON only.",
      user: `Story headline: "${storyTitle}". People named: ${people.join(", ") || "none"}. Productions/events named: ${titles.join(", ") || "none"}.
An image is acceptable ONLY if: (a) you can POSITIVELY identify the person shown as one of the named people; or (b) it is clearly a scene, poster, or venue from one of the named productions/events; or (c) it shows no prominent identifiable person. If it prominently shows a person you CANNOT positively identify as one of the named people, answer false. {"relevant": true|false}`,
      images: [url], json: true, maxTokens: 60, temperature: 0,
    });
    return data?.relevant === true;
  } catch (e) { console.log("  (vision relevance gate error → REJECT: " + String(e.message).slice(0, 60) + ")"); return false; } // Phase 2: fail CLOSED
}

// lines: [{say, visual}] · lineDurs: seconds per line · returns [{file, weight, visual, credit}]
export async function planShots({ dir, lines, lineDurs, storyTitle, fallbackTitle, tmdbType = "movie", heroUrl }) {
  fs.mkdirSync(dir, { recursive: true });
  const tCache = {}, pCache = {}, used = {}, files = {}; // files[url] = downloaded path (download once)
  let seq = 0, lastFile = null;

  const namedPeople = [...new Set(lines.flatMap((l) => (l.visual?.entities || []).filter((e) => e.kind !== "title").map((e) => e.name)))];
  const namedTitles = [...new Set([...lines.flatMap((l) => (l.visual?.entities || []).filter((e) => e.kind === "title").map((e) => e.name)), ...lines.flatMap((l) => (l.visual?.entities || []).map((e) => e.ofTitle)).filter(Boolean), ...(fallbackTitle ? [fallbackTitle] : [])])];

  const title = async (name) => {
    if (/screen\s*report/i.test(name) && fallbackTitle) name = fallbackTitle;
    const k = name.toLowerCase();
    if (!(k in tCache)) tCache[k] = await getTitleImages(name, tmdbType).catch(() => null);
    return tCache[k];
  };
  const person = async (name) => {
    const k = name.toLowerCase();
    if (k in pCache) return pCache[k];
    const p = await getPersonImages(name).catch(() => null);
    let ok = null;
    if (p?.profiles?.length) {
      for (const u of p.profiles.slice(0, 3)) if (await isPerson(u, p.name || name, storyTitle)) { ok = { name: p.name || name, urls: [u, ...p.profiles.filter((x) => x !== u)] }; break; }
    }
    return (pCache[k] = ok);
  };
  // ── CHARACTER VISION INDEX (owner-approved 2026-07-03) ──────────────────────────────────
  const TMDB_KEY = process.env.TMDB_API_KEY;
  const detailCache = {}, creditsCache = {}, labelCache = {};
  const tmdbGet = async (p) => { try { const r = await fetch(`https://api.themoviedb.org/3${p}${p.includes("?") ? "&" : "?"}api_key=${TMDB_KEY}`, { signal: AbortSignal.timeout(12000) }); return r.ok ? await r.json() : null; } catch { return null; } };
  const isAnimated = async (t) => {
    const k = `${t.type}:${t.id}`;
    if (!(k in detailCache)) detailCache[k] = await tmdbGet(`/${t.type}/${t.id}`);
    return (detailCache[k]?.genres || []).some((g) => g.id === 16);
  };
  // Lane A: credits bridge — character name -> the actor who plays them (live-action only)
  const actorFor = async (t, charName) => {
    const k = `${t.type}:${t.id}`;
    if (!(k in creditsCache)) creditsCache[k] = await tmdbGet(`/${t.type}/${t.id}/credits`);
    const cast = creditsCache[k]?.cast || [];
    const hit = cast.find((c) => (c.character || "").toLowerCase().includes(charName.toLowerCase()));
    return hit?.name || null;
  };
  // Lane B: vision-label the title's still pool ONCE (one multi-image call) -> character→stills index
  const charStills = async (t, charName) => {
    const k = `${t.type}:${t.id}`;
    if (!(k in labelCache)) {
      // enlarge the pool beyond getTitleImages' 4: pull up to 12 stills straight from TMDB
      let pool = (t.backdrops || []).slice(0, 8);
      const imgs = await tmdbGet(`/${t.type}/${t.id}/images?include_image_language=en,null`);
      if (imgs?.backdrops?.length) pool = imgs.backdrops.slice(0, 12).map((x) => `https://image.tmdb.org/t/p/w1280${x.file_path}`);
      const wanted = [...new Set(lines.flatMap((l) => (l.visual?.entities || []).filter((e) => e.kind === "character").map((e) => e.name)))];
      labelCache[k] = {};
      if (pool.length && wanted.length) {
        // batches of 4: bigger batches make flash-lite label lazily (observed: 12 identical answers)
        for (let off = 0; off < pool.length; off += 4) {
          const batch = pool.slice(off, off + 4);
          try {
            const { data } = await chat({
              model: VIDEO.visionModel, json: true, maxTokens: 300, temperature: 0,
              system: "You identify characters in production stills for a newsroom. Judge EACH image independently — they are different scenes. STRICT JSON only.",
              user: `These ${batch.length} images are DIFFERENT stills from "${t.title}". For each image (1-based index), list which of these characters CLEARLY appear: ${wanted.join(", ")}. Be strict — omit an image entirely if none clearly appear. {"labels":{"1":["Name"],...}}`,
              images: batch,
            });
            // tolerant parse: {labels:{1:[..]}} | {1:[..]} | [{image_1:[..]},...]
            const raw = data?.labels || data || {};
            const entries = Array.isArray(raw) ? raw.flatMap((o) => Object.entries(o || {})) : Object.entries(raw);
            for (const [key, names] of entries) {
              if (!Array.isArray(names)) continue;
              const idx = parseInt(String(key).match(/\d+/)?.[0] || "0", 10);
              if (!idx || idx > batch.length) continue;
              for (const n of names) {
                const kk = String(n).toLowerCase();
                (labelCache[k][kk] = labelCache[k][kk] || []).push(batch[idx - 1]);
              }
            }
          } catch {}
        }
      }
    }
    return labelCache[k][charName.toLowerCase()] || [];
  };
  // Lane C: web image search (only when a SERPER_API_KEY exists), vision-verified downstream
  const serperImages = async (q) => {
    if (!process.env.SERPER_API_KEY) return [];
    try {
      const r = await fetch("https://google.serper.dev/images", { method: "POST", headers: { "X-API-KEY": process.env.SERPER_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ q, num: 6 }), signal: AbortSignal.timeout(12000) });
      const j = r.ok ? await r.json() : null;
      return (j?.images || []).map((x) => x.imageUrl).filter(Boolean).slice(0, 3);
    } catch { return []; }
  };

  // ordered image-URL candidates for one entity (Layer 2 ladder)
  const candidates = async (e) => {
    if (!e) return [];
    if (e.kind === "person") { const p = await person(e.name); return (p?.urls || []).map((u) => ({ u, credit: `TMDB · ${p?.name}`, gate: "person" })); }
    if (e.kind === "title") { const t = await title(e.name); return [...(t?.backdrops || []), ...(t?.poster ? [t.poster] : [])].map((u) => ({ u, credit: `TMDB · ${t?.title}`, gate: "relevance" })); }
    // CHARACTER: vision-indexed stills of THAT character -> credits-bridge actor (live-action) ->
    // web search -> (last resort, logged) the production's generic art
    const t = (e.ofTitle ? await title(e.ofTitle) : null) || (fallbackTitle ? await title(fallbackTitle) : null);
    const out = [];
    if (t) {
      const labeled = await charStills(t, e.name);
      out.push(...labeled.map((u) => ({ u, credit: `TMDB · ${e.name} in ${t.title}`, gate: null })));
      if (!(await isAnimated(t))) {
        const actor = await actorFor(t, e.name);
        if (actor) { const p = await person(actor); out.push(...(p?.urls || []).map((u) => ({ u, credit: `TMDB · ${actor} as ${e.name}`, gate: "person" }))); }
      }
    }
    if (!out.length) out.push(...(await serperImages(`${e.name} ${t?.title || e.ofTitle || ""} still`)).map((u) => ({ u, credit: `web · ${e.name}`, gate: "relevance" })));
    if (!out.length && t) out.push(...[...(t.backdrops || []), ...(t.poster ? [t.poster] : [])].map((u) => ({ u, credit: `TMDB · ${t.title} (generic — wanted ${e.name})`, gate: "relevance" })));
    return out;
  };
  // fetch the NEXT unused image for a rotation key (downloads + gates once per url)
  const nextImage = async (key, cands) => {
    if (!cands.length) return null;
    for (let tries = 0; tries < cands.length; tries++) {
      const i = (used[key] = (used[key] ?? -1) + 1);
      const c = cands[i % cands.length];
      if (files[c.u] === false) continue; // known-bad
      if (!files[c.u]) {
        const dest = path.join(dir, `shot-src-${++seq}.jpg`);
        const got = await download(c.u, dest);
        if (!got) { files[c.u] = false; continue; }
        if (c.gate === "relevance" && !(await isRelevant(c.u, storyTitle, namedPeople, namedTitles))) { files[c.u] = false; continue; }
        files[c.u] = dest;
      }
      if (files[c.u] === lastFile && cands.length > 1) continue; // no back-to-back repeats
      return { file: files[c.u], credit: c.credit };
    }
    return null;
  };
  // one N-adaptive composite (grid | hero) from verified person cells
  const composite = async (mode, ents, heroEnt) => {
    const cells = [];
    for (const e of ents.slice(0, 6)) {
      const p = await person(e.name);
      if (!p?.urls?.length) continue;
      const dest = path.join(dir, `cell-${++seq}.jpg`);
      if (await download(p.urls[0], dest, 400)) cells.push(`${dest}|${p.name}`);
    }
    if (cells.length < 2 && mode === "grid") return null;
    if (!cells.length && mode === "hero") return null;
    let heroArg = null;
    if (mode === "hero" && heroEnt) {
      const hc = await candidates(heroEnt);
      const h = await nextImage(`hero:${heroEnt.name}`, hc);
      if (!h) return null;
      heroArg = `${h.file}|${heroEnt.kind === "title" ? "" : heroEnt.name}`;
    }
    const out = path.join(dir, `comp-${++seq}.jpg`);
    const args = [path.join(HERE, "compose_grid.py"), "--out", out, "--mode", mode, "--cells", cells.join(","), "--font", path.join(VIDEO.fontsDir, "Anton-Regular.ttf")];
    if (heroArg) args.push("--hero", heroArg);
    try { await runPy(args); return (await probe(out)) ? out : null; } catch { return null; }
  };

  const shots = [];
  const push = (file, weight, visual, credit) => {
    if (!file) { if (shots.length) shots[shots.length - 1].weight += weight; return; }
    shots.push({ file, weight, visual, credit });
    lastFile = file;
  };

  for (let li = 0; li < lines.length; li++) {
    const v = lines[li].visual;
    const dur = lineDurs[li];
    let n = Math.max(1, Math.round(dur / MAX_SHOT)); // target ~3.75s/shot (owner: 3.5-4s)
    while (dur / n > 4.75 && n < 4) n++; // ceiling: prefer one ~4.5s hold over two 2.2s flashes
    const per = dur / n;
    const GENERIC = /^(the |these |those )?(mutants?|fans?|cast|crew|characters?|heroes?|villains?|actors?|stars?|audiences?|teams?|movies?|shows?|critics?|viewers?|people)$/i;
    let ents = (v?.entities || []).filter((e) => !GENERIC.test(e.name));
    if (!ents.length) ents = fallbackTitle ? [{ kind: "title", name: fallbackTitle }] : [];
    const persons = ents.filter((e) => e.kind !== "title");
    for (let s = 0; s < n; s++) {
      let file = null, credit = null, tag = "fallback";
      // shot 1 of a multi-entity line = the N-adaptive composite (the owner's core ask)
      if (s === 0 && v?.about === "group" && persons.length >= 2) {
        file = await composite("grid", persons);
        if (file) { credit = `composite ×${Math.min(persons.length, 6)}`; tag = `grid:${persons.length}`; }
      } else if (s === 0 && v?.about === "primary" && ents.length >= 2 && persons.filter((e) => e.name !== ents[0].name).length >= 1) {
        file = await composite("hero", persons.filter((e) => e.name !== ents[0].name), ents[0]);
        if (file) { credit = "hero+strip"; tag = `hero:${ents[0].name}`; }
      }
      // otherwise (and on composite failure): rotate through the line's entities' verified variants
      if (!file) {
        for (let k = 0; k < Math.max(ents.length, 1) && !file; k++) {
          const e = ents[(s + k) % Math.max(ents.length, 1)];
          if (!e) break;
          const r = await nextImage(`${e.kind}:${e.name}`, await candidates(e));
          if (r) { file = r.file; credit = r.credit; tag = `${e.kind}:${e.name}`; }
        }
      }
      if (!file && fallbackTitle) {
        const r = await nextImage(`t:${fallbackTitle}`, await candidates({ kind: "title", name: fallbackTitle }));
        if (r) { file = r.file; credit = r.credit; tag = "story-title"; }
      }
      if (!file && heroUrl && !files.__hero) {
        const dest = path.join(dir, `shot-src-${++seq}.jpg`);
        if ((await download(heroUrl, dest)) && (await isRelevant(heroUrl, storyTitle, namedPeople, namedTitles))) { files.__hero = dest; file = dest; credit = "article hero"; tag = "hero"; }
      }
      push(file, per, tag, credit);
    }
  }
  while (shots.length > MAX_SHOTS) { // bound the ffmpeg graph: merge the lightest into its neighbor
    let mi = 1;
    for (let i = 1; i < shots.length; i++) if (shots[i].weight < shots[mi].weight) mi = i;
    shots[mi - 1].weight += shots[mi].weight;
    shots.splice(mi, 1);
  }
  if (shots.length === 1) shots.push({ ...shots[0], weight: 0.0001 });
  if (!shots.length) throw new Error("shots: no usable frames");
  return shots;
}
