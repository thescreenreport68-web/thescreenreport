// REELS VIDEO — single-article runner: article markdown -> script -> voice -> subtitles -> frames ->
// rendered 9:16 MP4 + caption sidecar (the outbox unit). The daily orchestrator (videorun.mjs: pick
// top-10 from published.json -> loop this -> post via Zernio/Buffer) wraps this same function.
// Run: cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; \
//      node site/pipeline/video/makevideo.mjs --slug=<article-slug> [--tmdb-type=tv] [--persons=a,b] [--title-entity=x]
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { costReport } from "../lib/openrouter.mjs";
import { VIDEO } from "./config.mjs";
import { writeVideoScript } from "./script.mjs";
import { synthVoice } from "./tts.mjs";
import { buildAss } from "./subs.mjs";
import { planShots } from "./shots.mjs";
import { detectSensitive } from "./sensitive.mjs";
import { renderVideo } from "./render.mjs";

const ROOT = "/Users/sivajithcu/Movie News site/site";
const arg = (k, d = null) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=").slice(1).join("=") || d;

export async function makeVideo({ slug, tmdbType, persons, titleEntity } = {}) {
  const mdPath = path.join(ROOT, "content/articles", `${slug}.md`);
  if (!fs.existsSync(mdPath)) throw new Error(`no article: ${mdPath}`);
  const { data: fm, content: body } = matter(fs.readFileSync(mdPath, "utf8"));

  // SENSITIVITY FLOOR (owner rule: a video amplifies a mistake) — never video a death/legal story that the
  // article pipeline marked sensitive; and RUMOR-status stories don't get videos at all in v1.
  const sens = fm?.provenance?.sensitivity || "";
  if (String(fm.storyStatus).toUpperCase() === "RUMOR") throw new Error("skip: RUMOR story");
  // PHASE 2 defense-in-depth: same sensitivity code-gate as the picker (covers direct --slug runs)
  const sensFlags = detectSensitive(fm, body.slice(0, 1200));
  if (sensFlags.legal || sensFlags.minor) throw new Error("skip: sensitive story (legal/minor)");
  if (sensFlags.death && VIDEO.sensitivePolicy !== "somber") throw new Error("skip: sensitive story (death, policy=block)");

  const work = path.join(VIDEO.workDir, slug);
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(VIDEO.outDir, { recursive: true });

  // 1 · SCRIPT (facts only from the verify-gated article)
  console.log("· script…");
  let script;
  try { script = await writeVideoScript({ title: fm.title, dek: fm.dek, body, category: fm.category }); }
  catch { script = await writeVideoScript({ title: fm.title, dek: fm.dek, body, category: fm.category, model: VIDEO.scriptModelFallback }); }
  if (sensFlags.death) script.genre = "death"; // register is FORCED — never left to the writer on a death story
  fs.writeFileSync(path.join(work, "script.json"), JSON.stringify(script, null, 2));
  console.log(`  hook: "${script.hook.say}" (${script.words} words total)`);

  // 2 · VOICE (Kokoro af_heart — $0) — one line per sentence so the pronunciation pass
  // (lexicon.mjs: punctuation discipline + respellings) anchors every sentence boundary
  console.log("· voice…");
  const speechLines = [script.hook, ...script.lines].map((l) => l.say).join("\n");
  const { wav, duration, qc } = await synthVoice({ text: speechLines, outWav: path.join(work, "vo.wav") });
  console.log(`  ${duration}s of narration`);

  // 3 · SUBTITLES (brand karaoke captions)
  const ass = buildAss({ lines: [script.hook, ...script.lines], duration, kicker: script.onScreenTitle || "" });
  const assFile = path.join(work, "subs.ass");
  fs.writeFileSync(assFile, ass);

  // 4 · THE VISUAL BRAIN — per-line entity storyboard → verified image pool → the 3-second pacing
  // law (shots.mjs). Every frame matches the words being spoken; no frame outlives MAX_SHOT.
  console.log("· images…");
  const allLines = [script.hook, ...script.lines];
  const charW = allLines.map((l) => Math.max(String(l.say || "").length, 1));
  const sumW = charW.reduce((a, b) => a + b, 0);
  const lineDurs = charW.map((w) => (w / sumW) * duration); // narration-synced line timing
  const images = await planShots({
    dir: work,
    lines: allLines,
    lineDurs,
    fallbackTitle: titleEntity || fm.targetKeyword || fm?.provenance?.primaryEntity || (fm.tags || [])[0] || fm.title,
    tmdbType: tmdbType || (fm.category === "tv" ? "tv" : "movie"),
    heroUrl: fm.image || null,
    storyTitle: fm.title,
  });
  console.log(`  ${images.length} shots: ${images.map((i) => i.visual).join(" | ")}`);

  // 5 · RENDER (spec-locked for every platform) — watermark + ANIMATED end-card + optional music bed
  console.log("· render…");
  const wmFile = path.join(VIDEO.assetsDir, "logo-white.png"), ecFile = path.join(VIDEO.assetsDir, "endcard.mp4");
  // music: any file dropped in assets/music/ is auto-used (deterministic per-story pick, ducked under
  // the voice) — EXCEPT death/tragedy stories, which run voice-only out of respect (and brand safety)
  let music = null;
  const topicText = `${sens} ${fm.title} ${fm.dek || ""} ${(fm.tags || []).join(" ")}`;
  const somber = sensFlags.death; // Phase 2: the DETECTOR decides (body-aware), not a title regex
  if (!somber) try {
    // MOOD MATCHING (owner 2026-07-03): the bed must fit the topic. Beds are mood-tagged by filename
    // prefix (tense-*, upbeat-*, emotional-*, neutral-*); the story's mood comes from a keyword read.
    const mood = /lawsuit|sues|feud|fired|exits?|scandal|slams|controvers|arrest|split|divorce|thriller|horror/i.test(topicText) ? "tense"
      : /box office|record|hit|wins?|award|renewed|casting|joins|announce|trailer|premiere|returns/i.test(topicText) ? "upbeat"
      : /tribute|honors|farewell|emotional|reunion|memoir/i.test(topicText) ? "emotional" : "neutral";
    const beds = fs.readdirSync(VIDEO.musicDir).filter((f) => /\.(mp3|m4a|wav|aac)$/i.test(f)).sort();
    const fit = beds.filter((f) => f.startsWith(mood + "-"));
    const pool = fit.length ? fit : beds.filter((f) => f.startsWith("neutral-")).length ? beds.filter((f) => f.startsWith("neutral-")) : beds;
    if (pool.length) { music = path.join(VIDEO.musicDir, pool[slug.length % pool.length]); console.log(`  music: ${mood} → ${pool[slug.length % pool.length]}`); }
  } catch {}
  const out = path.join(VIDEO.outDir, `${slug}.mp4`);
  const r = await renderVideo({
    images, audio: wav, assFile, out, duration,
    watermark: fs.existsSync(wmFile) ? wmFile : null,
    endcard: fs.existsSync(ecFile) ? ecFile : null,
    music,
  });

  // 6 · OUTBOX SIDECAR — captions per platform + provenance log (image credits/URLs for takedown response)
  // G (owner 2026-07-03): strip markdown from EVERY platform caption — "*Three Days of the Condor*" was
  // showing literal asterisks on X/IG. (Also removed the old #tag-trim that deleted legit short tags like #F1.)
  const stripMd = (s) => String(s).replace(/[*_`~]+/g, "").replace(/\s{2,}/g, " ").trim();
  if (script.captions) {
    const c = script.captions;
    for (const k of ["instagram", "facebook", "x"]) if (typeof c[k] === "string") c[k] = stripMd(c[k]);
    for (const k of ["pinterest", "youtube"]) if (c[k] && typeof c[k] === "object") for (const kk of Object.keys(c[k])) if (typeof c[k][kk] === "string") c[k][kk] = stripMd(c[k][kk]);
  }
  const sidecar = {
    slug, title: fm.title, madeAt: new Date().toISOString(), seconds: r.seconds, file: out,
    captions: script.captions, onScreenTitle: script.onScreenTitle,
    images: images.map((i) => ({ url: i.url, credit: i.credit, w: i.w, h: i.h })),
    // CC-BY attribution — the posting modules append this to YouTube/Pinterest descriptions
    music: music ? { file: path.basename(music), credit: `Music: "${path.basename(music, path.extname(music)).replace(/-/g, " ")}" — Kevin MacLeod (incompetech.com), CC BY 4.0` } : null,
    articleUrl: `https://thescreenreport.com/${fm.category}/${slug}/`, sensitivity: sens || null, qc: qc || null, genre: script.genre || null, judge: script.judge || null,
  };
  fs.writeFileSync(path.join(VIDEO.outDir, `${slug}.json`), JSON.stringify(sidecar, null, 2));
  return { out, sidecar, script, seconds: r.seconds };
}

// CLI
if (process.argv[1] && process.argv[1].endsWith("makevideo.mjs")) {
  const slug = arg("slug");
  if (!slug) { console.error("usage: node makevideo.mjs --slug=<article-slug>"); process.exit(1); }
  makeVideo({ slug, tmdbType: arg("tmdb-type"), persons: arg("persons"), titleEntity: arg("title-entity") })
    .then((r) => { console.log(`✓ ${r.out} (${r.seconds}s)`); console.log(costReport?.() || ""); })
    .catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}
