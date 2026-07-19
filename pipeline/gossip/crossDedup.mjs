// GOSSIP — PRE-PUBLISH CROSS-DEDUP (fix #4). The gossip vec-store dedup only knows the gossip lane's own
// history; this guards against the SAME story going out twice by checking EVERY article in the shared
// content/articles dir published in the last 72h, matching on ENTITY + EVENT (fuzzy token overlap), NOT on
// eventSlug string equality (the twice-published-14h-apart dup slipped through because its slug differed).
// Read-only over content/articles — never writes; other lanes' files are only read.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const matter = require("gray-matter");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, "../../content/articles");

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// Light stemmer: the 2026-07-19 duplicate ("Settle Divorce" vs "Finalize Divorce") missed by ONE token
// because "finalize" and "finalized" were treated as different words. Collapse common inflections so a
// reworded headline about the same event still overlaps.
export const stem = (w) => {
  let x = String(w);
  x = x.replace(/(ization|isation)$/, "iz");
  x = x.replace(/(ings?|ed|es)$/, (m) => (x.length - m.length >= 4 ? "" : m));
  x = x.replace(/s$/, (m) => (x.length - 1 >= 4 ? "" : m));
  x = x.replace(/(iz|is)e?$/, "iz");
  x = x.replace(/e$/, (m) => (x.length - 1 >= 4 ? "" : m));
  return x;
};
export const tokens = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 3).map(stem));
export const normName = (s) => norm(s).replace(/\b(?:the|a|an)\b/g, " ").split(/\s+/).filter((w) => w.length > 1).join(" ").trim();
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; for (const t of a) if (b.has(t)) i++; return i / (a.size + b.size - i); };

// Index every published article from the last `windowH` hours: { slug, entity, event-tokens }.
export function loadRecentIndex({ dir = CONTENT_DIR, now = Date.now(), windowH = 72 } = {}) {
  const cutoff = now - windowH * 3600e3;
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { return out; }
  for (const f of files) {
    let data;
    try { ({ data } = matter(fs.readFileSync(path.join(dir, f), "utf8"))); } catch { continue; }
    const ts = Date.parse(data?.date || data?.dateModified || data?.provenance?.publishedAt || "");
    if (!ts || ts < cutoff) continue;
    const entity = data?.provenance?.primaryEntity || (Array.isArray(data?.tags) ? data.tags[0] : "") || "";
    out.push({
      slug: data?.slug || f.replace(/\.md$/, ""),
      entity: normName(entity),
      evt: tokens(`${data?.title || ""} ${data?.provenance?.claim || ""} ${data?.dek || ""}`),
    });
  }
  return out;
}

// Is `topic` a fuzzy dup of a recent article? Requires SAME entity AND overlapping EVENT — so "Taylor Swift
// wedding" and "Taylor Swift new album" (same entity, different event) are NOT flagged, but the same story
// re-discovered under a different headline IS. Returns the matched article, or null.
// Event nouns that define a story (stored STEMMED so they match tokens()).
const STRONG_EVENT = new Set(["divorc", "marri", "wed", "engag", "split", "breakup", "arrest", "charg", "lawsuit", "settl", "custodi", "pregnant", "baby", "birth", "dead", "death", "hospitaliz", "cancel", "reunit", "dating", "romanc", "affair", "expecting"].map(stem));

export function isCrossDup(topic, index, { now = Date.now(), entityThresh = 0.5, eventThresh = 0.45, minShared = 3 } = {}) {
  const te = normName(topic?.primaryEntity || "");
  const evt = tokens(`${topic?.title || ""} ${topic?.angle || ""} ${topic?.claim || ""}`);
  if (!te || evt.size < 3) return null;
  // The exclusion set must be STEMMED like evt is, otherwise the subject's OWN surname leaks through as
  // shared EVENT evidence ("Chris" stems to "chri", which evt contains) and a genuinely new story about
  // the same person is silently suppressed as a duplicate.
  const teTokens = new Set(te.split(" ").filter(Boolean).flatMap((w) => [w, stem(w)]));
  for (const a of index) {
    if (!a.entity || !a.evt.size) continue;
    const aTokens = new Set(a.entity.split(" ").filter(Boolean).flatMap((w) => [w, stem(w)]));
    const sameEntity = a.entity === te || jaccard(teTokens, aTokens) >= entityThresh;
    if (!sameEntity) continue;
    // SAME EVENT signal: ≥minShared shared CONTENT tokens beyond the entity (robust to filler/rewording), OR a
    // high overall token overlap. Same entity + same event ⇒ the same story under a different headline.
    const entTok = new Set([...teTokens, ...aTokens]);
    const sharedEvt = [...evt].filter((t) => a.evt.has(t) && !entTok.has(t)).length;
    // A single STRONG event word (divorce, arrest, death, engagement…) plus one other shared token means the
    // same happening — "Settle Divorce, Keep Baby Plans" vs "Finalize Divorce After Nearly a Decade".
    const strongShared = [...evt].filter((t) => a.evt.has(t) && !entTok.has(t) && STRONG_EVENT.has(t)).length;
    if (sharedEvt >= minShared || (strongShared >= 1 && sharedEvt >= 2) || jaccard(evt, a.evt) >= eventThresh) {
      return { slug: a.slug, entity: a.entity };
    }
  }
  return null;
}
