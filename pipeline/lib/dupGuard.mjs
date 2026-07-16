// dupGuard.mjs — NEWS-lane cross-lane duplicate-story guard (owner root-cause directive 2026-07-16).
// The published-ledger dedup (find/store.mjs) only sees what THIS lane published, and only compares
// slugKey/eventSlug/entityKey string equality — so the same story covered by another lane (inside ran
// Batman-delayed-to-2028 twice in 2h) or re-angled with a different headline slips through. This guard
// reads the SHARED content/articles dir (read-only — every lane publishes there) for the last 72h and
// fuzzy-matches the candidate topic's entities+event words against each recent article. Match = skip.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART_DIR = path.resolve(__dirname, "../../content/articles");

const deburr = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
// Words that appear in half of all entertainment headlines — shared occurrences of these prove nothing.
const GENERIC = new Set(["movie", "movies", "film", "films", "series", "show", "shows", "season", "episode", "cast", "casting", "casts", "star", "stars", "starring", "news", "hollywood", "trailer", "teaser", "release", "premiere", "date", "director", "directs", "directing", "actor", "actress", "deal", "exclusive", "report", "reports", "first", "look", "sequel", "spinoff", "reboot", "remake", "joins", "join", "sets", "set", "adds", "returns", "return", "reveals", "confirms", "announces", "official", "watch", "video", "photos", "interview", "netflix", "hbo", "max", "paramount", "disney", "warner", "bros", "universal", "sony", "amazon", "apple", "hulu", "peacock", "showtime", "the", "and", "for", "with", "new"]);
const stem = (w) => (w.length >= 5 ? w.replace(/(ies)$/, "y").replace(/(e?s|ed|ing)$/, "") : w);
const sigStems = (s) => new Set(
  deburr(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
    .filter((w) => (w.length > 2 || /^\d+$/.test(w)) && !GENERIC.has(w)).map(stem).filter((w) => w.length > 2 || /^\d+$/.test(w))
);

// Read every article published in the shared dir within `hours`. Returns lightweight records only.
export function recentArticles(hours = 72, { artDir = ART_DIR, now = Date.now() } = {}) {
  const cut = now - hours * 3600_000;
  const out = [];
  let files = [];
  try { files = fs.readdirSync(artDir).filter((f) => f.endsWith(".md")); } catch { return out; }
  for (const f of files) {
    try {
      const d = matter(fs.readFileSync(path.join(artDir, f), "utf8")).data || {};
      const at = Date.parse(d.date);
      if (!Number.isFinite(at) || at < cut) continue;
      const words = sigStems([d.title, (d.tags || []).join(" "), (d.about || []).map((e) => e?.name).join(" "), String(d.eventSlug || "").replace(/-/g, " ")].join(" "));
      out.push({ slug: d.slug || f.replace(/\.md$/, ""), title: d.title || "", words });
    } catch { /* unreadable file → not evidence of anything */ }
  }
  return out;
}

// A candidate topic duplicates a recent article when they share ≥3 non-generic word stems
// (entity names + event words: {batman, 2028, delay} / {mariduena, blue, beetle, superman}).
// ≥3 (not 2) so two DIFFERENT stories about the same person 72h apart survive ({margot, robbie}).
export function findDuplicate(topic, recent) {
  const words = sigStems([topic?.title, topic?.primaryEntity, topic?.primaryKeyword, (topic?.entities || []).join(" "), String(topic?.eventSlug || "").replace(/-/g, " ")].join(" "));
  for (const a of recent) {
    const shared = [...words].filter((w) => a.words.has(w));
    if (shared.length >= 3) return { slug: a.slug, title: a.title, shared };
  }
  return null;
}
