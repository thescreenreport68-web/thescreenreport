// sameStory.mjs — ONE STORY = ONE URL (owner standing policy, 2026-07-19).
//
// 🔴 THE POLICY: when this lane meets a DEVELOPMENT on a story it already published (same event +
// entities, within ~7 days), it must UPDATE the existing article in place — refresh the body/facts,
// stamp dateModified — instead of minting a second URL. New URLs are for genuinely NEW stories only.
//
// ── WHY THIS FILE IS DELIBERATELY STRICT ─────────────────────────────────────────────────────────
// dupGuard.findDuplicate() answers a CHEAP question: "should we skip this?" A false positive there
// costs one unpublished story. THIS file answers an EXPENSIVE question: "should we overwrite a live,
// indexed article?" A false positive here DESTROYS a good article and corrupts a ranking URL. The two
// thresholds must therefore be different, and this one must be much higher.
//
// Measured on the real corpus (93 news-lane articles, 7 days) the dup threshold of ≥3 shared stems
// produced these FALSE pairs — every one would have been a destructive overwrite:
//   · "Christopher Nolan's Oscar Odyssey…"  vs  "Travis Scott Teams With James Blake & Ludwig
//      Goransson…"            → shared {christopher, nolan, odyssey} because Göransson SCORED the film
//   · "Disney Drops New 'Moana' Trailer…"   vs  "Teyana Taylor, Nicole Kidman Lead Red Carpet Photos"
//   · "France Knights George Lucas…"        vs  "George Lucas Created 'Star Wars' After…"
// All three share CONTEXT, not SUBJECT+EVENT. Hence the rule below needs subject AND event AND beat.
//
// ── FAILURE DIRECTION ────────────────────────────────────────────────────────────────────────────
// When uncertain this returns null → the caller falls back to the existing dup-skip. Under-updating
// is the status quo (harmless); over-updating is destructive. Never relax this without new evidence.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART_DIR = path.resolve(__dirname, "../../content/articles");
const LEDGER = path.resolve(__dirname, "../../data/find/published.json");

const deburr = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
// Same generic set as dupGuard plus the words that carry no identity in an UPDATE decision.
const GENERIC = new Set(["movie", "movies", "film", "films", "series", "show", "shows", "season", "episode", "cast", "casting", "casts", "star", "stars", "starring", "news", "hollywood", "trailer", "teaser", "release", "premiere", "date", "director", "directs", "directing", "actor", "actress", "deal", "exclusive", "report", "reports", "first", "look", "sequel", "spinoff", "reboot", "remake", "joins", "join", "sets", "set", "adds", "returns", "return", "reveals", "confirms", "announces", "official", "watch", "video", "photos", "interview", "oscar", "winner", "winning", "dies", "dead", "death", "emmy", "grammy", "red", "carpet", "celebrity", "guide", "everything", "know", "explained", "breaks", "down", "netflix", "hbo", "max", "paramount", "disney", "warner", "bros", "universal", "sony", "amazon", "apple", "hulu", "peacock", "showtime", "the", "and", "for", "with", "new"]);
const stem = (w) => (w.length >= 5 ? w.replace(/(ies)$/, "y").replace(/(e?s|ed|ing)$/, "") : w);
export const stems = (s) => new Set(
  deburr(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
    .filter((w) => (w.length > 2 || /^\d+$/.test(w)) && !GENERIC.has(w)).map(stem)
    .filter((w) => w.length > 2 || /^\d+$/.test(w))
);
const overlap = (a, b) => [...a].filter((w) => b.has(w)).length;

// The set of slugs THIS lane published. Authoritative — the shared content/articles dir holds every
// lane's output, and we must NEVER rewrite another lane's file. Missing/corrupt ledger → empty set,
// which disables updating entirely (fail-safe: we publish a new URL rather than risk a wrong write).
export function myPublishedSlugs({ ledger = LEDGER } = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(ledger, "utf8"));
    const arr = Array.isArray(raw) ? raw : raw.records || raw.published || [];
    return new Set(arr.map((r) => r && r.slug).filter(Boolean));
  } catch { return new Set(); }
}

