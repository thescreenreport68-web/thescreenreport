// Internal-link builder (PIPELINE_SYSTEM support-system #1 "entity-hub / internal-linking builder").
// Inserts 2-4 REAL, contextual, TONE-SAFE in-body links from a new article to EXISTING published
// articles, and strips dangling "see our feature" phantom phrases that point nowhere.
//
// OWNER RULE (PROJECT_STATUS K2): links must match on shared ENTITY *and* be TONE-compatible — a
// somber story (death/funeral/lawsuit) must NEVER link to a frivolous one (e.g. "bought a sports car"),
// and vice-versa. We classify each article's tone and refuse to cross sensitive<->normal.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url)); // …/site/pipeline/lib
const ART = path.resolve(__dirname, "../../content/articles");

// NEWS-ONLY (owner 2026-07-01): this automation is a hardcore-news strip. NEVER link a news article to a
// REMOVED-form page (ranking/list/review/profile/interview/explainer/guide/where-to-watch) — those are legacy
// demo content being phased out, so a link to one is off-brand today and a dead link the day it's deleted.
// We exclude them from BOTH the link index (here) and assemble's valid-path set.
const REMOVED_SUBCATS = new Set(["movie-reviews", "tv-reviews", "profiles-careers", "interviews", "rankings-lists", "explainers", "predictions", "best-of-streaming", "where-to-watch", "profiles-artists", "screen-music"]);
const REMOVED_FORMS = new Set(["review", "recap", "ranking", "list", "explainer", "profile", "predictions", "guide", "interview", "music-profile", "music-review", "screen-music"]);
export const isRemovedForm = (data) => REMOVED_SUBCATS.has(data.subcategory) || REMOVED_FORMS.has(data.formatTag);

// Tone gate — sensitive = death/legal/tragedy/health; everything else = normal.
const SENSITIVE = /\b(dead|dies|died|death|funeral|killed|obituar|passed away|passes away|arrest|charged|indict|lawsuit|sued|felony|assault|abus|alleg|hospitaliz|critical condition|overdose|suicide|cancer|terminal|illness|tragedy|tragic|murder|custody battle|restraining order)/i;
export const toneOf = (text) => (SENSITIVE.test(text || "") ? "sensitive" : "normal");

// Tags that are too GENERIC to be a safe link anchor (would link random unrelated articles).
const GENERIC = new Set([
  "news", "movies", "movie", "tv", "television", "streaming", "celebrity", "reviews", "review", "awards",
  "box office", "trailer", "trailers", "interview", "interviews", "reaction", "reactions", "ranking",
  "rankings", "ranked", "list", "best", "explainer", "explained", "guide", "where to watch", "profile",
  "animated series", "biopic", "sequel", "prequel", "film", "series", "show", "actor", "actress", "director",
  "hollywood", "netflix", "hbo", "max", "disney", "prime video", "apple tv", "studio", "gothic soap opera",
  // generic production/story nouns that must NEVER be link anchors (the "production"->wrong-article bug)
  "production", "budget", "release", "premiere", "cast", "writer", "producer", "episode", "season",
  "teaser", "footage", "scene", "character", "role", "franchise", "universe", "reboot", "remake",
  "adaptation", "cinema", "story", "plot", "ending", "weekend", "opening", "debut", "career", "music",
  "performance", "drama", "comedy", "thriller", "horror", "documentary", "cameo", "spinoff", "spin-off",
]);

