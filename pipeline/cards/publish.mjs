// PUBLISHER — hosts the JPEG (tsr-media raw URL), posts via Zernio to IG + FB (each
// platform its own caption + first comment), enforces the QUOTA GUARD, and verifies live.
// Draft-safe by default: real publishing requires CARDS_LIVE=1 (owner go-live, plan §7).
//
// QUOTA GUARD (plan §5 — Meta docs disagree 100 vs 50, Zernio's blog says 25/24h INCLUDING
// reels): we keep a local rolling-24h count of OUR IG publishes and assume the reels lane's
// 7/day on top; total is capped at `assumedCap` (conservative 23) until the owner confirms
// the enforced quota ≥50 via GET /<IG_ID>/content_publishing_limit (checked live when
// IG_GRAPH_TOKEN + IG_USER_ID are in env). Posts blocked by quota are QUEUED, never dropped.
import fs from "node:fs";
import path from "node:path";
import { CARDS } from "./config.mjs";
import { fetchWithTimeout, sleep, readJson, writeJson } from "./lib/util.mjs";

const GH_API = "https://api.github.com";
const ghHeaders = () => ({
  Authorization: `Bearer ${process.env.TSR_GH_TOKEN || process.env.GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "tsr-cards",
});

// Host one JPEG in the tsr-media repo (contents API, exponential backoff). A card is
// cheap to rebuild (~1 min) — one hardened path suffices here, unlike a 3-min reel.
export async function hostFile(localPath, destName) {
  if (!process.env.TSR_GH_TOKEN && !process.env.GITHUB_TOKEN) throw new Error("hostFile: no GH token in env"); // fail fast, not after 5 retries (review #14)
  const [owner, repo] = CARDS.host.repo.split("/");
  const rel = `${CARDS.host.dir}/${destName}`;
  const url = `${GH_API}/repos/${owner}/${repo}/contents/${rel}`;
  const content = fs.readFileSync(localPath).toString("base64");
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    let sha;
    try { const cur = await fetchWithTimeout(url, { headers: ghHeaders() }, 15000); if (cur.ok) sha = (await cur.json()).sha; } catch {}
    try {
      const res = await fetchWithTimeout(url, {
        method: "PUT", headers: ghHeaders(),
        body: JSON.stringify({ message: `host ${rel}`, content, branch: "main", ...(sha ? { sha } : {}) }),
      }, 120000);
      if (res.ok) {
        const publicUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${rel}`;
        for (let i = 0; i < 8; i++) { // wait for the raw CDN before handing the URL to Zernio
          try { const head = await fetchWithTimeout(publicUrl, { method: "HEAD" }, 15000); if (head.ok) return publicUrl; } catch {}
          await sleep(4000);
        }
        return publicUrl; // uploaded OK; CDN warming
      }
      lastErr = new Error(`host ${rel}: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`);
      if (res.status < 500 && res.status !== 429 && res.status !== 409) throw lastErr; // real 4xx
    } catch (e) { lastErr = e; }
    if (attempt < 5) await sleep(Math.min(45000, 4000 * 2 ** (attempt - 1)));
  }
  throw lastErr;
}

// ── quota guard ─────────────────────────────────────────────────────────────────────
const REELS_ASSUMED_PER_DAY = 7; // the live reels lane's cadence — counted against the shared IG quota
const ASSUMED_CAP = 23; // stay under Zernio's claimed 25/24h until the enforced quota is confirmed ≥50

export function igPublishes24h(ledger, now = Date.now()) {
  const cut = now - 24 * 3600_000;
  // drafts never hit Meta's publish quota — count only live modes (review #25)
  return (ledger?.posted || []).filter((p) => p.at > cut && p.mode !== "draft" && p.platforms?.some((x) => x.platform === "instagram" && x.ok)).length;
}

export async function quotaGate(ledger, { now = Date.now() } = {}) {
  const mine = igPublishes24h(ledger, now);
  // live check when Graph creds exist (owner may wire them later; Zernio holds the token today)
  const token = process.env[CARDS.quota.tokenEnv];
  const igId = process.env[CARDS.quota.igUserIdEnv];
  if (token && igId) {
    try {
      const r = await fetchWithTimeout(`https://graph.facebook.com/v21.0/${igId}/content_publishing_limit`, { headers: { Authorization: `Bearer ${token}` } }, 12000); // token in header — never in a loggable URL
      const j = await r.json();
      const cfg = j?.data?.[0];
      if (cfg && Number.isFinite(cfg.quota_usage) && cfg.config?.quota_total) {
        const left = cfg.config.quota_total - cfg.quota_usage;
        return left > CARDS.quota.reserve ? { ok: true, source: "graph", left } : { ok: false, source: "graph", left };
      }
    } catch { /* fall through to the conservative local model */ }
  }
  const assumedUsed = mine + REELS_ASSUMED_PER_DAY;
  const left = ASSUMED_CAP - assumedUsed;
  return left > CARDS.quota.reserve ? { ok: true, source: "local", left } : { ok: false, source: "local", left };
}