// Load MY articles from the last `hours`, with the fields the matcher needs.
export function myRecentArticles(hours = 168, { artDir = ART_DIR, now = Date.now(), mine } = {}) {
  const own = mine || myPublishedSlugs();
  const cut = now - hours * 3600_000;
  const out = [];
  let files = [];
  try { files = fs.readdirSync(artDir).filter((f) => f.endsWith(".md")); } catch { return out; }
  for (const f of files) {
    const slug = f.replace(/\.md$/, "");
    if (!own.has(slug)) continue;                       // not ours → never a candidate for rewrite
    try {
      const d = matter(fs.readFileSync(path.join(artDir, f), "utf8")).data || {};
      const at = Date.parse(d.date);
      if (!Number.isFinite(at) || at < cut) continue;
      out.push({
        slug: d.slug || slug,
        file: f,
        title: d.title || "",
        at,
        category: d.category || "",
        // the EXISTING hero — reused verbatim on an update (no re-sourcing cost, no art churn); also
        // keeps assemble() from dumping `image: undefined` when the update path skips the image ladder.
        image: d.image || null, imageWidth: d.imageWidth || null, imageHeight: d.imageHeight || null, imageCredit: d.imageCredit || null,
        eventType: String(d.eventType || "").toLowerCase() || null,
        // identity signals
        subject: stems([(d.about || [])[0]?.name, d.targetKeyword].filter(Boolean).join(" ")),
        eventWords: stems(String(d.eventSlug || "").replace(/-/g, " ")),
        eventSlug: String(d.eventSlug || ""),
        words: stems([d.title, (d.tags || []).join(" "), (d.about || []).map((e) => e?.name).join(" "), String(d.eventSlug || "").replace(/-/g, " ")].join(" ")),
      });
    } catch { /* unreadable → not evidence */ }
  }
  return out;
}

// ── THE MATCHER ─────────────────────────────────────────────────────────────────────────────────
// Returns { slug, confidence, why, shared } for a genuine development on an existing story, else null.
//
// A match requires ALL THREE of:
//   1. SAME BEAT    — eventType equal on both sides (a casting story never updates a box-office story).
//                     Missing eventType on either side ⇒ no update (fail-safe).
//   2. SAME SUBJECT — the WHO/WHAT the story is about must genuinely coincide, not merely co-occur.
//                     ratio ≥ 0.5 against the smaller subject set, ≥1 shared stem.
//   3. SAME EVENT   — either the eventSlug descriptors overlap (≥2 stems, ≥50% of the smaller set),
//                     or the overall signal overlap is near-total (≥5 shared stems).
// Plus an absolute floor of ≥4 shared stems overall.
export function findSameStory(topic, mine, { minShared = 4 } = {}) {
  const tType = String(topic?.eventType || "").toLowerCase() || null;
  if (!tType) return null;                                    // no declared beat → never update
  const tSubj = stems([topic?.primaryEntity, topic?.primaryKeyword].filter(Boolean).join(" "));
  if (!tSubj.size) return null;                               // no subject → never update
  const tEvent = stems(String(topic?.eventSlug || "").replace(/-/g, " "));
  const tWords = stems([topic?.title, topic?.primaryEntity, topic?.primaryKeyword, (topic?.entities || []).join(" "), String(topic?.eventSlug || "").replace(/-/g, " ")].join(" "));

  let best = null;
  for (const a of mine) {
    if (!a.eventType || a.eventType !== tType) continue;       // 1. same beat
    if (!a.subject.size) continue;

    // 2. same subject — coincidence, not co-occurrence
    const subjShared = overlap(tSubj, a.subject);
    if (subjShared < 1) continue;
    const subjRatio = subjShared / Math.min(tSubj.size, a.subject.size);
    if (subjRatio < 0.5) continue;

    // absolute floor
    const shared = [...tWords].filter((w) => a.words.has(w));
    if (shared.length < minShared) continue;

    // 3. same event
    const evShared = overlap(tEvent, a.eventWords);
    const evRatio = tEvent.size && a.eventWords.size ? evShared / Math.min(tEvent.size, a.eventWords.size) : 0;
    const exact = a.eventSlug && topic?.eventSlug && a.eventSlug === topic.eventSlug;
    const eventMatch = exact || (evShared >= 2 && evRatio >= 0.5) || shared.length >= 5;
    if (!eventMatch) continue;

    const confidence = exact ? "exact-event" : evShared >= 2 && evRatio >= 0.5 ? "event-overlap" : "near-total-overlap";
    const score = (exact ? 100 : 0) + evShared * 10 + shared.length + subjRatio * 5;
    if (!best || score > best.score) {
      best = {
        slug: a.slug, file: a.file, title: a.title, category: a.category, at: a.at, score, confidence,
        image: a.image, imageWidth: a.imageWidth, imageHeight: a.imageHeight, imageCredit: a.imageCredit,
        shared,
        why: `beat=${tType} · subject ${subjShared}/${Math.min(tSubj.size, a.subject.size)} (${subjRatio.toFixed(2)}) · event ${evShared} · shared ${shared.length} · ${exact ? "same eventSlug" : "fuzzy"}`,
      };
    }
  }
  return best;
}
