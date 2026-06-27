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

const ART = "/Users/sivajithcu/Movie News site/site/content/articles";

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

// An anchor must be a PROPER-NOUN entity: a multi-word phrase, OR a single word that is title-like and
// not generic. The real safeguard is that we only LINK an occurrence that is Capitalized in the body
// (a proper noun) — so "production"/"cinema" used as common nouns can never become a link.
function anchorTerms(title, tags) {
  const out = new Set();
  for (const t of tags) {
    const term = String(t).trim();
    const low = term.toLowerCase();
    if (term.length < 4 || GENERIC.has(low)) continue;
    if (term.includes(" ") || term.length >= 5) out.add(term); // multi-word, or a real single-word name
  }
  return [...out];
}

// True only if `term` appears in `body` as a PROPER NOUN (capitalized first letter) — proper nouns
// (Zendaya, Christopher Nolan, Oppenheimer) qualify; a common-noun mention ("production budget") does not.
function properNounAt(body, term) {
  const re = new RegExp(`\\b${escapeRe(term)}\\b`, "gi"); // match case-insensitively…
  let m;
  while ((m = re.exec(body))) {
    if (/[A-Z]/.test(body[m.index])) return m.index; // …but only accept a Capitalized (proper-noun) occurrence
  }
  return -1;
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
    const tags = (data.tags || []).map((t) => String(t));
    idx.push({
      slug,
      title: data.title || "",
      category: data.category,
      tags,
      tone: toneOf(`${data.title} ${tags.join(" ")} ${(content || "").slice(0, 700)}`),
      anchors: anchorTerms(data.title, tags),
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
      if (/^#{1,6}\s/.test(lines[i]) || /^\s*##? Sources/i.test(lines[i]) || lines[i].includes("](")) continue;
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
  const index = buildLinkIndex(slug);
  const picks = pickInternalLinks({ title, tags, category, body }, index, { max });
  const newBody = injectInternalLinks(body, picks);
  return { body: newBody, linked: picks.map((p) => ({ anchor: p.anchor, slug: p.slug })) };
}