// ── zernio ──────────────────────────────────────────────────────────────────────────
const zHeaders = () => ({ Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`, "Content-Type": "application/json" });

async function zernioCreate(body, label = "") {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetchWithTimeout(`${CARDS.zernio.base}/posts`, { method: "POST", headers: zHeaders(), body: JSON.stringify(body) }, 60000);
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if (res.status < 500 && res.status !== 429) throw new Error(`zernio${label} ${res.status}: ${JSON.stringify(data).slice(0, 250)}`);
    if (attempt === 3) throw new Error(`zernio${label} ${res.status} after 3 tries: ${JSON.stringify(data).slice(0, 200)}`);
    await sleep(attempt * 3000);
  }
}

const postId = (d) => d?._id || d?.id || d?.post?._id || d?.post?.id || d?.data?._id || d?.data?.id; // `_id` first — verified live 2026-07-13

function platformPaused(platform) {
  return fs.existsSync(path.join(CARDS.dataDir, `PAUSED_${platform.toUpperCase()}`));
}

// One image → IG + FB, error-isolated, each with its own caption + first comment.
// live=false → Zernio draft (never publishes). breaking → publishNow instead of scheduledFor.
export async function publishCard({ imageUrl, captions, whenISO, live = false, breaking = false }) {
  const results = [];
  if (live && !process.env.ZERNIO_API_KEY) throw new Error("publishCard: ZERNIO_API_KEY not in env"); // fail fast (review #13)
  // body shapes per docs.zernio.com (verified 2026-07-16): live-now (breaking OR a slot that is
  // already due, i.e. no whenISO) = publishNow:true; scheduled = status "scheduled" + scheduledFor
  // + timezone (the reels lane's proven shape — NEVER status:"scheduled" without a time, review #2);
  // draft = status "draft" (live-proven) + isDraft (the changelog's post-level flag) — both sent.
  // firstComment sent BOTH top-level and under platformSpecificData (the verified contract names
  // the latter; the dual-send mirrors the status+isDraft pattern — review #22).
  const common = (accountId, platform, content, firstComment) => ({
    content,
    ...(live
      ? breaking || !whenISO
        ? { publishNow: true }
        : { status: "scheduled", scheduledFor: whenISO, timezone: CARDS.slots.postTz }
      : { status: "draft", isDraft: true }),
    platforms: [{ accountId, platform }],
    mediaItems: [{ type: "image", url: imageUrl }],
    ...(firstComment ? { firstComment, platformSpecificData: { firstComment } } : {}),
  });
  const enabled = CARDS.platforms.filter((p) => !platformPaused(p));
  for (const platform of enabled) {
    try {
      const body = platform === "instagram"
        ? common(CARDS.zernio.igAccountId, "instagram", captions.ig, captions.firstComment)
        : common(CARDS.zernio.fbAccountId, "facebook", captions.fb, captions.firstComment);
      const data = await zernioCreate(body, `(${platform})`);
      results.push({ platform, id: postId(data), ok: Boolean(postId(data)) });
      await sleep(2000); // courtesy gap between the IG and FB calls of ONE card (burst spacing between CARDS is enforced upstream)
    } catch (e) {
      results.push({ platform, ok: false, error: String(e.message || e).slice(0, 200) });
    }
  }
  return { mode: live ? (breaking || !whenISO ? "publishNow" : "scheduled") : "draft", whenISO: live && !breaking ? whenISO || null : null, results };
}

export async function zernioStatus(id) {
  const res = await fetchWithTimeout(`${CARDS.zernio.base}/posts/${id}`, { headers: zHeaders() }, 30000);
  const data = await res.json().catch(() => ({}));
  const p = data.platforms?.[0] || data.post?.platforms?.[0] || {};
  return { status: p.status || data.status, permalink: p.url || p.permalink || null };
}

// budget must fit the workflow's 20-min job timeout with npm ci + build + host + 2 platforms (review #10/#23)
export async function verifyLive(id, { timeoutMin = 4, everySec = 30 } = {}) {
  const until = Date.now() + timeoutMin * 60000;
  let last = null;
  while (Date.now() < until) {
    last = await zernioStatus(id).catch(() => null);
    if (last?.status === "published") return { live: true, permalink: last.permalink };
    if (last?.status === "failed") return { live: false, failed: true };
    await sleep(everySec * 1000);
  }
  return { live: false, timedOut: true, last };
}

// ── ledger ──────────────────────────────────────────────────────────────────────────
export function loadLedger() {
  // fail CLOSED on a corrupt ledger — an unreadable ledger silently resetting the dup
  // guard + quota model is how double-posts happen (review #15). Absent file = first run.
  if (!fs.existsSync(CARDS.ledgerPath)) return { posted: [], bursts: [] };
  const raw = fs.readFileSync(CARDS.ledgerPath, "utf8");
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`ledger.json is corrupt — refusing to run (${e.message})`); }
  return { posted: Array.isArray(parsed?.posted) ? parsed.posted : [], bursts: Array.isArray(parsed?.bursts) ? parsed.bursts : [] };
}
export function recordPost(ledger, entry) {
  ledger.posted.push({ at: Date.now(), ...entry });
  ledger.posted = ledger.posted.filter((p) => p.at > Date.now() - 14 * 24 * 3600_000); // 2-week window is all we need
  ledger.bursts = (ledger.bursts || []).filter((b) => b > Date.now() - 24 * 3600_000); // budget window only (review #19)
  writeJson(CARDS.ledgerPath, ledger);
}
export function breakingBudget(ledger, now = Date.now()) {
  const dayCut = now - 24 * 3600_000;
  const recent = (ledger.posted || []).filter((p) => p.at > dayCut && p.breaking);
  const bursts = (ledger.bursts || []).filter((b) => b > dayCut);
  return {
    breakingLeft: CARDS.breaking.maxPerDay - recent.length,
    burstsLeft: CARDS.breaking.maxBurstsPerDay - bursts.length,
  };
}
