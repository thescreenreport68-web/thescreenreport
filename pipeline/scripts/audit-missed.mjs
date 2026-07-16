// MISSED-STORY AUDIT (NEWS_REALTIME_SCALE_PLAN Phase 4) — "we cannot miss a story" made measurable.
// Once a day (scheduler fires it on LA-date rollover) this compares the last 24h of the trades' own Google-News
// sitemaps (per-second timestamps, free, keyless — the research-verified velocity source) against what WE
// published or queued. In-scope trade stories with zero fuzzy match = misses → written to the day's stats file.
// Read-only against the web; writes only data/find/stats/<date>.json. Usage: node scripts/audit-missed.mjs [date]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { statsAppend, laDate } from "../lib/pacing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.resolve(__dirname, "../../content/articles");
const QUEUE = path.resolve(__dirname, "../../data/find/queue.json");

const SITEMAPS = [
  ["Variety", "https://variety.com/news-sitemap.xml"],
  ["THR", "https://www.hollywoodreporter.com/news-sitemap.xml"],
  ["ScreenRant", "https://screenrant.com/post_google_news.xml"],
];
// Out of the NEWS lane's scope (other lanes / other verticals) — a "miss" must be a story WE should have run.
const OFF_SCOPE = /\bbox[- ]?office\b|where to (watch|stream)|now streaming|\banime\b|\bmanga\b|video ?game|\bgaming\b|bollywood|\brecap\b|\breview\b|\branked\b|\bexplained\b|\btheory\b|\bquiz\b|gift guide|deals?\b|shopping/i;

const STOP = new Set(["the", "a", "an", "and", "of", "in", "on", "for", "with", "to", "at", "by", "from", "is", "are", "was", "how", "why", "what", "his", "her", "their", "new", "after", "before", "as", "s"]);
const stems = (s) => new Set(String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
  .map((w) => (w.length >= 5 ? w.replace(/(ies)$/, "y").replace(/(e?s|ed|ing)$/, "") : w)));

async function fetchTitles(name, url, sinceMs) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { name, error: `HTTP ${r.status}`, items: [] };
    const xml = await r.text();
    const items = [];
    for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const b = m[1];
      const title = ((b.match(/<news:title>([\s\S]*?)<\/news:title>/) || [])[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      const pub = Date.parse(((b.match(/<news:publication_date>([\s\S]*?)<\/news:publication_date>/) || [])[1] || "").trim());
      if (title && Number.isFinite(pub) && pub >= sinceMs) items.push({ outlet: name, title, pub });
    }
    return { name, items };
  } catch (e) { return { name, error: String(e?.message || e).slice(0, 80), items: [] }; }
}

const dateArg = process.argv[2] || laDate();
const now = Date.now();
const since = now - 24 * 3600e3;

// OUR coverage universe = published articles (48h) + everything currently queued (a queued story is "seen").
const ours = [];
for (const f of fs.readdirSync(ART).filter((x) => x.endsWith(".md"))) {
  try {
    const head = fs.readFileSync(path.join(ART, f), "utf8").slice(0, 2000);
    const dm = head.match(/^date:\s*'?([^'\n]+)'?/m);
    if (dm && now - Date.parse(dm[1]) <= 48 * 3600e3) {
      const t = (head.match(/^title:\s*(?:>-\n\s*)?(.+)/m) || [])[1] || f;
      ours.push(stems(t + " " + f));
    }
  } catch { /* skip unreadable */ }
}
try { for (const t of JSON.parse(fs.readFileSync(QUEUE, "utf8")).topics || []) ours.push(stems(`${t.title} ${t.primaryEntity || ""} ${t.eventSlug || ""}`)); } catch { /* no queue */ }

const results = await Promise.all(SITEMAPS.map(([n, u]) => fetchTitles(n, u, since)));
const feedErrors = results.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`);
const tradeItems = results.flatMap((r) => r.items).filter((it) => !OFF_SCOPE.test(it.title));

const misses = [];
let covered = 0;
for (const it of tradeItems) {
  const ts = stems(it.title);
  const hit = ours.some((o) => { let sh = 0; for (const w of ts) if (o.has(w)) sh++; return sh >= 3 || (sh >= 2 && ts.size <= 4); });
  if (hit) covered++;
  else misses.push({ outlet: it.outlet, title: it.title.slice(0, 110) });
}
const pct = tradeItems.length ? Math.round((covered / tradeItems.length) * 100) : null;
statsAppend({
  audit: { at: new Date(now).toISOString(), tradeStories24h: tradeItems.length, covered, coveragePct: pct, feedErrors, misses: misses.slice(0, 30) },
}, dateArg);
console.log(`[audit-missed] ${dateArg}: ${covered}/${tradeItems.length} in-scope trade stories covered (${pct ?? "n/a"}%)` +
  (feedErrors.length ? ` · feed errors: ${feedErrors.join("; ")}` : "") +
  (misses.length ? `\n  top misses: ${misses.slice(0, 6).map((m) => `[${m.outlet}] ${m.title.slice(0, 60)}`).join(" | ")}` : ""));
