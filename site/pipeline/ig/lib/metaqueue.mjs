// META PUBLISH QUEUE (owner 2026-07-24): the Graph API cannot schedule, so the build-ahead run
// enqueues (IG container created invisible + FB payload) and every later run DRAINS what is due.
// Queue lives in the committed data dir — survives runners, participates in the ledger commit.
// The story LOCK is taken before enqueue (enqueue = the commitment); the drain never re-checks it.
import path from "node:path";
import { IG } from "../config.mjs";
import { readJson, writeJson } from "./util.mjs";
import { loadPosted, savePosted } from "./ledger.mjs";
import { igCreateContainer, igPublish, igComment, fbReelPublish, metaEnabled } from "./meta.mjs";

const qFile = () => path.join(IG.dataDir, "metaqueue.json");
const loadQ = () => readJson(qFile(), { items: [] });
const saveQ = (q) => writeJson(qFile(), q);

// ENQUEUE at publish/schedule time. Creates the IG container now (media processing happens while the
// reel waits for its slot), stores the FB payload for drain-time publishing. Returns per-platform
// results in the same shape the fan-out records.
export async function metaEnqueue({ slug, videoUrl, coverUrl, igCaption, firstComment, fbDescription, whenISO, slot, day }) {
  const results = [];
  let containerId = null;
  const ig = await igCreateContainer({ videoUrl, caption: igCaption, coverUrl });
  if (ig.ok) {
    containerId = ig.containerId;
    results.push({ platform: "instagram", id: `metaq:${containerId}`, ok: true, queued: true });
  } else {
    results.push({ platform: "instagram", id: null, ok: false, error: `container: ${ig.error}` });
  }
  results.push({ platform: "facebook", id: containerId ? `metaq:fb:${slug}` : null, ok: Boolean(containerId), queued: true, ...(containerId ? {} : { error: "not queued (ig container failed)" }) });
  if (containerId) {
    const q = loadQ();
    // one item per slug — a re-enqueue for the same slug replaces (never duplicates)
    q.items = q.items.filter((i) => i.slug !== slug);
    q.items.push({
      slug, whenISO, slot, day, videoUrl,
      igContainerId: containerId, firstComment: firstComment || null,
      fb: { videoUrl, description: fbDescription || igCaption || "" },
      enqueuedAt: new Date().toISOString(), attempts: 0, done: { ig: null, fb: null },
    });
    saveQ(q);
  }
  return { results, containerId };
}

// DRAIN — called at the start of EVERY run (build, catch-up, analytics). Publishes whatever is due,
// pins the hot-take first comment, updates the posted ledger rows in place. Best-effort per item;
// a failure increments attempts and retries next drain (containers live ~24h; 8 attempts ≈ a day).
export async function metaDrain({ log = console.log } = {}) {
  if (!metaEnabled()) return { published: 0 };
  const q = loadQ();
  if (!q.items.length) return { published: 0 };
  const now = Date.now();
  const due = q.items.filter((i) => new Date(i.whenISO).getTime() <= now + 3 * 60000);
  if (!due.length) return { published: 0, waiting: q.items.length };
  const ledger = loadPosted();
  const updateRow = (slug, platform, patch) => {
    const row = ledger.posts.find((p) => p.slug === slug && p.platform === platform);
    if (row) Object.assign(row, patch);
  };
  let published = 0;
  for (const item of due) {
    item.attempts++;
    // Instagram
    if (!item.done.ig) {
      const r = await igPublish(item.igContainerId);
      if (r.ok) {
        item.done.ig = r.mediaId;
        updateRow(item.slug, "instagram", { postId: r.mediaId, published: true, queued: false, error: null });
        log(`  📤 meta: IG published ${item.slug} (${r.mediaId})`);
        if (item.firstComment) {
          const c = await igComment(r.mediaId, item.firstComment);
          log(c.ok ? `  💬 first comment pinned on ${item.slug}` : `  ⚠ first comment failed: ${c.error}`);
        }
        published++;
      } else {
        log(`  ⚠ meta: IG publish failed for ${item.slug} (attempt ${item.attempts}): ${r.error}`);
        if (/EXPIRED|ERROR/.test(r.error) || item.attempts >= 8) {
          item.done.ig = "failed";
          updateRow(item.slug, "instagram", { published: false, queued: false, error: r.error.slice(0, 150) });
        }
      }
    }
    // Facebook (native Reel — published at slot time; no scheduling support upstream)
    if (!item.done.fb) {
      const r = await fbReelPublish(item.fb);
      if (r.ok) {
        item.done.fb = r.videoId;
        updateRow(item.slug, "facebook", { postId: r.videoId, published: true, queued: false, error: null });
        log(`  📤 meta: FB reel published ${item.slug} (${r.videoId})`);
        published++;
      } else {
        log(`  ⚠ meta: FB reel failed for ${item.slug} (attempt ${item.attempts}): ${r.error}`);
        if (item.attempts >= 8) {
          item.done.fb = "failed";
          updateRow(item.slug, "facebook", { published: false, queued: false, error: r.error.slice(0, 150) });
        }
      }
    }
  }
  // keep only items with pending work
  q.items = q.items.filter((i) => !(i.done.ig && i.done.fb));
  saveQ(q);
  savePosted(ledger);
  return { published, waiting: q.items.length };
}
