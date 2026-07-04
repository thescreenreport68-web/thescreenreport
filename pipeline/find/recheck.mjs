// DEATH/HOAX FOLLOW-UP + AUTO-RETRACTION (FIND_HALF_PLAN PENDING SUB-SYSTEM #2; MASTER_PLAN L966/L991).
// After a high-stakes breaking story publishes, keep re-checking it for ~48h. If it proves FALSE (hoax,
// premature/erroneous report, denial/retraction) → auto take-down or add a top correction. If a 2nd major
// outlet now confirms it → promote DEVELOPING→CONFIRMED and drop the hedge. Corrections go at the TOP with
// an updated dateModified (legal-safe per the republication rule).
//
// Runs as its own pass (will be scheduled by the 24/7 cloud runtime):
//   cd "/Users/sivajithcu/Movie News site" && set -a; . ./.env; set +a; node site/pipeline/find/recheck.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { discoverRSS } from "./sources/rss.mjs";
import { personDeathday } from "../lib/tmdb.mjs";
import { newMonitor, printRunReport } from "./store.mjs";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url)); // …/site/pipeline/find
const ART = path.resolve(__dirname, "../../content/articles");
const RETRACTED_DIR = path.resolve(__dirname, "../../data/find/retracted");
const DRY = process.argv.includes("--dry-run");
const RECHECK_WINDOW_H = 48; // follow a story for 48h after publish
const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";

// Contradiction / hoax signals in fresh headlines about the same subject.
const CONTRADICTION = /\b(hoax|death hoax|is alive|alive and well|still alive|did ?n'?t die|not dead|denies|denied|debunk|false report|fake news|prank|misreport|retract|correction|rumou?r false|never happened|dropped charges|charges dismissed|cleared of)\b/i;

const nowMs = () => Date.now();
const strip = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();

// Free, keyless Google News RSS search — recent coverage matching a query.
async function googleNews(query) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 20).map((m) => {
      const block = m[1];
      const title = strip((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
      const src = strip((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]);
      return { title, source: src };
    });
    return items;
  } catch {
    return [];
  }
}

// Load published breaking articles still inside the recheck window.
function loadWatched() {
  const out = [];
  for (const f of fs.readdirSync(ART).filter((x) => x.endsWith(".md"))) {
    const fp = path.join(ART, f);
    let parsed;
    try {
      parsed = matter(fs.readFileSync(fp, "utf8"));
    } catch {
      continue;
    }
    const p = parsed.data.provenance;
    if (!p || parsed.data.retracted) continue;
    const ageH = (nowMs() - Date.parse(p.publishedAt || parsed.data.date || 0)) / 3.6e6;
    if (isNaN(ageH) || ageH > RECHECK_WINDOW_H) continue;
    // Only follow stakes that can be wrong + harmful, or anything not yet fully confirmed.
    const watch = p.sensitivity === "high" || ["DEVELOPING", "RUMOR", "CONFIRMING"].includes(p.status);
    if (!watch) continue;
    out.push({ file: f, fp, fm: parsed.data, content: parsed.content, prov: p, ageH });
  }
  return out;
}

async function recheckOne(a, freshHeadlines, rec) {
  const ent = a.prov.primaryEntity;
  const evSet = (a.prov.eventSlug || "").split("-").filter((w) => w.length > 3 && w !== ent.toLowerCase());
  const evWords = evSet.slice(0, 4).join(" ");
  // an item corroborates THIS event only if it names the entity AND ≥1 event keyword (not just the
  // generally-popular entity) — prevents a famous name's unrelated coverage from false-promoting.
  const matchesEvent = (title) => {
    const t = (title || "").toLowerCase();
    return t.includes(ent.toLowerCase()) && (evSet.length === 0 || evSet.some((w) => t.includes(w)));
  };
  // 1) contradiction / hoax scan via Google News (entity + event)
  const news = await googleNews(`"${ent}" ${evWords}`);
  const contradiction = news.find((n) => CONTRADICTION.test(n.title) && n.title.toLowerCase().includes(ent.toLowerCase()));
  // 2) corroboration recount: distinct outlets now covering THIS EVENT in fresh feeds + news
  const newsOutlets = new Set(news.filter((n) => n.source && matchesEvent(n.title)).map((n) => n.source));
  const feedOutlets = new Set(freshHeadlines.filter((h) => matchesEvent(h.title)).map((h) => h.outlet));
  const majorNow = newsOutlets.size + feedOutlets.size;
  // 3) for deaths: TMDB authoritative confirmation — a person's `deathday` is populated only when a real
  //    death is confirmed (non-Wikipedia, time-unbounded). The Google-News contradiction scan above already
  //    catches hoax/denial coverage (also non-Wikimedia).
  let deathConfirmed = false;
  if (a.prov.eventType === "death") {
    deathConfirmed = !!(await personDeathday(ent));
  }
  rec.step("recheck", `${ent}: ${majorNow} outlet(s) now · contradiction=${contradiction ? "YES" : "no"} · tmdbDeath=${deathConfirmed}`);

  if (contradiction) return { action: "RETRACT", reason: `contradiction found: "${contradiction.title}"` };
  if (a.prov.eventType === "death" && deathConfirmed) return { action: "PROMOTE", reason: "TMDB now confirms the death" };
  if (majorNow >= 2 && a.prov.status === "DEVELOPING") return { action: "PROMOTE", reason: `${majorNow} outlets now corroborate` };
  if (a.prov.sensitivity === "high" && a.ageH > 24 && majorNow < 2) return { action: "REVIEW", reason: "high-sensitivity, still under-corroborated after 24h" };
  return { action: "HOLD", reason: "still developing, keep watching" };
}