// OUTLETS + PLATFORMS (root-fix 2026-07-17): a publication or streaming-platform name must NEVER be a link
// anchor — the live "[Billboard](/music/clave-especial-…)" fake-attribution bug happened because one article
// carried "billboard" as a TAG, which made the outlet name an anchor that hijacked "According to Billboard"
// in every later article. Attribution text stays plain text, always.
const OUTLETS_PLATFORMS = /^(billboard( 200)?|hot 100|variety|deadline|(the )?hollywood reporter|thr|rolling stone|people|tmz|page six|ew|entertainment weekly|collider|indiewire|vulture|screenrant|the wrap|thewrap|aol|just jared|usa today|cnn|bbc|the guardian|(the )?new york times|nyt|los angeles times|ap|reuters|netflix|hulu|max|hbo( max)?|disney\+?|disney plus|peacock|paramount\+?|apple tv\+?|prime video|amazon( prime)?|starz|showtime|youtube|instagram|tiktok|twitter|x|facebook|spotify|the cw|fx|abc|nbc|cbs|fox)$/i;
// An anchor must be the TARGET article's PRIMARY identity (its first tags / targetKeyword) — never an
// incidental tag (root-fix 2026-07-17: "[Adam Sandler]" linked to a Taylor Swift wedding article because
// Sandler was a guest-list tag there). And never an outlet, platform, or "season N".
export const isBadAnchor = (term) => {
  const low = String(term).trim().toLowerCase();
  return low.length < 4 || GENERIC.has(low) || OUTLETS_PLATFORMS.test(low) || /^season \d+$/.test(low) || /^\d+$/.test(low);
};
function anchorTerms(title, tags, targetKeyword) {
  const out = new Set();
  const primary = [targetKeyword, ...tags.slice(0, 2)].filter(Boolean);
  for (const t of primary) {
    const term = String(t).trim();
    if (isBadAnchor(term)) continue;
    if (term.includes(" ") || term.length >= 5) out.add(term); // multi-word, or a real single-word name
  }
  return [...out];
}

