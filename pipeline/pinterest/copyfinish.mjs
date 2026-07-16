// copyfinish.mjs — deterministic pin-copy finishers (external audit, 2026-07-16). Ports the news lane's
// seoFinish root-cause pattern to the Pinterest lane. Five guarantees, all deterministic (no LLM):
//   1. `noMd` no longer strips '#' — the old sanitizer turned "#MovieNews" into the bare CamelCase blob
//      "MovieNews" on every live pin AND corrupted facts ("ranked #7" → "ranked 7"). Markdown chars only.
//   2. Hashtags are handled as DATA, not prose: validated (#[A-Za-z]…), deduped, capped at 3 (Pinterest gives
//      hashtags ~no ranking weight post-2020 — characters are better spent on natural keyword sentences),
//      and each entity-bearing tag must actually match the article text or it's dropped. 0 tags is fine.
//   3. FACT/ENTITY verification: every year, number, and proper-noun token in the title+description must
//      appear in the source article (deburred) — catches "Venice Film Festival 2024" (article says 2026)
//      and the "Emyys" typo class. Caller regenerates on mismatch, then falls back to article-derived copy.
//   4. NO ellipsis-truncated copy: titles finish via the shared finishMetaTitle (complete clause or verbatim,
//      never "…"); descriptions end on a complete sentence.
//   5. CTA rotation: deterministic per-slug style pick so the lane has no template fingerprint.
import { finishMetaTitle } from "../lib/seoFinish.mjs";

