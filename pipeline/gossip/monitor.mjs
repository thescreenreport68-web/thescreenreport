// GOSSIP — MONITOR & AUTO-RETRACT (Stage 8). The post-publish "backup AI": for every published gossip story
// still inside the watch window, recheck the open web. If it's been DENIED/DEBUNKED → take it down (high
// severity) or add a top correction (lower). If a major outlet now CONFIRMS it → drop the hedge. Patterned on
// the news pipeline's find/recheck.mjs. fetchImpl injectable for offline tests.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, "../../content/articles");
const RETRACTED_DIR = path.resolve(__dirname, "../../data/gossip/retracted");
const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";
const WINDOW_H = 48;

const CONTRADICTION = /\b(hoax|death hoax|is alive|still alive|did ?n'?t die|not dead|denies|denied|debunk\w*|false report|fake news|misreport|retract\w*|correction|rumou?r (is )?false|never happened|dropped (the )?charges|charges (dismissed|dropped)|cleared of|no truth to|shuts? down (the )?rumou?r|sets? the record straight)\b/i;
const strip = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();

async function defaultGoogleNews(query) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 20).map((m) => ({
      title: strip((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1]),
      source: strip((m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]),
    }));
  } catch {
    return [];
  }
}

function loadWatched(dir, nowMs) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const fp = path.join(dir, f);
    let parsed;
    try { parsed = matter(fs.readFileSync(fp, "utf8")); } catch { continue; }
    const d = parsed.data;
    if (d.formatTag !== "gossip" || d.retracted) continue;
    const p = d.provenance;
    if (!p || !p.monitor) continue;
    const ageH = (nowMs - Date.parse(p.publishedAt || d.date || 0)) / 3.6e6;
    if (isNaN(ageH) || ageH > WINDOW_H) continue;
    out.push({ file: f, fp, fm: d, content: parsed.content, prov: p, ageH });
  }
  return out;
}

// Decide what to do with one watched story given fresh coverage.
export function decide(prov, news) {
  const ent = (prov.primaryEntity || "").toLowerCase();
  const namesEntity = (t) => ent && (t || "").toLowerCase().includes(ent);
  const contradiction = news.find((n) => namesEntity(n.title) && CONTRADICTION.test(n.title));
  if (contradiction) return { action: "RETRACT", reason: `contradiction/denial found: "${contradiction.title}"` };
  const corroborating = new Set(news.filter((n) => namesEntity(n.title)).map((n) => n.source).filter(Boolean));
  if (corroborating.size >= 2 && prov.status !== "CONFIRMED") return { action: "PROMOTE", reason: `${corroborating.size} outlets now corroborate` };
  return { action: "HOLD", reason: "still developing — keep watching" };
}

function retract(a, reason, dryRun) {
  if (!dryRun) {
    fs.mkdirSync(RETRACTED_DIR, { recursive: true });
    fs.writeFileSync(path.join(RETRACTED_DIR, a.file.replace(/\.md$/, "") + ".retracted.json"),
      JSON.stringify({ slug: a.fm.slug, title: a.fm.title, reason, retractedAt: new Date().toISOString() }, null, 2));
    fs.unlinkSync(a.fp); // next build drops the page
  }
  return { slug: a.fm.slug, action: "RETRACT", reason };
}
function correction(a, note, dryRun) {
  if (!dryRun) {
    const fm = { ...a.fm, correction: note, dateModified: new Date().toISOString(), robots: "noindex" };
    const body = `> **Correction (${new Date().toISOString().slice(0, 10)}):** ${note}\n\n` + a.content.trim() + "\n";
    fs.writeFileSync(a.fp, matter.stringify(body, fm));
  }
  return { slug: a.fm.slug, action: "CORRECTION", reason: note };
}

export async function monitorGossip({ fetchNews = defaultGoogleNews, dir = CONTENT_DIR, dryRun = false, nowMs } = {}) {
  const now = nowMs ?? Date.now();
  const watched = loadWatched(dir, now);
  const results = [];
  for (const a of watched) {
    const ev = (a.prov.claim || a.prov.primaryEntity || "").split(/\s+/).slice(0, 5).join(" ");
    const news = await fetchNews(`"${a.prov.primaryEntity}" ${ev}`);
    const { action, reason } = decide(a.prov, news);
    if (action === "RETRACT") {
      // high-severity → full takedown; otherwise a top correction (less drastic).
      results.push((a.prov.sensitivity === "high" ? retract : correction)(a, reason, dryRun));
    } else {
      results.push({ slug: a.fm.slug, action, reason });
    }
  }
  return { watched: watched.length, results };
}