// True only if `term` appears in `body` as a PROPER NOUN (capitalized first letter) — proper nouns
// (Zendaya, Christopher Nolan, Oppenheimer) qualify; a common-noun mention ("production budget") does not.
// FIX-3: a capital at the START of a sentence is NOT proof of a proper noun ("Best films..." opens a
// sentence but "Best" is not an entity). So we PREFER a mid-sentence capitalized occurrence; we accept a
// sentence-initial one only for a MULTI-WORD term (e.g. "Christopher Nolan"), never a single common word.
function properNounAt(body, term) {
  const re = new RegExp(`\\b${escapeRe(term)}\\b`, "gi"); // match case-insensitively…
  const multiWord = /\s/.test(term);
  let m, fallback = -1;
  while ((m = re.exec(body))) {
    if (!/[A-Z]/.test(body[m.index])) continue; // …only a Capitalized (proper-noun) occurrence
    const pre = body.slice(0, m.index).replace(/["'’)\]\s]+$/, ""); // ignore trailing quotes/brackets/space
    const sentenceInitial = pre === "" || /[.!?:\n]$/.test(pre);
    if (!sentenceInitial) return m.index; // mid-sentence capital = a solid proper noun
    if (multiWord && fallback < 0) fallback = m.index; // multi-word name is OK even sentence-initial
  }
  return fallback; // only sentence-initial occurrences existed → accept iff multi-word, else -1
}

// Build an index of EXISTING published articles (excluding the one being written).
export function buildLinkIndex(excludeSlug) {
  const idx = [];
  for (const f of fs.readdirSync(ART).filter((x) => x.endsWith(".md"))) {
    let data, content;
    try {
      ({ data, content } = matter(fs.readFileSync(path.join(ART, f), "utf8")));
    } catch {
      continue;
    }
    const slug = data.slug || f.replace(/\.md$/, "");
    if (!data.category || slug === excludeSlug) continue;
    if (isRemovedForm(data)) continue; // news-only: never link to a legacy ranking/review/profile page
    const tags = (data.tags || []).map((t) => String(t));
    idx.push({
      slug,
      title: data.title || "",
      category: data.category,
      tags,
      tone: toneOf(`${data.title} ${tags.join(" ")} ${(content || "").slice(0, 700)}`),
      anchors: anchorTerms(data.title, tags, data.targetKeyword),
    });
  }
  return idx;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bodyHas = (body, term) => new RegExp(`\\b${escapeRe(term)}\\b`, "i").test(body || "");

// Pick up to `max` related, tone-compatible, entity-sharing articles whose anchor appears in the body.
export function pickInternalLinks({ title, tags = [], category, body }, index, { max = 3 } = {}) {
  const myTone = toneOf(`${title} ${tags.join(" ")} ${(body || "").slice(0, 700)}`);
  const myTags = new Set(tags.map((t) => String(t).toLowerCase()));
  const scored = [];
  for (const a of index) {
    if (a.tone !== myTone) continue; // TONE GATE — never cross sensitive/normal
    const shared = a.tags.filter((t) => myTags.has(String(t).toLowerCase()) && !GENERIC.has(String(t).toLowerCase()));
    let score = shared.length * 3 + (a.category === category ? 1 : 0);
    if (score === 0) continue; // require a real shared entity/tag
    const anchor = a.anchors.find((term) => properNounAt(body, term) >= 0);
    if (!anchor) continue; // require the entity to appear as a PROPER NOUN in THIS body
    scored.push({ slug: a.slug, title: a.title, category: a.category, anchor, score });
  }
  scored.sort((x, y) => y.score - x.score);
  const picked = [];
  const usedAnchor = new Set();
  const usedSlug = new Set();
  for (const s of scored) {
    if (usedAnchor.has(s.anchor.toLowerCase()) || usedSlug.has(s.slug)) continue;
    usedAnchor.add(s.anchor.toLowerCase());
    usedSlug.add(s.slug);
    picked.push(s);
    if (picked.length >= max) break;
  }
  return picked;
}

const isInsideLink = (line, idx) => {
  const before = line.slice(0, idx);
  return (before.match(/\[/g) || []).length > (before.match(/\]/g) || []).length || /\]\([^)]*$/.test(before);
};

// Wrap the FIRST unlinked, non-heading occurrence of each anchor with a link to the related article.
export function injectInternalLinks(body, picks) {
  let out = stripPhantomLinkPhrases(body);
  for (const p of picks) {
    const href = `/${p.category}/${p.slug}/`;
    const lines = out.split("\n");
    let done = false;
    for (let i = 0; i < lines.length && !done; i++) {
      // Skip headings, the Sources list, a line that already has a link, and TABLE ROWS — injecting a
      // link inside a "| cell | cell |" row breaks the markdown table (FIX-3).
      if (/^#{1,6}\s/.test(lines[i]) || /^\s*##? Sources/i.test(lines[i]) || lines[i].includes("](") || /^\s*\|/.test(lines[i])) continue;
      const idx = properNounAt(lines[i], p.anchor); // only a Capitalized proper-noun occurrence
      if (idx >= 0 && !isInsideLink(lines[i], idx)) {
        const matched = lines[i].slice(idx, idx + p.anchor.length);
        lines[i] = lines[i].slice(0, idx) + `[${matched}](${href})` + lines[i].slice(idx + p.anchor.length);
        done = true;
      }
    }
    out = lines.join("\n");
  }
  return out;
}

// Remove dangling "see our feature / check out our analysis here" sentences that promise an internal
// link but have no real link (owner-flagged in the Mira Sorvino article).
export function stripPhantomLinkPhrases(body) {
  const PHANTOM = /\b(our feature|our analysis|our guide|our coverage|our roundup|our breakdown|our list|our ranking)\b|\bcheck out our\b|\bread more in our\b|\bin our (piece|article)\b/i;
  return body
    .split("\n")
    .map((para) => {
      if (!PHANTOM.test(para)) return para;
      const sentences = para.split(/(?<=[.!?])\s+/);
      const kept = sentences.filter((s) => !(PHANTOM.test(s) && !s.includes("](")));
      return kept.join(" ");
    })
    .join("\n")
    .replace(/[ \t]{2,}/g, " ");
}

// One-call entry point used by assemble: returns { body, linked: [{anchor, slug}] }.
export function addInternalLinks({ body, title, tags, category, slug }, { max = 3 } = {}) {
  // NEVER link inside the "## Sources" section (root-fix 2026-07-17): a plain outlet mention there became
  // an internal link wearing the outlet's name — fabricated attribution. Links go in the prose only.
  const cut = String(body || "").search(/\n## Sources\b/);
  const prose = cut >= 0 ? body.slice(0, cut) : body;
  const tail = cut >= 0 ? body.slice(cut) : "";
  const index = buildLinkIndex(slug);
  const picks = pickInternalLinks({ title, tags, category, body: prose }, index, { max });
  return { body: injectInternalLinks(prose, picks) + tail, linked: picks.map((p) => ({ anchor: p.anchor, slug: p.slug })) };
}