// --- actions ---
function retract(a, reason, rec) {
  fs.mkdirSync(RETRACTED_DIR, { recursive: true });
  if (!DRY) {
    // takedown: move the md out of the live content dir (next build drops the page) + keep an audit copy
    fs.writeFileSync(path.join(RETRACTED_DIR, a.file.replace(/\.md$/, "") + `.retracted.json`), JSON.stringify({ slug: a.fm.slug, title: a.fm.title, reason, retractedAt: new Date().toISOString(), original: a.content.slice(0, 400) }, null, 2));
    fs.unlinkSync(a.fp);
  }
  rec.step("retract", `TAKEDOWN ${a.fm.slug} — ${reason}`);
  rec.done("retracted", { reason });
}
function correction(a, note, rec) {
  if (!DRY) {
    const fm = { ...a.fm, retracted: false, correction: note, dateModified: new Date().toISOString(), robots: "noindex" };
    const body = `> **Correction (${new Date().toISOString().slice(0, 10)}):** ${note}\n\n` + a.content.trim() + "\n";
    fs.writeFileSync(a.fp, matter.stringify(body, fm));
  }
  rec.step("correction", `CORRECTION added to ${a.fm.slug} — ${note}`);
  rec.done("corrected", { note });
}
function promote(a, reason, rec) {
  if (!DRY) {
    // 2026-07-03 FIX: only update the trust STATUS metadata (→ CONFIRMED) + dateModified. The old code rewrote
    // the BODY to strip the "According to <Outlet>" hedge, but its non-greedy regex `[\w. ]+?` ate "According to
    // Sc" and left "reenRant, ..." — it corrupted live articles (Supergirl, Star Wars) the moment the monitor was
    // wired into every FIND cycle. And stripping attribution is unnecessary: a news outlet KEEPS its sourcing even
    // once a story is corroborated ("according to Variety" is still true). So never touch the prose on promote.
    const fm = { ...a.fm, provenance: { ...a.prov, status: "CONFIRMED" }, storyStatus: "CONFIRMED", dateModified: new Date().toISOString() };
    fs.writeFileSync(a.fp, matter.stringify(a.content.trim() + "\n", fm));
  }
  rec.step("promote", `PROMOTED ${a.fm.slug} → CONFIRMED — ${reason}`);
  rec.done("promoted", { reason });
}

export async function runRecheck() {
  const runId = "recheck-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const monitor = newMonitor(runId);
  console.log(`\n=== RECHECK / AUTO-RETRACTION · ${runId}${DRY ? " (DRY)" : ""} ===`);
  const watched = loadWatched();
  monitor.stage("recheck", `${watched.length} published stories inside the ${RECHECK_WINDOW_H}h watch window`);
  if (!watched.length) {
    printRunReport(monitor.finish(0));
    return { watched: 0 };
  }
  const fresh = await discoverRSS({ maxPerFeed: 12, freshHours: 72 });
  for (const a of watched) {
    const rec = monitor.article({ id: a.fm.slug, slug: a.fm.slug, title: a.fm.title, category: a.fm.category, subcategory: a.fm.subcategory, formatTag: a.fm.formatTag });
    const { action, reason } = await recheckOne(a, fresh, rec);
    if (action === "RETRACT") (a.prov.eventType === "death" || a.prov.sensitivity === "high") ? retract(a, reason, rec) : correction(a, reason, rec);
    else if (action === "PROMOTE") promote(a, reason, rec);
    else rec.done(action.toLowerCase(), { reason });
  }
  printRunReport(monitor.finish(watched.length));
  return { watched: watched.length };
}
// Direct CLI invocation (`node site/pipeline/find/recheck.mjs [--dry-run]`) still runs the pass; importing the
// module (findrun.mjs wires it into every FIND cycle, 2026-07-03) does NOT auto-execute.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) runRecheck();
