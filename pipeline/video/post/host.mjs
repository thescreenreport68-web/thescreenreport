// VIDEO HOSTING — pushes a finished MP4 to the public tsr-media repo and returns a public URL the
// posting bridges (Buffer/Zernio) can fetch. Owner-authorized public host (2026-07-05). $0.
// Uses the GitHub Contents API (fine for our ~15MB/day). Unique filename per upload → no conflicts.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const OWNER = "thescreenreport68-web";
const REPO = "tsr-media";
const gh = async (method, url, body) => {
  const r = await fetch(url, {
    method,
    headers: { authorization: `token ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
};

// generic: push local bytes to repoPath → return the public raw URL (+ repoPath for later delete)
async function push(localFile, repoPath, msg) {
  const bytes = fs.readFileSync(localFile);
  const put = await gh("PUT", `https://api.github.com/repos/${OWNER}/${REPO}/contents/${repoPath}`, { message: msg, content: bytes.toString("base64"), branch: "main" });
  if (!put.ok) throw new Error(`host upload failed (${put.status}): ${JSON.stringify(put.json).slice(0, 200)}`);
  return { url: `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${repoPath}`, repoPath };
}

const stampOf = (f) => String(Date.parse(fs.statSync(f).mtime) || fs.statSync(f).size); // stable per file, no Date.now()

// uploads mp4File → returns { url, repoPath }
export async function hostVideo(mp4File, slug) {
  return push(mp4File, `videos/${slug}-${stampOf(mp4File)}.mp4`, `add ${slug}`);
}

// extracts a cover frame from the video (Pinterest video pins + a nicer thumbnail everywhere) and hosts it
export async function hostThumb(mp4File, slug) {
  const jpg = path.join(os.tmpdir(), `thumb-${slug}-${stampOf(mp4File)}.jpg`);
  execFileSync("ffmpeg", ["-y", "-ss", "1.2", "-i", mp4File, "-frames:v", "1", "-q:v", "3", jpg], { stdio: "ignore" });
  const r = await push(jpg, `thumbs/${slug}-${stampOf(mp4File)}.jpg`, `thumb ${slug}`);
  try { fs.unlinkSync(jpg); } catch {}
  return r;
}

// direct delete of a hosted file by repoPath (verification cleanup)
export async function unhost(repoPath) {
  const meta = await gh("GET", `https://api.github.com/repos/${OWNER}/${REPO}/contents/${repoPath}`);
  if (!meta.ok || !meta.json?.sha) return false;
  const del = await gh("DELETE", `https://api.github.com/repos/${OWNER}/${REPO}/contents/${repoPath}`, { message: `remove ${repoPath}`, sha: meta.json.sha, branch: "main" });
  return del.ok;
}

// housekeeping: delete videos + thumbs older than keepDays from the media repo (keeps it lean)
export async function pruneHost(keepDays = 14) {
  const cutoff = Date.now() - keepDays * 864e5;
  let removed = 0;
  for (const dir of ["videos", "thumbs"]) {
    const list = await gh("GET", `https://api.github.com/repos/${OWNER}/${REPO}/contents/${dir}`);
    if (!list.ok || !Array.isArray(list.json)) continue;
    for (const f of list.json) {
      const m = f.name.match(/-(\d{10,})\.(mp4|jpg)$/);
      if (m && Number(m[1]) < cutoff) {
        const del = await gh("DELETE", `https://api.github.com/repos/${OWNER}/${REPO}/contents/${dir}/${f.name}`, { message: `prune ${f.name}`, sha: f.sha, branch: "main" });
        if (del.ok) removed++;
      }
    }
  }
  return removed;
}
