// HOST — push a finished card PNG to the public `tsr-media` repo → a public URL Buffer/Pinterest can fetch.
// Uses the GitHub Contents API. Auto-prunes after 21 days. GITHUB_TOKEN (a repo-scoped PAT) in env.
import fs from "node:fs";

const OWNER = "thescreenreport68-web", REPO = "tsr-media";
const gh = async (method, url, body) => {
  const r = await fetch(url, {
    method,
    headers: { authorization: `token ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
};

// upload a local PNG → { url, repoPath }
export async function hostCard(pngFile, slug) {
  const bytes = fs.readFileSync(pngFile);
  const stamp = String(Date.parse(fs.statSync(pngFile).mtime) || bytes.length);
  const repoPath = `pins/${slug.slice(0, 60)}-${stamp}.png`;
  const put = await gh("PUT", `https://api.github.com/repos/${OWNER}/${REPO}/contents/${repoPath}`, {
    message: `pin ${slug}`, content: bytes.toString("base64"), branch: "main",
  });
  if (!put.ok) throw new Error(`host failed (${put.status}): ${JSON.stringify(put.json).slice(0, 160)}`);
  return { url: `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${repoPath}`, repoPath };
}

export async function unhost(repoPath) {
  const meta = await gh("GET", `https://api.github.com/repos/${OWNER}/${REPO}/contents/${repoPath}`);
  if (!meta.ok || !meta.json?.sha) return false;
  const del = await gh("DELETE", `https://api.github.com/repos/${OWNER}/${REPO}/contents/${repoPath}`, { message: `prune ${repoPath}`, sha: meta.json.sha, branch: "main" });
  return del.ok;
}

export async function pruneCards(keepDays = 21) {
  const list = await gh("GET", `https://api.github.com/repos/${OWNER}/${REPO}/contents/pins`);
  if (!list.ok || !Array.isArray(list.json)) return 0;
  const cutoff = Date.now() - keepDays * 864e5;
  let n = 0;
  for (const f of list.json) {
    const m = f.name.match(/-(\d{10,})\.png$/);
    if (m && Number(m[1]) < cutoff) { const d = await gh("DELETE", `https://api.github.com/repos/${OWNER}/${REPO}/contents/pins/${f.name}`, { message: `prune ${f.name}`, sha: f.sha, branch: "main" }); if (d.ok) n++; }
  }
  return n;
}
