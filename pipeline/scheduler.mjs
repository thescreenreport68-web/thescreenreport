// NEWS — SCHEDULER (one drip "tick"). Called by the `news-drip` GitHub Actions workflow, which is clocked by a
// Cloudflare Worker Cron Trigger (GitHub's own cron is drifty, so we drive it externally — the same reliable
// mechanism the gossip lane uses). One tick does exactly this:
//   1) GATE on Los Angeles posting hours (10:00–22:00 PT) — DST-proof via Intl; outside hours it no-ops.
//   2) TOP UP the queue via findrun ONLY when the fresh backlog (queued topics not yet in the published ledger)
//      is low — find-on-demand keeps discovery cost down (no FIND every single tick).
//   3) PUBLISH ONE article via run.mjs --from-find (CONCURRENCY=1 so exactly one publishes per tick → the drip
//      spreads ~10 articles evenly across the hour instead of a burst).
// It writes the article .md + updates the dedup ledger; the WORKFLOW then commits + builds + deploys. It emits
// `published=<n>` + `slugs=<..>` to $GITHUB_OUTPUT so the workflow only builds/deploys when something published.
// Run (manual):  cd site && set -a; . "../.env"; set +a; node pipeline/scheduler.mjs [--limit=1]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadPublished, slugKey, entityKey } from "./find/store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // …/site/pipeline
const QUEUE = path.resolve(__dirname, "../data/find/queue.json");

const POST_START = Number(process.env.LA_START ?? 10); // 10am PT (inclusive)
const POST_END = Number(process.env.LA_END ?? 22);     // 10pm PT (exclusive)
const MIN_BACKLOG = Number(process.env.MIN_BACKLOG ?? 4); // top up when fewer than this many FRESH topics remain
const PER_TICK = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 1;
const FIND_CANDIDATES = process.env.FIND_CANDIDATES || "45";
const FIND_QUEUE = process.env.FIND_QUEUE || "18";

// Is `now` within LA posting hours? Pure + DST-proof — America/Los_Angeles resolves PST/PDT automatically, so the
// window is always local 10am–10pm with no cron edits across daylight saving.
export function laHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hourCycle: "h23" }).format(now));
}
export function laPostingHours(now = new Date(), start = POST_START, end = POST_END) {
  const h = laHour(now);
  return h >= start && h < end;
}

// Count queued topics that are NOT already in the published ledger — the true "fresh backlog" the drip can still post.
export function freshBacklog() {
  let topics = [];
  try { topics = JSON.parse(fs.readFileSync(QUEUE, "utf8")).topics || []; } catch { return 0; }
  const pub = loadPublished();
  return topics.filter((t) =>
    !(t.title && pub.titles.has(slugKey(t.title))) &&
    !(t.eventSlug && pub.events.has(t.eventSlug)) &&
    !(entityKey(t.primaryEntity, t.eventType) && pub.entities.has(entityKey(t.primaryEntity, t.eventType)))).length;
}

function setOutput(kv) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  try { fs.appendFileSync(f, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"); } catch { /* not on CI */ }
}

function runNode(script, args, extraEnv = {}) {
  return execFileSync("node", [path.resolve(__dirname, script), ...args], {
    cwd: __dirname, env: { ...process.env, ...extraEnv }, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024,
  });
}

export async function tick({ now = new Date() } = {}) {
  if (!laPostingHours(now)) {
    console.log(`[news-scheduler] ${now.toISOString()} — outside LA posting hours (${POST_START}:00–${POST_END}:00 PT); no-op.`);
    setOutput({ published: 0, reason: "outside-hours" });
    return { published: 0, reason: "outside-hours" };
  }
  // TOP UP only when the fresh backlog is low — keeps discovery cost down (no FIND every tick).
  const backlog = freshBacklog();
  if (backlog < MIN_BACKLOG) {
    console.log(`[news-scheduler] fresh backlog ${backlog} (< ${MIN_BACKLOG}) → running FIND top-up…`);
    try { runNode("find/findrun.mjs", [`--candidates=${FIND_CANDIDATES}`, `--queue=${FIND_QUEUE}`], { FIND_SKIP_RECHECK: process.env.FIND_KEEP_RECHECK ? "" : "1" }); }
    catch (e) { console.error(`[news-scheduler] FIND top-up failed: ${String(e?.message || e).slice(0, 160)}`); }
  } else {
    console.log(`[news-scheduler] fresh backlog ${backlog} (>= ${MIN_BACKLOG}) → publishing from existing queue.`);
  }
  // PUBLISH one from the queue (CONCURRENCY=1 → exactly one per tick; run.mjs ledger-skips already-published topics).
  let out = "";
  try { out = runNode("run.mjs", ["--from-find", `--target=${PER_TICK}`], { CONCURRENCY: "1" }); }
  catch (e) { console.error(`[news-scheduler] MAKE failed: ${String(e?.message || e).slice(0, 160)}`); setOutput({ published: 0, reason: "make-error" }); return { published: 0, reason: "make-error" }; }
  const slugs = [...out.matchAll(/✓ WROTE (\S+?)\.md/g)].map((m) => m[1]);
  const published = Number((out.match(/DONE\. published:(\d+)/) || [])[1] || slugs.length || 0);
  console.log(`[news-scheduler] published ${published} (${slugs.join(", ") || "—"}). fresh backlog now ${freshBacklog()}.`);
  setOutput({ published, slugs: slugs.join(",") });
  return { published, slugs };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await tick();
}
