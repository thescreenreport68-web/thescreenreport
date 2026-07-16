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
import * as pace from "./lib/pacing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // …/site/pipeline
const QUEUE = path.resolve(__dirname, "../data/find/queue.json");

const POST_START = Number(process.env.LA_START ?? 10); // 10am PT (inclusive)
const POST_END = Number(process.env.LA_END ?? 22);     // 10pm PT (exclusive)
// SCALE-UP (owner 2026-07-16, NEWS_REALTIME_SCALE_PLAN Phase 1): ticks now come every 30 min with PER_TICK 2, so the
// backlog burns 2×/tick — top up earlier, judge more candidates, keep a deeper queue, and refresh a stale queue in
// minutes (a 45-min-old queue on a breaking day is already behind).
const MIN_BACKLOG = Number(process.env.MIN_BACKLOG ?? 8); // top up when fewer than this many FRESH topics remain
const PER_TICK = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 1;
const FIND_CANDIDATES = process.env.FIND_CANDIDATES || "120";
const FIND_QUEUE = process.env.FIND_QUEUE || "30";

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

// Age (hours) since findrun last (re)built the queue. Breaks the STUCK-QUEUE DEADLOCK (owner 2026-07-10): a queue of
// topics that are "fresh" (not in the ledger) but UNPUBLISHABLE — stale 3-day-old sources, repeatedly held — keeps
// freshBacklog >= MIN_BACKLOG forever, so the backlog gate NEVER fires a top-up, discovery stalls, and run.mjs keeps
// failing the same topics → published 0 indefinitely (this stopped the news lane for ~2.5 days). A stale queue must
// force a refresh regardless of the backlog count so CURRENT stories replace the stuck ones.
export function queueAgeHours() {
  try { const b = JSON.parse(fs.readFileSync(QUEUE, "utf8")).builtAt; return b ? (Date.now() - Date.parse(b)) / 3.6e6 : Infinity; }
  catch { return Infinity; }
}
const QUEUE_STALE_HOURS = Number(process.env.QUEUE_STALE_HOURS ?? 0.75); // refresh a queue older than this even if backlog looks high (45 min — scale-up 2026-07-16)

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
  // TOP UP when the fresh backlog is low (cost control: no FIND every tick) OR when the queue is STALE (deadlock
  // breaker — see queueAgeHours: a backlog of unpublishable-but-unpublished topics must not permanently block discovery).
  const backlog = freshBacklog();
  const ageH = queueAgeHours();
  const ageStr = ageH === Infinity ? "∞" : ageH.toFixed(1);
  if (backlog < MIN_BACKLOG || ageH > QUEUE_STALE_HOURS) {
    console.log(`[news-scheduler] fresh backlog ${backlog}, queue age ${ageStr}h → running FIND top-up (trigger: backlog<${MIN_BACKLOG} or age>${QUEUE_STALE_HOURS}h)…`);
    try { runNode("find/findrun.mjs", [`--candidates=${FIND_CANDIDATES}`, `--queue=${FIND_QUEUE}`], { FIND_SKIP_RECHECK: process.env.FIND_KEEP_RECHECK ? "" : "1" }); }
    catch (e) { console.error(`[news-scheduler] FIND top-up failed: ${String(e?.message || e).slice(0, 160)}`); }
  } else {
    console.log(`[news-scheduler] fresh backlog ${backlog} (>= ${MIN_BACKLOG}), queue age ${ageStr}h (<= ${QUEUE_STALE_HOURS}h) → publishing from existing queue.`);
  }
  // ── PACING GOVERNOR (Phase 4, NEWS_REALTIME_SCALE_PLAN §6) ─────────────────────────────────────
  // Load AFTER the FIND top-up (findrun feeds the quantile window), roll the LA day (fires the daily
  // missed-story audit for the closed day), refill the bucket by wall-clock, compute the day's bar.
  const st = pace.load();
  const closed = pace.dayRoll(st, now.getTime());
  if (closed) {
    console.log(`[news-scheduler] LA day rolled (${closed.date} → ${st.day.date}; published ${closed.published}, tierS ${closed.tierS}) — running missed-story audit…`);
    try { process.stdout.write(runNode("scripts/audit-missed.mjs", [closed.date])); }
    catch (e) { console.error(`[news-scheduler] audit-missed failed: ${String(e?.message || e).slice(0, 140)}`); }
  }
  pace.refill(st, now.getTime());
  const { bar, q, n, cold } = pace.computeBar(st, now.getTime());
  // Allowance: bucket-limited, tick-capped; a tick only publishes 0 when the day is AHEAD of its pace curve
  // (the owner's always-post rule bends the pace to 1/tick, never to silence while behind).
  let allow = Math.min(PER_TICK, Math.floor(st.bucket.tokens));
  if (allow < 1 && pace.behindPace(st, now.getTime())) allow = 1;
  console.log(`[news-scheduler] pacing: bar ${bar}${cold ? " (cold-start floor)" : ` (q=${q}, n=${n})`} · tokens ${st.bucket.tokens.toFixed(2)} · day ${st.day.published}/${pace.CFG.TARGET} → allow ${allow}`);
  if (allow < 1) {
    pace.save(st);
    console.log(`[news-scheduler] ahead of pace — skipping this tick (tokens rebuild by wall-clock).`);
    setOutput({ published: 0, reason: "pacing-ahead" });
    return { published: 0, reason: "pacing-ahead" };
  }
  // PUBLISH up to `allow` from the queue (run.mjs ledger-skips already-published topics; PACE_BAR drops topics
  // below the day's bar). CONCURRENCY scales with the target (max 3) — every article runs the FULL gate chain.
  let out = "";
  try { out = runNode("run.mjs", ["--from-find", `--target=${allow}`], { CONCURRENCY: String(Math.min(3, Math.max(1, allow))), PACE_BAR: cold ? "" : String(bar) }); }
  catch (e) { console.error(`[news-scheduler] MAKE failed: ${String(e?.message || e).slice(0, 160)}`); pace.save(st); setOutput({ published: 0, reason: "make-error" }); return { published: 0, reason: "make-error" }; }
  // Echo the child's full output into OUR log — run.mjs prints the MEASURED COST + per-stage detail, and swallowing
  // it made per-article cost unrecoverable (owner 2026-07-16: cost must be visible in the cloud logs).
  process.stdout.write(out);
  const slugs = [...out.matchAll(/✓ WROTE (\S+?)\.md/g)].map((m) => m[1]);
  const published = Number((out.match(/DONE\. published:(\d+)/) || [])[1] || slugs.length || 0);
  // Spend tokens for what actually published + append the tick to the day's stats ledger (incl. measured cost).
  pace.take(st, published, now.getTime());
  pace.save(st);
  const costM = out.match(/TOTAL: \$([\d.]+) across (\d+) calls(?: · \$([\d.]+)\/article)?/);
  pace.statsAppend({
    ticks: [{ at: now.toISOString(), bar: cold ? null : bar, q, windowN: n, allow, published, slugs, costUsd: costM ? Number(costM[1]) : null }],
    published, costUsd: costM ? Number(costM[1]) : 0,
  });
  console.log(`[news-scheduler] published ${published} (${slugs.join(", ") || "—"}). day ${st.day.published}/${pace.CFG.TARGET} · tokens ${st.bucket.tokens.toFixed(2)} · fresh backlog ${freshBacklog()}.`);
  setOutput({ published, slugs: slugs.join(",") });
  return { published, slugs };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await tick();
}
