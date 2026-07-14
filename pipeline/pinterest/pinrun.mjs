// PINRUN — the daily Pinterest orchestrator. Picks the latest un-pinned stories, makes N cards, and posts
// them to Pinterest spread across the day. Draft-safe by default (real posting needs --live). Idempotent
// per day (guard) + strict no-repeat (ledger). Fully self-contained; independent of the video lane.
//
// Flags:  --live         actually post (else DRAFTS that never publish)
//         --now          publish immediately, staggered (for a live test) instead of at slot times
//         --count=N      how many pins (default config PIN.dailyCount)
//         --slug=<slug>  force one article
//         --dry          plan only: print what it would pick/write, no render/post
//         --once-daily   skip if today's set was already scheduled (the daily cron passes this)
import fs from "node:fs";
import path from "node:path";
import { PIN } from "./config.mjs";
import { pickCandidates, readArticle } from "./curate.mjs";
import { makeCard } from "./makecard.mjs";
import { hostCard, pruneCards } from "./host.mjs";
import { postPin, pinStatus } from "./poster.mjs";
import { boardFor } from "./accounts.mjs";

// ── America/Los_Angeles wall-clock → exact UTC (handles PST/PDT)
function laOffsetMin(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime()) / 60000;
}
function laWall(y, m, d, h, min) { const naive = Date.UTC(y, m - 1, d, h, min); return new Date(naive - laOffsetMin(new Date(naive)) * 60000); }
function laToday() { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value])); return { y: +p.year, m: +p.month, d: +p.day }; }
// the ONE day we fill: today if before the 10am first slot, else tomorrow (never split across days)
function targetDay() {
  const { y, m, d } = laToday();
  const first = laWall(y, m, d, 10, 0);
  if (Date.now() < first.getTime() - 120000) return { y, m, d };
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(first.getTime() + 864e5)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}
function targetDateStr() { const t = targetDay(); return `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`; }
// N times evenly spread across 10:00–20:00 PT on the target day
function slotTimes(n) {
  const t = targetDay(); const START = 10, END = 20;
  return Array.from({ length: n }, (_, i) => {
    const hf = n <= 1 ? START : START + (i * (END - START)) / (n - 1);
    return laWall(t.y, t.m, t.d, Math.floor(hf), Math.round((hf % 1) * 60)).toISOString();
  });
}

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
function pinnedSet() { return new Set((readJson(PIN.ledger, [])).map((e) => e.slug)); }
function recordPinned(entry) { const l = readJson(PIN.ledger, []); l.push(entry); fs.mkdirSync(path.dirname(PIN.ledger), { recursive: true }); fs.writeFileSync(PIN.ledger, JSON.stringify(l, null, 2)); }

async function main() {
  const args = process.argv.slice(2);
  const draft = !args.includes("--live");
  const dry = args.includes("--dry");
  const immediate = args.includes("--now");
  const onceDaily = args.includes("--once-daily");
  const forceSlug = (args.find((a) => a.startsWith("--slug=")) || "").split("=")[1];
  const count = Number((args.find((a) => a.startsWith("--count=")) || "").split("=")[1]) || PIN.dailyCount;
  fs.mkdirSync(PIN.outDir, { recursive: true });

  if (fs.existsSync(PIN.stopFile)) { console.log("POSTING_OFF present — paused."); return; }
  // idempotency guard: one set per target day (blocks a duplicate same-day run)
  const guarded = onceDaily && !draft && !dry && !immediate && !forceSlug;
  if (guarded) {
    const st = readJson(PIN.stateFile, {});
    if (st.date === targetDateStr()) { console.log(`daily set for ${targetDateStr()} already scheduled — skipping.`); return; }
  }

  const pinned = forceSlug ? new Set() : pinnedSet();
  const candidates = forceSlug ? [{ slug: forceSlug, category: readArticle(forceSlug).category }] : pickCandidates(pinned);
  if (!candidates.length) { console.log("no fresh un-pinned candidates."); return; }

  const want = forceSlug ? 1 : count;
  const made = []; const catCount = {};
  const times = slotTimes(want);
  for (const c of candidates) {
    if (made.length >= want) break;
    if (pinned.has(c.slug)) continue;
    if (!forceSlug && (catCount[c.category] || 0) >= PIN.perCategoryCap) continue;
    pinned.add(c.slug);
    if (dry) { made.push({ slug: c.slug, category: c.category, dry: true }); console.log(`  [dry] ${c.category}  ${c.slug}`); catCount[c.category] = (catCount[c.category] || 0) + 1; continue; }
    try {
      const card = await makeCard(c.slug);
      const host = await hostCard(card.pngPath, c.slug);
      const i = made.length;
      const whenISO = immediate ? new Date(Date.now() + (i * 3 + 1) * 60000).toISOString() : times[i];
      const res = await postPin({ imageUrl: host.url, meta: card.meta, whenISO, draft, immediate });
      const entry = { slug: c.slug, category: c.category, at: new Date().toISOString(), draft: !!draft, whenISO, pinUrl: host.url, headline: card.card.headline.replace(/<br>/g, " "), title: card.meta.title, result: res };
      if (res.ok && !draft) recordPinned(entry);
      made.push(entry);
      catCount[c.category] = (catCount[c.category] || 0) + 1;
      console.log(`  ${draft ? "DRAFT" : immediate ? "LIVE-NOW" : whenISO.slice(11, 16) + "Z"}  [${c.category}] ${res.ok ? "ok " + res.id : "FAIL " + res.error}\n     “${entry.headline}”`);
    } catch (e) {
      console.log(`  skip ${c.slug}: ${String(e.message).slice(0, 90)} — trying next`);
    }
  }

  if (guarded && made.length) { try { fs.writeFileSync(PIN.stateFile, JSON.stringify({ date: targetDateStr(), count: made.length, at: new Date().toISOString() }, null, 2)); } catch {} }
  if (!draft && !dry) { try { const n = await pruneCards(21); if (n) console.log(`pruned ${n} old cards`); } catch {} }
  console.log(`\nDone. ${made.length} card(s) ${dry ? "planned" : draft ? "drafted" : "scheduled"}.`);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