// ── 1. markdown-only sanitizer ('#' preserved — it's meaningful in "#7" and "#MovieNews") ───────
export const noMd = (s) => String(s || "").replace(/[*_`~]+/g, "").replace(/\s{2,}/g, " ").trim();

const deburr = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
const norm = (s) => " " + deburr(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";

// the article's full searchable haystack (title + dek + body + takeaways), normalized
export function articleHay(a) {
  const txt = [a?.title, a?.dek, a?.whatWeKnow, ...(a?.keyTakeaways || []), a?.body].filter(Boolean).join(" ");
  const h = norm(txt);
  return { hay: h, squash: h.replace(/ /g, "") };
}

// ── 3. fact/entity verification ─────────────────────────────────────────────────────────────────
// Copy-side words that are legitimately Capitalized without being article entities (CTA/glue words).
const COPY_GLUE = new Set(["the", "this", "that", "these", "those", "a", "an", "and", "but", "for", "with", "from", "after", "before", "into", "over", "under", "his", "her", "their", "its", "our", "your", "discover", "however", "meanwhile", "plus", "get", "read", "see", "watch", "learn", "find", "tap", "click", "here", "heres", "what", "why", "how", "when", "where", "who", "which", "full", "more", "everything", "details", "story", "stories", "news", "update", "updates", "latest", "breaking", "explore", "uncover", "inside", "now", "new", "screen", "report", "hollywood", "fans", "fan", "everyone", "internet", "online", "season", "episode", "series", "movie", "film", "show", "cast", "trailer", "release", "date", "box", "office", "streaming", "top"]);

// years, standalone numbers (incl. #N / $N / N.NM), and Capitalized tokens in `text` that the article
// never states → returned in `missing`. Hashtag blocks are checked separately (hashtagOk) — strip them first.
export function factCheck(article, text) {
  const { hay } = articleHay(article);
  const t = String(text || "").replace(/#[A-Za-z][\w]*\b/g, " "); // hashtags are validated separately
  const missing = [];
  for (const y of t.match(/\b(?:19|20)\d{2}\b/g) || []) {
    if (!hay.includes(" " + y + " ")) missing.push(y);
  }
  for (const m of t.match(/(?<![A-Za-z\d])[#$]?\d[\d,]*(?:\.\d+)?/g) || []) {
    const n = m.replace(/[#$,]/g, "");
    if (/^(?:19|20)\d{2}$/.test(n)) continue; // years handled above
    // normalize like the haystack does: "." becomes a space ("9.4" → "9 4"), so both sides agree
    if (!hay.includes(" " + n.replace(/\./g, " ") + " ")) missing.push(m);
  }
  for (const w of deburr(t).match(/\b[A-Z][a-zA-Z'’-]{3,}\b/g) || []) {
    // normalize the token exactly like the haystack: possessive dropped, hyphens→spaces, deburred
    // ("Taylor-Joy" → "taylor joy", "Gunn's" → "gunn", "Maridueña" → "mariduena")
    const k = norm(w.replace(/['’]s$/, "")).trim();
    if (!k || COPY_GLUE.has(k.replace(/ /g, ""))) continue;
    if (!hay.includes(" " + k + " ")) missing.push(w);
  }
  return { ok: missing.length === 0, missing: [...new Set(missing)] };
}

// ── 2. hashtags as data ──────────────────────────────────────────────────────────────────────────
const GENERIC_TAGS = new Set(["movienews", "tvnews", "celebritynews", "entertainmentnews", "hollywood", "boxoffice", "nowstreaming", "filmnews", "newmovies", "tvshows"]);
export function cleanHashtags(tags, article, max = 3) {
  const { squash } = articleHay(article);
  const out = [];
  for (const raw of tags || []) {
    const t = String(raw || "").trim();
    if (!/^#[A-Za-z][A-Za-z0-9]*$/.test(t)) continue;              // malformed → drop
    const k = deburr(t.slice(1)).toLowerCase();
    if (!GENERIC_TAGS.has(k) && !squash.includes(k)) continue;     // entity tag the article never states → drop
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// ── 4a. description: whole sentences only, never "…" ────────────────────────────────────────────
const sentSplit = (s) => String(s || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
export function completeSentences(text, max = 400) {
  let acc = "";
  for (const s of sentSplit(noMd(text))) {
    const t = acc ? acc + " " + s : s;
    if (t.length > max) break;
    acc = t;
  }
  if (!acc) { // single overlong sentence: cut at the last clause boundary, close it as a sentence
    const cut = noMd(text).slice(0, max);
    const at = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; "), cut.lastIndexOf(" — "));
    acc = (at > max * 0.4 ? cut.slice(0, at) : cut.replace(/\s+\S*$/, "")).trim();
  }
  acc = acc.replace(/[\s,;:…-]+$/, "");
  if (acc && !/[.!?]$/.test(acc)) acc += ".";
  return acc;
}

// ── 4b. title: complete searchable phrase, never truncated ──────────────────────────────────────
// Pinterest shows ~40 title chars in-feed → the searchable entity+topic must live in the first ~45.
// finishMetaTitle (shared lib) guarantees a clean complete clause or the verbatim title — never "…".
// Its degenerate-input last resort can still blind-cut, so we tail-trim any dangling function word
// ("…The Hunt for", "…Lineup with Margot") and fall back to the article's own title if too little remains.
const TAIL_FRAG = /\s+(a|an|and|as|at|but|by|for|from|in|into|is|of|on|or|the|their|this|to|with|without|how|why|when|where|who|made|it|its|his|her|says|joins|gets|sets|new)$/i;
const NAME_CUE = /\b(?:with|and|casts?|stars?|joins?|featuring|feat\.?)\s+([A-Z][\w'’.-]*)$/;
// "…with Margot" is a fragment only if the article's title shows the surname that got cut ("Margot Robbie")
const cutName = (t, full) => {
  const m = t.match(NAME_CUE);
  return !!m && new RegExp("\\b" + m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+[A-Z]").test(String(full || ""));
};
export function finishPinTitle({ model, article, max = 70 } = {}) {
  const full = noMd(article?.title || "");
  let t = finishMetaTitle({ model: noMd(model), title: full, min: 38, max, cutMax: 85, hardMax: 95 })
    .replace(/…+$/g, "").replace(/[\s,;:-]+$/, "");
  while (TAIL_FRAG.test(t) || cutName(t, full)) t = t.replace(TAIL_FRAG, "").replace(NAME_CUE, "").replace(/[\s,;:-]+$/, "");
  if (t.length < 30) { // trimmed to nothing usable → the article's own headline, whole words, no ellipsis
    t = full.slice(0, 95).replace(/\s+\S*$/, "").replace(/[\s,;:-]+$/, "");
    while (TAIL_FRAG.test(t)) t = t.replace(TAIL_FRAG, "").replace(/[\s,;:-]+$/, "");
  }
  return t;
}
// does the first ~45 chars carry at least one significant article-title word? (front-load check)
export function frontLoaded(title, article) {
  const head = norm(String(title).slice(0, 45));
  const sig = norm(article?.title || "").split(" ").filter((w) => w.length > 3 && !COPY_GLUE.has(w));
  return sig.some((w) => head.includes(" " + w + " "));
}

// ── 5. CTA rotation (deterministic by slug — no template fingerprint, replayable in CI) ─────────
export const CTA_STYLES = [
  "Tap through for the full story on The Screen Report.",
  "Get the full breakdown, from casting to release plans.",
  "Read everything we know so far.",
  "See the full story and how fans are reacting.",
  "Here's the complete rundown.",
];
export function ctaFor(slug) {
  let h = 0;
  for (const c of String(slug || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CTA_STYLES[h % CTA_STYLES.length];
}
