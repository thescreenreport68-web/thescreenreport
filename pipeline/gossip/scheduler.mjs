// GOSSIP — SCHEDULER (one drip "tick"). Called by the GitHub Actions workflow, which is clocked by a Cloudflare
// Worker Cron Trigger (the same reliable mechanism the news automation uses). One tick does exactly this:
//   1) GATE on Los Angeles posting hours (10:00–22:00 PT) — DST-proof via Intl; outside hours it no-ops.
//   2) TOP UP the backlog queue only if it's running low (find on demand = lean; no discovery every tick).
//   3) PUBLISH ONE article from the backlog (draining past any held/dup until one publishes).
// It writes the article .md + updates dedup/queue state; the WORKFLOW then commits + builds + deploys. It emits
// `published=<n>` + `slugs=<..>` to $GITHUB_OUTPUT so the workflow only builds/deploys when something published.
// Run (manual): cd site && set -a; . "../.env"; set +a; node pipeline/gossip/scheduler.mjs
import fs from "node:fs";
import { gossipFind, enqueue, loadQueue } from "./find.mjs";
import { gossipRun } from "./gossiprun.mjs";

const POST_START = Number(process.env.LA_START ?? 10); // 10am PT (inclusive)
const POST_END = Number(process.env.LA_END ?? 22);     // 10pm PT (exclusive)
const MIN_BACKLOG = Number(process.env.MIN_BACKLOG ?? 15);
const PER_TICK = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 1;

// Is `now` within LA posting hours? Pure + DST-proof — America/Los_Angeles resolves PST/PDT automatically, so the
// window is always local 10am–10pm with no cron edits across daylight saving.
export function laHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hourCycle: "h23" }).format(now));
}
export function laPostingHours(now = new Date(), start = POST_START, end = POST_END) {
  const h = laHour(now);
  return h >= start && h < end;
}

function setOutput(kv) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  try { fs.appendFileSync(f, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"); } catch { /* not on CI */ }
}

export async function tick({ now = new Date(), findImpl = gossipFind, runImpl = gossipRun } = {}) {
  if (!laPostingHours(now)) {
    console.log(`[scheduler] ${now.toISOString()} — outside LA posting hours (${POST_START}:00–${POST_END}:00 PT); no-op.`);
    setOutput({ published: 0, reason: "outside-hours" });
    return { published: 0, reason: "outside-hours" };
  }
  // TOP UP only when the backlog is low — keeps discovery cost down (no find every single tick).
  const before = loadQueue().topics.length;
  if (before < MIN_BACKLOG) {
    try {
      const found = await findImpl({ categoryGuard: true });
      const { added, total } = enqueue(found, { nowIso: now.toISOString() });
      console.log(`[scheduler] backlog ${before} (< ${MIN_BACKLOG}) → found ${found.length}, enqueued ${added}, backlog now ${total}.`);
    } catch (e) { console.error(`[scheduler] find top-up failed: ${String(e?.message || e).slice(0, 120)}`); }
  }
  // PUBLISH one from the backlog.
  const report = await runImpl({ fromFind: true, limit: PER_TICK, hero: true, links: true, categoryGuard: true });
  const slugs = report.published.map((p) => p.slug);
  console.log(`[scheduler] published ${report.published.length} (processed ${report.topics}; held ${report.held.length}, rejected ${report.rejected.length}, skipped ${report.skipped.length}, blocked ${report.blocked.length}). backlog now ${loadQueue().topics.length}.`);
  setOutput({ published: report.published.length, slugs: slugs.join(",") });
  return { published: report.published.length, slugs };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await tick();
}
