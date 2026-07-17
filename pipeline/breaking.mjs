// BREAKING FAST PATH (owner 2026-07-16, NEWS_REALTIME_SCALE_PLAN §4) — one story, dispatched by the sentinel the
// minute it appears on a top feed. This script does NO writing itself: it turns the sentinel's {url,title} into a
// proper FIND topic (same categorize + entity-resolution as the drip), applies the SAME safety policy, prepends it
// to the queue, and hands off to run.mjs — so a breaking article passes the IDENTICAL gate chain as every other
// article (faithful write, ≥80 gate, seoFinish suite, hero image). Speed comes from skipping the full FIND sweep,
// never from skipping quality.
//
// SAFETY POLICY (owner-locked): single tier-1 source ⇒ publish as "DEVELOPING, according to <outlet>" (trust
// model). DEATHS and high-sensitivity stories NEVER take the fast path — they exit here and the drip's
// multi-outlet corroboration owns them (hoax control).
// Env in: BREAK_URL, BREAK_TITLE, BREAK_CLS (S|A from the sentinel heuristic).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { categorize } from "./find/categorize.mjs";
import { loadPublished, slugKey } from "./find/store.mjs";
import { recentArticles, findDuplicate, entityDayCap } from "./lib/dupGuard.mjs";
import * as pace from "./lib/pacing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE = path.resolve(__dirname, "../data/find/queue.json");
const url = String(process.env.BREAK_URL || "").trim();
const title = String(process.env.BREAK_TITLE || "").trim();
const cls = process.env.BREAK_CLS === "S" ? "S" : "A";
const out = (kv) => { const f = process.env.GITHUB_OUTPUT; if (f) try { fs.appendFileSync(f, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"); } catch {} };
const bail = (reason) => { console.log(`[breaking] SKIP — ${reason}`); out({ published: 0, reason }); process.exit(0); };

if (!/^https:\/\//.test(url) || title.length < 15) bail("missing/invalid url or title");
const domain = (url.match(/^https:\/\/(?:www\.)?([^/]+)/) || [])[1] || "";
const outletName = { "variety.com": "Variety", "deadline.com": "Deadline", "hollywoodreporter.com": "The Hollywood Reporter", "thewrap.com": "TheWrap", "ew.com": "Entertainment Weekly", "tvline.com": "TVLine", "collider.com": "Collider", "indiewire.com": "IndieWire", "rollingstone.com": "Rolling Stone", "billboard.com": "Billboard", "people.com": "People", "pagesix.com": "Page Six", "usmagazine.com": "Us Weekly", "vulture.com": "Vulture" }[domain] || domain;

// DEATH / high-stakes refusal — the fast path NEVER publishes these (multi-outlet confirm policy owns them).
if (/\b(dies|dead at \d|death|passed away|obituar|found dead|suicide|overdose)\b/i.test(title)) bail("death-class story → left to the drip's multi-outlet corroboration");

// Already covered? (title ledger + cross-lane fuzzy dup + per-entity day cap)
const pub = loadPublished();
if (pub.titles.has(slugKey(title))) bail("already in the published ledger");

console.log(`[breaking] categorizing [${cls}] "${title.slice(0, 90)}" (${outletName})`);
const topics = await categorize(
  [{ kind: "news", title, url, outlet: outletName, sourceTier: 1, source: "breaking-sentinel", summary: "", ageMin: 0 }],
  { stage: (s, m) => console.log(`  [${s}] ${m}`) },
);
if (!topics.length) bail("categorize dropped it (off-scope / non-news form / no resolvable entity)");
const t = topics[0];
if (t.sensitivity === "high") bail("high-sensitivity → left to the drip's corroboration path");

const recent = recentArticles(168); // 7-day fuzzy window (2026-07-17 rehash fix), matching run.mjs
const dup = findDuplicate(t, recent);
if (dup) bail(`duplicate of published "${dup.slug}" (${dup.shared.slice(0, 4).join(", ")})`);
const cap = entityDayCap(t, recent);
if (cap) bail(`entity day-cap (${cap.count}/${cap.cap} in 24h)`);

// PACING GOVERNOR gate (Phase 4): breaking DEBITS the bucket first; only a Tier-S story may bypass an empty
// bucket, under the 4/hour + 12/day caps. PREVIEW here (no state mutation) — the spend commits only after the
// article actually publishes, so a gate-hold can never waste a token.
const paceState = pace.load();
pace.dayRoll(paceState);
pace.refill(paceState);
const gate = pace.breakingGate(paceState, cls);
if (!gate) bail(`pacing: bucket empty + Tier-S caps reached (day ${paceState.day.tierS}/${pace.CFG.TIER_S_DAY}) — left to the drip`);
console.log(`[breaking] pacing gate: ${gate.mode} (tokens ${paceState.bucket.tokens.toFixed(2)})`);

// Single tier-1 source ⇒ DEVELOPING, attributed (trust model). run.mjs injects this framing into the writer.
t.verification = { status: "DEVELOPING", publishable: true, framing: "attributed", attribution: outletName, outlets: [outletName], outletCount: 1, sensitivity: t.sensitivity || "normal" };
t.priority = cls === "S" ? 96 : 88; // hero-worthy trendScore; the drip's next FIND re-ranks everything after
t.breaking = true;

// Prepend to the queue (builtAt untouched — this is an insertion, not a rebuild) and hand off to the normal MAKE.
let q = { topics: [] };
try { q = JSON.parse(fs.readFileSync(QUEUE, "utf8")); } catch {}
q.topics = [t, ...(q.topics || []).filter((x) => x.id !== t.id)];
fs.writeFileSync(QUEUE, JSON.stringify(q, null, 2));
console.log(`[breaking] queued at #1 (${t.id}) → running MAKE…`);
const output = execFileSync("node", [path.resolve(__dirname, "run.mjs"), "--from-find", "--target=1"], {
  cwd: __dirname, env: { ...process.env, CONCURRENCY: "1" }, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024,
});
process.stdout.write(output);
const slugs = [...output.matchAll(/✓ WROTE (\S+?)\.md/g)].map((m) => m[1]);
if (slugs.length) {
  // Commit the governor spend + the day's stats ONLY for what actually published.
  pace.commitBreaking(paceState, gate);
  pace.save(paceState);
  const costM = output.match(/TOTAL: \$([\d.]+) across (\d+) calls/);
  pace.statsAppend({
    breaking: [{ at: new Date().toISOString(), cls, mode: gate.mode, slugs, outlet: outletName, costUsd: costM ? Number(costM[1]) : null }],
    published: slugs.length, costUsd: costM ? Number(costM[1]) : 0,
  });
}
out({ published: slugs.length, slugs: slugs.join(",") });
console.log(`[breaking] done — published ${slugs.length} (${slugs.join(", ") || "held by the gate"})`);
