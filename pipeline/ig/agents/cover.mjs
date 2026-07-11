// AGENT 19 — COVER (plan §2.2 #19, §1.6): branded 1080x1920 cover whose critical
// elements all live inside the centered 3:4 grid-safe zone (~1080x1440). Built with
// ffmpeg drawtext (native type — the wordmark rule) over the best face frame.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { IG, FFMPEG } from "../config.mjs";
import { llm } from "../models.mjs";
import { workDirFor, outDirFor } from "../job.mjs";
import { ensureFonts } from "./render.mjs";

export async function coverHeadline(facts) {
  try {
    const res = await llm({
      role: "caption",
      system:
        'Write a reel COVER headline: 3-6 words, entity name FIRST, the hook fact, ALL CAPS reads fine (e.g. "SUPERMAN OPENS HUGE"). No punctuation except one optional exclamation. STRICT JSON {"headline":string}',
      user: `${facts.storyOneLine}\nEntities: ${facts.entities.map((e) => e.name).join(", ")}`,
      temp: 0.3,
      maxTokens: 60,
      json: true,
    });
    const h = String(res.headline || "").trim().toUpperCase().replace(/[^A-Z0-9 !'’.-]/g, "");
    if (h && h.split(" ").length <= 7) return h;
  } catch {}
  return null;
}

// two-line wrap for big display type
function wrapHeadline(h, maxChars = 13) {
  const words = h.split(" ");
  const lines = [""];
  for (const w of words) {
    if ((lines[lines.length - 1] + " " + w).trim().length > maxChars && lines.length < 3) lines.push(w);
    else lines[lines.length - 1] = (lines[lines.length - 1] + " " + w).trim();
  }
  return lines.filter(Boolean);
}

export function buildCover({ slug, baseImage, headline, segment }) {
  const out = path.join(outDirFor(), `${slug}-cover.jpg`);
  const [bx0, by0, bx1, by1] = IG.safe.coverBox; // centered 3:4 on the 9:16 canvas
  const lines = wrapHeadline(headline || "");
  // ffmpeg runs with cwd = the work dir; every filter-graph file ref is a bare relative
  // name (no spaces → no quoting), and textfile= is immune to apostrophe mangling.
  const wd = workDirFor(slug);
  ensureFonts(wd);
  lines.forEach((line, i) => fs.writeFileSync(path.join(wd, `cover-line-${i}.txt`), line));
  fs.writeFileSync(path.join(wd, "cover-seg.txt"), (segment || "THE SCREEN REPORT").toUpperCase());
  const lineFilters = lines
    .map((_, i) => {
      const y = by1 - 170 - (lines.length - 1 - i) * 128;
      return `drawtext=fontfile=fonts/Anton-Regular.ttf:textfile=cover-line-${i}.txt:fontsize=112:fontcolor=white:borderw=3:bordercolor=black@0.35:x=(w-tw)/2:y=${y}`;
    })
    .join(",");
  const filters = [
    `scale=${IG.width}:${IG.height}:force_original_aspect_ratio=increase`,
    `crop=${IG.width}:${IG.height}`,
    // legibility gradient across the lower half of the 3:4 zone
    `drawbox=y=${Math.round(by1 - 640)}:h=${Math.round(640 + (IG.height - by1))}:t=fill:color=black@0.42`,
    lineFilters,
    `drawtext=fontfile=fonts/Anton-Regular.ttf:textfile=cover-seg.txt:fontsize=34:fontcolor=white@0.85:x=(w-tw)/2:y=${by1 - 96}`,
  ]
    .filter(Boolean)
    .join(",");
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", baseImage, "-vf", filters, "-frames:v", "1", "-q:v", "3", out], {
    timeout: 60000,
    cwd: wd,
  });
  return out;
}

export async function makeCover({ job, shots }) {
  // best base = first shot of the primary subject (face-framed already)
  const primaryShot = shots.find((s) => s.entity === job.shotsMeta?.primary) || shots[0];
  const headline = (await coverHeadline(job.facts)) || job.article.title.toUpperCase().split(" ").slice(0, 5).join(" ");
  const file = buildCover({ slug: job.id, baseImage: primaryShot.img, headline, segment: job.scout?.segment });
  return { file, headline };
}
